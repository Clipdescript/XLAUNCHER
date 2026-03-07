const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client, Authenticator } = require('minecraft-launcher-core');
const fs = require('fs');
const fetch = require('node-fetch');
const msmc = require('msmc'); // Ajout de MSMC pour l'authentification Microsoft

// Initialisation du lanceur
const launcher = new Client();

// Variables globales pour stocker la session
let authManager = new msmc.Auth("select_account");
let userProfile = null;

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 600,
        minWidth: 800,
        minHeight: 500,
        icon: path.join(__dirname, 'Logo.ico'), // On garde .ico si le fichier s'appelle comme ça
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        resizable: true, // Autoriser le redimensionnement
        backgroundColor: '#2b2b2b'
    });

    win.loadFile('index.html');
    
    // Pour le debug (optionnel)
    // win.webContents.openDevTools();

    return win;
}

app.whenReady().then(() => {
    const win = createWindow();

    // Gestionnaire pour récupérer les versions
    ipcMain.handle('get-versions', async () => {
        try {
            const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const data = await response.json();
            
            // On filtre pour ne garder que les releases
            const releases = data.versions.filter(v => v.type === 'release');
            return releases;
        } catch (error) {
            console.error('Erreur récupération versions:', error);
            return [];
        }
    });

    // Gestionnaire pour récupérer les modpacks via Modrinth API
    ipcMain.handle('get-modpacks', async () => {
        try {
            // Recherche de modpacks triés par téléchargements
            // Important: Modrinth requiert un User-Agent unique pour l'identification
            const headers = {
                'User-Agent': 'XL-Launcher/1.0 (contact@example.com)'
            };
            
            // Les facets doivent être encodés correctement
            const facets = encodeURIComponent('[["project_type:modpack"]]');
            const url = `https://api.modrinth.com/v2/search?facets=${facets}&sort=downloads&limit=20`;
            
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                console.error(`Erreur HTTP Modrinth: ${response.status}`);
                return [];
            }
            
            const data = await response.json();
            return data.hits || [];
        } catch (error) {
            console.error('Erreur récupération modpacks:', error);
            return [];
        }
    });

    // Note: ipcMain.handle doit être défini avant de créer la fenêtre ou de recevoir des appels, 
    // mais dans whenReady() c'est ok tant que le renderer n'appelle pas immédiatement.
    // Cependant, pour la propreté, définissons le handler ici.
    
    // On doit récupérer la fenêtre pour envoyer les logs, mais ipcMain.handle n'a pas accès à `win` directement
    // si on le définit en dehors. On va le laisser dans whenReady pour capturer `win`.
    
    // Gestion de la connexion Microsoft
    ipcMain.handle('login-microsoft', async () => {
        try {
            // Lancement du processus de connexion
            const xboxManager = await authManager.launch("electron");
            const token = await xboxManager.getMinecraft();
            
            // Stockage du profil utilisateur
            userProfile = {
                name: token.profile.name,
                uuid: token.profile.id,
                accessToken: token.mcToken
            };
            
            return { success: true, profile: userProfile };
        } catch (error) {
            console.error("Erreur de connexion Microsoft:", error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('launch-game', async (event, options) => {
        try {
            console.log(`Lancement de la version ${options.version} pour ${options.username}...`);
            
            // Exécution du script Python backend
            const pythonPath = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
            const scriptPath = path.join(__dirname, 'launcher_backend.py');
            const executable = fs.existsSync(pythonPath) ? pythonPath : 'python';
            const { spawn } = require('child_process');

            let args = [];
            
            // Détermination des arguments
            let username = options.username;
            let uuid = "";
            let accessToken = "";
            
            // Si l'utilisateur est connecté via Microsoft et que le pseudo correspond
            if (userProfile && userProfile.name === options.username) {
                uuid = userProfile.uuid;
                accessToken = userProfile.accessToken;
            }
            
            if (options.modpack) {
                // Mode installation modpack
                args = [scriptPath, "install_modpack", options.modpack, username, options.maxMem, uuid, accessToken];
            } else {
                // Mode classique
                const loader = options.loader || 'vanilla';
                args = [scriptPath, options.version, username, options.maxMem, loader, uuid, accessToken];
            }
            
            const pyProcess = spawn(executable, args);

            pyProcess.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        // Essayer de parser le JSON renvoyé par le script Python
                        const msg = JSON.parse(line);
                        if (msg.status === 'progress') {
                            win.webContents.send('progress', { current: msg.percent, total: 100, task: 'Installation' });
                        } else if (msg.status === 'error') {
                            win.webContents.send('log', `[ERREUR] ${msg.message}`);
                        } else {
                            win.webContents.send('log', `[INFO] ${msg.message}`);
                        }
                    } catch (e) {
                        // Si ce n'est pas du JSON, on log tel quel
                        win.webContents.send('log', `[PYTHON] ${line}`);
                    }
                }
            });

            pyProcess.stderr.on('data', (data) => {
                win.webContents.send('log', `[STDERR] ${data}`);
            });

            pyProcess.on('close', (code) => {
                win.webContents.send('log', `[STOP] Processus Python terminé avec le code ${code}`);
            });

            return { success: true };

        } catch (error) {
            console.error(error);
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
