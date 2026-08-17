package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

const codexProviderID = "codex_gui_provider"

type providerRecord struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"baseUrl"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
}
type providerFile struct {
	Providers map[string]providerRecord `json:"providers"`
}
type providerManager struct {
	store     *store
	codexHome string
	process   *codexProcess
}

func newProviderManager(s *store, home string, process *codexProcess) *providerManager {
	return &providerManager{store: s, codexHome: home, process: process}
}
func (m *providerManager) records() providerFile {
	return readJSON(m.store.path("providers.json"), providerFile{Providers: map[string]providerRecord{}})
}
func (m *providerManager) configPath() string { return filepath.Join(m.codexHome, "config.toml") }
func (m *providerManager) authPath() string   { return filepath.Join(m.codexHome, "auth.json") }
func (m *providerManager) state() ProviderState {
	records := m.records()
	config := m.readConfig()
	configuredID, _ := config["model_provider"].(string)
	// Always serialize an empty provider collection as [] rather than null so
	// clients can render the no-provider state without special null handling.
	state := ProviderState{Providers: make([]Provider, 0)}
	state.Model, _ = config["model"].(string)
	state.ReasoningEffort, _ = config["model_reasoning_effort"].(string)
	for _, record := range records.Providers {
		_, err := readSecret(record.ID)
		state.Providers = append(state.Providers, Provider{ID: record.ID, Name: record.Name, BaseURL: record.BaseURL, Model: record.Model, ReasoningEffort: record.ReasoningEffort, HasAPIKey: err == nil})
		if configuredID == codexProviderID && record.Model == state.Model && record.ReasoningEffort == state.ReasoningEffort {
			if entry, ok := configuredProvider(config); ok && record.Name == entry.Name && record.BaseURL == entry.BaseURL {
				state.ActiveID = record.ID
			}
		}
	}
	if state.ActiveID == "" {
		state.ActiveID = configuredID
	}
	return state
}

type configuredProviderEntry struct {
	Name    string
	BaseURL string
}

func configuredProvider(config map[string]any) (configuredProviderEntry, bool) {
	providers, ok := config["model_providers"].(map[string]any)
	if !ok {
		return configuredProviderEntry{}, false
	}
	value, ok := providers[codexProviderID].(map[string]any)
	if !ok {
		return configuredProviderEntry{}, false
	}
	name, _ := value["name"].(string)
	baseURL, _ := value["base_url"].(string)
	return configuredProviderEntry{Name: name, BaseURL: baseURL}, name != "" || baseURL != ""
}
func (m *providerManager) readConfig() map[string]any {
	b, err := os.ReadFile(m.configPath())
	if err != nil {
		return map[string]any{}
	}
	result := map[string]any{}
	if toml.Unmarshal(b, &result) != nil {
		return map[string]any{}
	}
	return result
}
func (m *providerManager) save(input ProviderInput) (ProviderState, error) {
	records := m.records()
	id := strings.TrimSpace(input.ID)
	name := strings.TrimSpace(input.Name)
	if id == "" {
		id = nextProviderID(records.Providers, name)
	}
	if name == "" {
		return m.state(), errors.New("请输入提供商名称。")
	}
	parsed, err := url.ParseRequestURI(strings.TrimSpace(input.BaseURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return m.state(), errors.New("请输入有效的提供商请求地址。")
	}
	if strings.TrimSpace(input.Model) == "" {
		return m.state(), errors.New("请输入默认模型。")
	}
	if input.ReasoningEffort != "low" && input.ReasoningEffort != "medium" && input.ReasoningEffort != "high" && input.ReasoningEffort != "xhigh" {
		return m.state(), errors.New("默认推理强度无效。")
	}
	for key, value := range records.Providers {
		if key != id && strings.EqualFold(value.Name, name) {
			return m.state(), errors.New("提供商名称已存在。")
		}
	}
	if strings.TrimSpace(input.APIKey) != "" {
		if err := ensureSecret(id, strings.TrimSpace(input.APIKey)); err != nil {
			return m.state(), err
		}
	} else if _, err := readSecret(id); err != nil {
		return m.state(), errors.New("请输入提供商 API Key。")
	}
	records.Providers[id] = providerRecord{ID: id, Name: name, BaseURL: strings.TrimSpace(input.BaseURL), Model: strings.TrimSpace(input.Model), ReasoningEffort: input.ReasoningEffort}
	if err := writeJSON(m.store.path("providers.json"), records); err != nil {
		return m.state(), err
	}
	return m.state(), nil
}
func (m *providerManager) activate(id, codexPath string) (ProviderState, error) {
	records := m.records()
	selected, ok := records.Providers[id]
	if !ok {
		return m.state(), errors.New("提供商不存在。")
	}
	key, err := readSecret(id)
	if err != nil || key == "" {
		return m.state(), errors.New("该提供商没有可用的 API Key。")
	}
	configBefore, _ := os.ReadFile(m.configPath())
	authBefore, _ := os.ReadFile(m.authPath())
	config := m.readConfig()
	config["model_provider"] = codexProviderID
	config["model"] = selected.Model
	config["model_reasoning_effort"] = selected.ReasoningEffort
	providers, ok := config["model_providers"].(map[string]any)
	if !ok {
		providers = map[string]any{}
	}
	providers[codexProviderID] = map[string]any{"name": selected.Name, "wire_api": "responses", "requires_openai_auth": true, "base_url": selected.BaseURL}
	config["model_providers"] = providers
	encoded, err := toml.Marshal(config)
	if err != nil {
		return m.state(), err
	}
	if err = writeAtomic(m.configPath(), encoded, 0600); err != nil {
		return m.state(), err
	}
	auth := map[string]any{}
	_ = jsonRead(m.authPath(), &auth)
	auth["OPENAI_API_KEY"] = key
	if err = writeJSON(m.authPath(), auth); err == nil {
		m.process.stop()
		err = m.process.ensure(codexPath)
	}
	if err != nil {
		_ = restore(m.configPath(), configBefore)
		_ = restore(m.authPath(), authBefore)
		return m.state(), fmt.Errorf("切换提供商失败：%w", err)
	}
	return m.state(), nil
}
func (m *providerManager) remove(id string) (ProviderState, error) {
	state := m.state()
	if state.ActiveID == id {
		return state, errors.New("当前提供商不能删除，请先切换到其他提供商。")
	}
	records := m.records()
	if _, ok := records.Providers[id]; !ok {
		return state, errors.New("提供商不存在。")
	}
	delete(records.Providers, id)
	if err := writeJSON(m.store.path("providers.json"), records); err != nil {
		return state, err
	}
	_ = removeSecret(id)
	return m.state(), nil
}
func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	dash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(out.String(), "-")
}
func nextProviderID(records map[string]providerRecord, name string) string {
	base := slug(name)
	if base == "" {
		base = "provider"
	}
	if _, exists := records[base]; !exists {
		return base
	}
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s-%d", base, n)
		if _, exists := records[candidate]; !exists {
			return candidate
		}
	}
}
func jsonRead(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
func restore(path string, b []byte) error {
	if b == nil {
		return os.Remove(path)
	}
	return writeAtomic(path, b, 0600)
}
