const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('codex', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadHistory: () => ipcRenderer.invoke('sessions:history'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  getCodexInstallation: () => ipcRenderer.invoke('codex:installation'),
  saveCodexPath: codexPath => ipcRenderer.invoke('codex:path-save', codexPath),
  saveSession: session => ipcRenderer.invoke('sessions:save', session),
  archiveSession: session => ipcRenderer.invoke('sessions:archive', session),
  archiveProject: async sessions => {
    for (const session of sessions) {
      const result = await ipcRenderer.invoke('sessions:archive', session);
      if (!result?.ok) return result;
    }
    return { ok: true };
  },
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  chooseFiles: defaultPath => ipcRenderer.invoke('dialog:files', defaultPath),
  chooseCodexExecutable: defaultPath => ipcRenderer.invoke('dialog:codex-executable', defaultPath),
  getPathForFile: file => webUtils.getPathForFile(file),
  start: options => ipcRenderer.invoke('cli:start', options),
  stop: sessionId => ipcRenderer.invoke('cli:stop', sessionId),
  compact: (sessionId, threadId) => ipcRenderer.invoke('cli:compact', sessionId, threadId),
  resetSession: sessionId => ipcRenderer.invoke('cli:reset-session', sessionId),
  listModels: () => ipcRenderer.invoke('cli:models'),
  listCollaborationModes: () => ipcRenderer.invoke('cli:collaboration-modes'),
  listSkills: (cwd, forceReload = false) => ipcRenderer.invoke('cli:skills', cwd, forceReload),
  answerUserInput: (itemId, answers) => ipcRenderer.invoke('cli:answer-user-input', itemId, answers),
  onData: callback => subscribe('cli:data', callback),
  onActivity: callback => subscribe('cli:activity', callback),
  onThread: callback => subscribe('cli:thread', callback),
  onExit: callback => subscribe('cli:exit', callback),
  onError: callback => subscribe('cli:error', callback),
  onCompacted: callback => subscribe('cli:compacted', callback),
  onStatus: callback => subscribe('cli:status', callback),
  onTokenUsage: callback => subscribe('cli:token-usage', callback),
  onUserInput: callback => subscribe('cli:user-input', callback),
  onPlanReady: callback => subscribe('cli:plan-ready', callback),
  onSkillsChanged: callback => subscribe('cli:skills-changed', callback),
});
