package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type App struct {
	ctx       context.Context
	store     *store
	process   *codexProcess
	providers *providerManager
}

func NewApp() (*App, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dataDir := filepath.Join(dir, "CodexGUI")
	if err = os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	storage := newStore(dataDir)
	process := newCodexProcess()
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	app := &App{store: storage, process: process}
	app.providers = newProviderManager(storage, filepath.Join(home, ".codex"), process)
	if err := app.migrateLegacy(); err != nil {
		return nil, err
	}
	return app, nil
}
func (a *App) Startup(ctx context.Context) { a.ctx = ctx }
func (a *App) Shutdown(context.Context)    { a.process.stop() }
func (a *App) Bootstrap() BootstrapState {
	return BootstrapState{Settings: a.store.settings(), Providers: a.providers.state(), Installation: resolveCodex(a.store.settings().CodexPath)}
}
func (a *App) GetSettings() AppSettings { return a.store.settings() }
func (a *App) SaveSettings(settings AppSettings) (AppSettings, error) {
	return a.store.saveSettings(settings)
}
func (a *App) GetInstallationStatus() InstallationStatus {
	return resolveCodex(a.store.settings().CodexPath)
}
func (a *App) GetProviders() ProviderState { return a.providers.state() }
func (a *App) SaveProvider(input ProviderInput) ProviderResult {
	state, err := a.providers.save(input)
	return providerResult(state, err)
}
func (a *App) ActivateProvider(id string) ProviderResult {
	state, err := a.providers.activate(id, a.store.settings().CodexPath)
	return providerResult(state, err)
}
func (a *App) DeleteProvider(id string) ProviderResult {
	state, err := a.providers.remove(id)
	return providerResult(state, err)
}
func providerResult(state ProviderState, err error) ProviderResult {
	result := ProviderResult{State: state}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.OK = true
	return result
}
func (a *App) ListArchivedSessions() ([]Session, error) {
	return a.process.listArchived(context.Background(), a.store.settings().CodexPath)
}
func (a *App) RestoreArchivedSession(threadID string) ActionResult {
	return action(a.process.threadAction(context.Background(), a.store.settings().CodexPath, "thread/unarchive", threadID))
}
func (a *App) RemoveArchivedSession(threadID string) ActionResult {
	return action(a.process.threadAction(context.Background(), a.store.settings().CodexPath, "thread/delete", threadID))
}
func (a *App) ClearArchivedSessions() ActionResult {
	sessions, err := a.ListArchivedSessions()
	if err != nil {
		return action(err)
	}
	failures := []string{}
	for _, session := range sessions {
		if err := a.process.threadAction(context.Background(), a.store.settings().CodexPath, "thread/delete", session.ThreadID); err != nil {
			failures = append(failures, session.ThreadID)
		}
	}
	if len(failures) > 0 {
		return action(errors.New("部分归档对话未能删除。"))
	}
	return ActionResult{OK: true}
}
func action(err error) ActionResult {
	if err != nil {
		return ActionResult{Error: err.Error()}
	}
	return ActionResult{OK: true}
}
func (a *App) migrateLegacy() error {
	marker := a.store.path("migration-v1.json")
	if _, err := os.Stat(marker); err == nil {
		return nil
	}
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return writeJSON(marker, map[string]bool{"complete": true})
	}
	legacy := filepath.Join(appData, "codex-gui")
	settings := a.store.settings()
	oldSettings := readJSON(filepath.Join(legacy, "settings.json"), map[string]any{})
	if theme, ok := oldSettings["theme"].(string); ok {
		settings.Theme = theme
	}
	if font, ok := oldSettings["fontSize"].(string); ok {
		settings.FontSize = font
	}
	if path, ok := oldSettings["codexPath"].(string); ok {
		settings.CodexPath = strings.TrimSpace(path)
	}
	_, err := a.store.saveSettings(settings)
	if err != nil {
		return err
	}
	var old struct {
		Providers map[string]providerRecord `json:"providers"`
	}
	old = readJSON(filepath.Join(legacy, "providers.json"), old)
	if len(old.Providers) > 0 {
		current := a.providers.records()
		for id, record := range old.Providers {
			record.ID = id
			current.Providers[id] = record
		}
		if err := writeJSON(a.store.path("providers.json"), current); err != nil {
			return err
		}
	}
	return writeJSON(marker, map[string]bool{"complete": true})
}
