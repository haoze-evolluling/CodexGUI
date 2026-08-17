package backend

import (
	"path/filepath"
	"testing"
)

func TestSaveSettingsNormalizesValues(t *testing.T) {
	s := newStore(t.TempDir())
	settings, err := s.saveSettings(AppSettings{Theme: "light", FontSize: "large", CodexPath: "  C:/tools/codex.exe  "})
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != "light" || settings.FontSize != "large" || settings.CodexPath != "C:/tools/codex.exe" {
		t.Fatalf("unexpected settings: %#v", settings)
	}
	loaded := s.settings()
	if loaded != settings {
		t.Fatalf("settings were not persisted: %#v", loaded)
	}
}

func TestAtomicJSONRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "value.json")
	if err := writeJSON(path, map[string]string{"value": "ok"}); err != nil {
		t.Fatal(err)
	}
	value := readJSON(path, map[string]string{})
	if value["value"] != "ok" {
		t.Fatalf("unexpected value: %#v", value)
	}
}

func TestSlug(t *testing.T) {
	if got := slug("  OpenAI Compatible / 01 "); got != "openai-compatible-01" {
		t.Fatalf("got %q", got)
	}
}

func TestNextProviderID(t *testing.T) {
	records := map[string]providerRecord{
		"provider":   {ID: "provider"},
		"provider-2": {ID: "provider-2"},
		"openai":     {ID: "openai"},
	}
	if got := nextProviderID(records, "硅基流动"); got != "provider-3" {
		t.Fatalf("nextProviderID() for a non-slug name = %q, want provider-3", got)
	}
	if got := nextProviderID(records, "OpenAI"); got != "openai-2" {
		t.Fatalf("nextProviderID() for duplicate slug = %q, want openai-2", got)
	}
}
