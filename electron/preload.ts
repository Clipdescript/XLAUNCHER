import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    launchGame: (options: any) => ipcRenderer.invoke('launch-game', options),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    getModpacks: () => ipcRenderer.invoke('get-modpacks'),
    loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),
    onLog: (callback: any) => ipcRenderer.on('log', (event, data) => callback(data)),
    onProgress: (callback: any) => ipcRenderer.on('progress', (event, data) => callback(data)),
    // API de mise à jour
    onUpdateStatus: (callback: any) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    onUpdateProgress: (callback: any) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
    restartApp: () => ipcRenderer.invoke('restart-app')
});
