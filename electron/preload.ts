import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    launchGame: (options: any) => ipcRenderer.invoke('launch-game', options),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    getModpacks: () => ipcRenderer.invoke('get-modpacks'),
    loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),
    onLog: (callback: any) => ipcRenderer.on('log', (event, data) => callback(data)),
    onProgress: (callback: any) => ipcRenderer.on('progress', (event, data) => callback(data))
});
