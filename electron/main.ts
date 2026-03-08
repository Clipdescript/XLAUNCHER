import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import * as msmc from 'msmc';
import { GameManager } from './GameManager';

// Initialisation du gestionnaire de jeu
const gameManager = new GameManager();

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
                'User-Agent': 'Craft-Launcher/1.0 (contact@example.com)'
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
            
            // Si l'utilisateur est connecté via Microsoft, on utilise son token
            if (userProfile && userProfile.name === options.username && userProfile.accessToken) {
                options.uuid = userProfile.uuid;
                options.accessToken = userProfile.accessToken;
            }

            // Définition des callbacks pour la communication avec le frontend
            const callbacks = {
                onProgress: (percent: number, task: string) => {
                    win.webContents.send('progress', { current: percent, total: 100, task: task });
                },
                onLog: (message: string) => {
                    win.webContents.send('log', message);
                },
                onError: (error: string) => {
                    win.webContents.send('log', `[ERREUR] ${error}`);
                    win.webContents.send('error', error);
                }
            };

            // Lancement asynchrone via le GameManager
            // On ne bloque pas le thread principal
            gameManager.launch(options, callbacks).catch(err => {
                console.error("Erreur fatale lors du lancement:", err);
                callbacks.onError(err.message || err);
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
