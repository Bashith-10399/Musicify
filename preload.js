const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_, state) => cb(state)),
  getStreamUrl: (videoId) => ipcRenderer.invoke('get-stream-url', videoId)
});
