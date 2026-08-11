package backend

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type rpcResponse struct {
	ID     uint64          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}
type codexProcess struct {
	mu      sync.Mutex
	command string
	child   *exec.Cmd
	input   *bufio.Writer
	nextID  uint64
	pending map[uint64]chan rpcResponse
	done    chan struct{}
}

func newCodexProcess() *codexProcess { return &codexProcess{pending: map[uint64]chan rpcResponse{}} }
func resolveCodex(path string) InstallationStatus {
	path = strings.TrimSpace(path)
	if path != "" {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return InstallationStatus{Status: "ready", Path: path, Source: "custom"}
		}
		return InstallationStatus{Status: "invalid", Path: path, Error: "配置的 Codex 可执行文件不存在。"}
	}
	for _, name := range []string{"codex.exe", "codex.cmd", "codex"} {
		if found, err := exec.LookPath(name); err == nil {
			return InstallationStatus{Status: "ready", Path: found, Source: "path"}
		}
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		candidate := filepath.Join(appData, "npm", "codex.cmd")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return InstallationStatus{Status: "ready", Path: candidate, Source: "npm"}
		}
	}
	return InstallationStatus{Status: "missing", Error: "未找到 Codex。请安装 Codex 或在设置中选择其可执行文件。"}
}
func (p *codexProcess) start(path string) error {
	status := resolveCodex(path)
	if status.Status != "ready" {
		return errors.New(status.Error)
	}
	cmd := exec.Command(status.Path, "app-server", "--stdio")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	p.child = cmd
	p.command = status.Path
	p.input = bufio.NewWriter(stdin)
	p.done = make(chan struct{})
	go p.readLoop(stdout)
	go func() { _ = cmd.Wait(); p.failAll(errors.New("Codex app-server 已退出。")) }()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var ignored json.RawMessage
	if err := p.call(ctx, "initialize", map[string]any{"clientInfo": map[string]string{"name": "codex_gui", "title": "Codex GUI", "version": "2.0.0"}, "capabilities": map[string]bool{"experimentalApi": true}}, &ignored); err != nil {
		p.stop()
		return err
	}
	return p.notify("initialized", map[string]any{})
}
func (p *codexProcess) readLoop(stdout interface{ Read([]byte) (int, error) }) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	for scanner.Scan() {
		var response rpcResponse
		if json.Unmarshal(scanner.Bytes(), &response) == nil && response.ID != 0 {
			p.mu.Lock()
			ch := p.pending[response.ID]
			delete(p.pending, response.ID)
			p.mu.Unlock()
			if ch != nil {
				ch <- response
				close(ch)
			}
		}
	}
}
func (p *codexProcess) failAll(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, ch := range p.pending {
		delete(p.pending, id)
		ch <- rpcResponse{Error: &struct {
			Message string `json:"message"`
		}{err.Error()}}
		close(ch)
	}
	p.child = nil
	p.input = nil
}
func (p *codexProcess) stop() {
	p.mu.Lock()
	child := p.child
	p.child = nil
	p.input = nil
	p.mu.Unlock()
	if child != nil && child.Process != nil {
		_ = child.Process.Kill()
	}
}
func (p *codexProcess) ensure(path string) error {
	p.mu.Lock()
	alive := p.child != nil && p.command == resolveCodex(path).Path
	p.mu.Unlock()
	if alive {
		return nil
	}
	p.stop()
	return p.start(path)
}
func (p *codexProcess) notify(method string, params any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.input == nil {
		return errors.New("Codex app-server 未运行")
	}
	b, _ := json.Marshal(map[string]any{"method": method, "params": params})
	if _, err := p.input.Write(append(b, '\n')); err != nil {
		return err
	}
	return p.input.Flush()
}
func (p *codexProcess) call(ctx context.Context, method string, params any, out any) error {
	p.mu.Lock()
	if p.input == nil {
		p.mu.Unlock()
		return errors.New("Codex app-server 未运行")
	}
	p.nextID++
	id := p.nextID
	ch := make(chan rpcResponse, 1)
	p.pending[id] = ch
	b, _ := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	_, err := p.input.Write(append(b, '\n'))
	if err == nil {
		err = p.input.Flush()
	}
	if err != nil {
		delete(p.pending, id)
		p.mu.Unlock()
		return err
	}
	p.mu.Unlock()
	select {
	case response := <-ch:
		if response.Error != nil {
			return errors.New(response.Error.Message)
		}
		if out == nil {
			return nil
		}
		return json.Unmarshal(response.Result, out)
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return ctx.Err()
	}
}
func (p *codexProcess) listArchived(ctx context.Context, path string) ([]Session, error) {
	if err := p.ensure(path); err != nil {
		return nil, err
	}
	sessions := []Session{}
	var cursor any
	for {
		var result struct {
			Data []struct {
				ID            string `json:"id"`
				Name          string `json:"name"`
				Title         string `json:"title"`
				Preview       string `json:"preview"`
				CWD           string `json:"cwd"`
				UpdatedAt     any    `json:"updatedAt"`
				UpdatedSnake  any    `json:"updated_at"`
				Model         string `json:"model"`
				ArchivedAt    any    `json:"archivedAt"`
				ArchivedSnake any    `json:"archived_at"`
			} `json:"data"`
			NextCursor any `json:"nextCursor"`
		}
		if err := p.call(ctx, "thread/list", map[string]any{"archived": true, "cursor": cursor, "limit": 100}, &result); err != nil {
			return nil, err
		}
		for _, thread := range result.Data {
			if thread.ID != "" {
				title := thread.Name
				if title == "" {
					title = thread.Title
				}
				if title == "" {
					title = thread.Preview
				}
				if title == "" {
					title = "未命名对话"
				}
				sessions = append(sessions, Session{ID: "codex-" + thread.ID, ThreadID: thread.ID, Title: title, CWD: thread.CWD, Updated: parseTime(thread.UpdatedAt, thread.UpdatedSnake), Model: thread.Model, ArchivedAt: parseTime(thread.ArchivedAt, thread.ArchivedSnake)})
			}
		}
		if result.NextCursor == nil {
			break
		}
		if value, ok := result.NextCursor.(string); !ok || value == "" {
			break
		}
		cursor = result.NextCursor
	}
	return sessions, nil
}
func parseTime(values ...any) int64 {
	for _, value := range values {
		switch v := value.(type) {
		case float64:
			return int64(v)
		case string:
			if parsed, err := time.Parse(time.RFC3339, v); err == nil {
				return parsed.UnixMilli()
			}
		}
	}
	return 0
}
func (p *codexProcess) threadAction(ctx context.Context, path, method, id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("无效的归档对话。")
	}
	if err := p.ensure(path); err != nil {
		return err
	}
	var out json.RawMessage
	return p.call(ctx, method, map[string]string{"threadId": id}, &out)
}
func (p *codexProcess) String() string { return fmt.Sprintf("codex process %s", p.command) }
