const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('still', {
  getState: () => ipcRenderer.invoke('get-state'),
  getDay: date => ipcRenderer.invoke('get-day', date),
  action: (action, value) => ipcRenderer.invoke('action', action, value),
  onState: callback => ipcRenderer.on('state', (_event, state) => callback(state)),
  onComplete: callback => ipcRenderer.on('complete', (_event, event) => callback(event)),
  onPreferences: callback => ipcRenderer.on('preferences', () => callback())
});
