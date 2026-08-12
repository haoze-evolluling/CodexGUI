package backend

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type store struct{ dir string }

func newStore(dir string) *store         { return &store{dir: dir} }
func (s *store) path(name string) string { return filepath.Join(s.dir, name) }
func readJSON[T any](path string, fallback T) T {
	b, err := os.ReadFile(path)
	if err != nil {
		return fallback
	}
	var value T
	if json.Unmarshal(b, &value) != nil {
		return fallback
	}
	return value
}
func writeJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, b, 0600)
}
func writeAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".codex-manager-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Chmod(mode)
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, path)
}
func defaultSettings() AppSettings { return AppSettings{Theme: "dark", FontSize: "medium"} }
func (s *store) settings() AppSettings {
	v := readJSON(s.path("settings.json"), defaultSettings())
	if v.Theme != "light" && v.Theme != "dark" {
		v.Theme = "dark"
	}
	if v.FontSize != "small" && v.FontSize != "medium" && v.FontSize != "large" {
		v.FontSize = "medium"
	}
	v.CodexPath = strings.TrimSpace(v.CodexPath)
	return v
}
func (s *store) saveSettings(v AppSettings) (AppSettings, error) {
	current := s.settings()
	if v.Theme != "" {
		current.Theme = v.Theme
	}
	if v.FontSize != "" {
		current.FontSize = v.FontSize
	}
	current.CodexPath = strings.TrimSpace(v.CodexPath)
	if current.Theme != "light" && current.Theme != "dark" {
		return current, errors.New("主题无效")
	}
	if current.FontSize != "small" && current.FontSize != "medium" && current.FontSize != "large" {
		return current, errors.New("字体大小无效")
	}
	return current, writeJSON(s.path("settings.json"), current)
}
