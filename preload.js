const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    launchGame: (options) => ipcRenderer.invoke('launch-game', options),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    getModpacks: () => ipcRenderer.invoke('get-modpacks'),
    onLog: (callback) => ipcRenderer.on('log', (event, data) => callback(data)),
    onProgress: (callback) => ipcRenderer.on('progress', (event, data) => callback(data))
});