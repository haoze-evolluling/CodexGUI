package backend

type Session struct {
	ID         string `json:"id"`
	ThreadID   string `json:"threadId"`
	Title      string `json:"title"`
	CWD        string `json:"cwd"`
	Updated    int64  `json:"updated"`
	Model      string `json:"model,omitempty"`
	ArchivedAt int64  `json:"archivedAt,omitempty"`
}

type Provider struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"baseUrl"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
	HasAPIKey       bool   `json:"hasApiKey"`
}

type ProviderInput struct {
	ID              string `json:"id,omitempty"`
	Name            string `json:"name"`
	BaseURL         string `json:"baseUrl"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
}

type ProviderState struct {
	ActiveID        string     `json:"activeId"`
	Model           string     `json:"model"`
	ReasoningEffort string     `json:"reasoningEffort"`
	Providers       []Provider `json:"providers"`
}

type AppSettings struct {
	Theme     string `json:"theme"`
	FontSize  string `json:"fontSize"`
	CodexPath string `json:"codexPath,omitempty"`
}

type InstallationStatus struct {
	Status string `json:"status"`
	Path   string `json:"path,omitempty"`
	Source string `json:"source,omitempty"`
	Error  string `json:"error,omitempty"`
}

type ActionResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}
type ProviderResult struct {
	ActionResult
	State ProviderState `json:"state"`
}
type BootstrapState struct {
	Settings     AppSettings        `json:"settings"`
	Providers    ProviderState      `json:"providers"`
	Installation InstallationStatus `json:"installation"`
}
