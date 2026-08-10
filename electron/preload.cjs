const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codex', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  getProviders: () => ipcRenderer.invoke('providers:get'),
  saveProvider: provider => ipcRenderer.invoke('providers:save', provider),
  activateProvider: id => ipcRenderer.invoke('providers:activate', id),
  deleteProvider: id => ipcRenderer.invoke('providers:delete', id),
  listArchivedSessions: () => ipcRenderer.invoke('sessions:archived-list'),
  restoreArchivedSession: session => ipcRenderer.invoke('sessions:restore', session),
  removeArchivedSession: session => ipcRenderer.invoke('sessions:archived-remove', session),
  clearArchivedSessions: () => ipcRenderer.invoke('sessions:archived-clear'),
});
