import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { Client } from 'minecraft-launcher-core';
import fs from 'fs';
import fetch from 'node-fetch';
import * as msmc from 'msmc';
import { spawn } from 'child_process';

// Initialisation du lanceur
const launcher = new Client();

// Variables globales pour stocker la session
let authManager = new msmc.Auth("select_account"); // Mode 'select_account' force la fenêtre de choix Microsoft
let userProfile: any = null;

function createMenu(win: BrowserWindow) {
    const isMac = process.platform === 'darwin';
    
    const template: MenuItemConstructorOptions[] = [
        // { role: 'appMenu' }
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] as MenuItemConstructorOptions[] : []),
        // { role: 'fileMenu' }
        {
            label: 'Fichier',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit', label: 'Quitter' }
            ]
        },
        // { role: 'viewMenu' }
        {
            label: 'Affichage',
            submenu: [
                { role: 'reload', label: 'Actualiser' },
                { role: 'forceReload', label: 'Forcer l\'actualisation' },
                { role: 'toggleDevTools', label: 'Outils de développement' },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Zoom par défaut' },
                { role: 'zoomIn', label: 'Zoom avant' },
                { role: 'zoomOut', label: 'Zoom arrière' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Plein écran' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 900,
        minHeight: 600,
        icon: path.join(__dirname, '../Logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        resizable: true,
        backgroundColor: '#00000000', // Transparent pour laisser voir Mica si besoin
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#ffffff', // Blanc opaque pour éviter la couleur turquoise système
            symbolColor: '#000000', // Couleur des icônes
            height: 30
        },
        backgroundMaterial: 'mica' // Effet Windows 11
    });

    // En développement, on charge l'URL de Vite
    // En production, on charge le fichier dist/index.html
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) {
        win.loadURL('http://localhost:5173');
        // win.webContents.openDevTools(); // Activer les outils de développement pour le débogage
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Gestion des erreurs de chargement
    win.webContents.on('did-fail-load', () => {
        if (isDev) {
            console.log("Le serveur Vite n'est pas prêt, rechargement...");
            setTimeout(() => win.loadURL('http://localhost:5173'), 1000);
        }
    });

    // Configuration de l'auto-updater
    if (!isDev) {
        autoUpdater.checkForUpdatesAndNotify();
    }

    autoUpdater.on('update-available', () => {
        win.webContents.send('update-status', { status: 'available' });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        win.webContents.send('update-progress', { 
            percent: progressObj.percent,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    autoUpdater.on('update-downloaded', () => {
        win.webContents.send('update-status', { status: 'downloaded' });
    });

    // Gestionnaire pour redémarrer l'application après mise à jour
    ipcMain.handle('restart-app', () => {
        autoUpdater.quitAndInstall();
    });

    return win;
}

app.whenReady().then(() => {
    const win = createWindow();
    createMenu(win);

    // Gestionnaire pour récupérer les versions
    ipcMain.handle('get-versions', async () => {
        try {
            // node-fetch requires options object in some versions
            const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {} as any);
            const data: any = await response.json();
            const releases = data.versions.filter((v: any) => v.type === 'release');
            return releases;
        } catch (error) {
            console.error('Erreur récupération versions:', error);
            return [];
        }
    });

    // Gestionnaire pour récupérer les modpacks via Modrinth API
    ipcMain.handle('get-modpacks', async () => {
        try {
            const headers = {
                'User-Agent': 'XL-Launcher/1.0 (contact@example.com)'
            };
            
            const facets = encodeURIComponent('[["project_type:modpack"]]');
            const url = `https://api.modrinth.com/v2/search?facets=${facets}&sort=downloads&limit=20`;
            
            // Correction TypeScript pour node-fetch v2 qui a des définitions de types parfois capricieuses
            const response = await fetch(url, { headers } as any);
            
            if (!response.ok) {
                console.error(`Erreur HTTP Modrinth: ${response.status}`);
                return [];
            }
            
            const data: any = await response.json();
            return data.hits || [];
        } catch (error) {
            console.error('Erreur récupération modpacks:', error);
            return [];
        }
    });

    // Gestion de la connexion Microsoft (Support étendu pour comptes scolaires)
    ipcMain.handle('login-microsoft', async () => {
        try {
            // Utilisation explicite du mode 'select_account' pour forcer le choix du compte
            // On lance avec "electron" mais on laisse MSMC gérer la fenêtre popup pour une compatibilité max
            const xboxManager = await authManager.launch("electron");
            const token = await xboxManager.getMinecraft();
            
            // Vérification stricte des propriétés
            if (!token || !token.profile || !token.mcToken) {
                // Pour les comptes scolaires, il arrive souvent que l'utilisateur n'ait pas de licence Java Edition
                // mais seulement Education Edition ou Bedrock. On prévient l'utilisateur.
                throw new Error("Connexion réussie mais aucune licence Minecraft Java trouvée sur ce compte.");
            }
            
            userProfile = {
                name: token.profile.name,
                uuid: token.profile.id,
                accessToken: token.mcToken
            };
            
            return { success: true, profile: userProfile };
        } catch (error: any) {
            console.error("Erreur de connexion Microsoft:", error);
            // Message d'erreur plus clair pour l'utilisateur
            let message = error.message || "Erreur inconnue";
            if (message.includes("cancelled") || message.includes("closed")) {
                message = "Connexion annulée par l'utilisateur.";
            } else if (message.includes("network")) {
                message = "Erreur réseau. Vérifiez votre connexion internet.";
            }
            return { success: false, error: message };
        }
    });

    ipcMain.handle('launch-game', async (event, options) => {
        try {
            console.log(`Lancement de la version ${options.version} pour ${options.username}...`);
            
            const isPackaged = app.isPackaged;
            let scriptPath = '';
            let pythonExecutable = 'python'; // Par défaut

            if (isPackaged) {
                // En production
                scriptPath = path.join(process.resourcesPath, 'launcher_backend.py');
                
                // 1. Chercher Python embarqué dans resources/.venv/Scripts/python.exe
                const embeddedPython = path.join(process.resourcesPath, '.venv', 'Scripts', 'python.exe');
                if (fs.existsSync(embeddedPython)) {
                    pythonExecutable = embeddedPython;
                }
            } else {
                // En développement
                scriptPath = path.join(process.cwd(), 'launcher_backend.py');
                
                // 1. Chercher Python dans .venv local
                const localVenvPython = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
                if (fs.existsSync(localVenvPython)) {
                    pythonExecutable = localVenvPython;
                }
            }

            // Si on utilise le python système (pas de venv trouvé), on essaie de résoudre le chemin réel
            // pour éviter les problèmes avec les raccourcis WindowsApps (0kb stub)
            if (pythonExecutable === 'python') {
                try {
                    const { stdout } = await import('util').then(u => u.promisify(require('child_process').exec)('where python'));
                    const paths = (stdout as string).toString().split('\r\n').filter((p: string) => p.trim() !== '');
                    
                    // On cherche un chemin qui NE contient PAS "WindowsApps" car ce sont souvent des stubs problématiques
                    const realPython = paths.find((p: string) => !p.includes('WindowsApps') && fs.existsSync(p));
                    
                    if (realPython) {
                        pythonExecutable = realPython;
                        console.log(`Python réel trouvé: ${pythonExecutable}`);
                    } else if (paths.length > 0) {
                        // Fallback sur le premier trouvé si pas de meilleur choix
                        pythonExecutable = paths[0];
                        console.log(`Fallback Python (peut être WindowsApps): ${pythonExecutable}`);
                    }
                } catch (e) {
                    console.warn("Impossible de résoudre le chemin python via 'where':", e);
                }
            }

            console.log(`Script Python cible: ${scriptPath}`);
            console.log(`Exécutable Python utilisé: ${pythonExecutable}`);

            if (!fs.existsSync(scriptPath)) {
                throw new Error(`Le script backend est introuvable à : ${scriptPath}`);
            }
            
            // Construction des arguments
            // Attention: spawn attend l'exécutable en 1er argument, et un tableau d'arguments ensuite
            // [script.py, arg1, arg2, ...]
            let pythonArgs = [scriptPath];
            
            let username = options.username;
            let uuid = "";
            let accessToken = "";
            
            if (userProfile && userProfile.name === options.username && userProfile.accessToken) {
                uuid = userProfile.uuid;
                accessToken = userProfile.accessToken;
            }
            
            if (options.modpack) {
                pythonArgs.push("install_modpack", options.modpack, username, options.maxMem, uuid, accessToken);
            } else {
                const loader = options.loader || 'vanilla';
                pythonArgs.push(options.version, username, options.maxMem, loader, uuid, accessToken);
            }
            
            const pythonCwd = isPackaged ? process.resourcesPath : process.cwd();

            console.log(`Commande: "${pythonExecutable}" ${pythonArgs.map(a => `"${a}"`).join(' ')}`);

            const pyProcess = spawn(pythonExecutable, pythonArgs, { 
                cwd: pythonCwd,
                stdio: ['ignore', 'pipe', 'pipe'] // Pipe stdout/stderr pour capturer les logs
            });

            pyProcess.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        // Transmission des messages JSON au frontend
                        if (msg.status === 'progress') {
                            win.webContents.send('progress', { current: msg.percent, total: 100, task: 'Installation' });
                        } else if (msg.status === 'step') {
                            win.webContents.send('progress', { current: 0, total: 100, task: msg.message });
                        } else if (msg.status === 'error') {
                            win.webContents.send('log', `[ERREUR] ${msg.message}`);
                        } else {
                            win.webContents.send('log', `[INFO] ${msg.message}`);
                        }
                    } catch (e) {
                        // Ce n'est pas du JSON, on log brut
                        win.webContents.send('log', `[PYTHON] ${line}`);
                    }
                }
            });

            pyProcess.stderr.on('data', (data) => {
                win.webContents.send('log', `[STDERR] ${data}`);
            });
            
            return { success: true };

        } catch (error: any) {
            console.error('Erreur lancement:', error);
            return { success: false, error: error.message };
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
