import { Client, ILauncherOptions, Authenticator } from 'minecraft-launcher-core';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';

// Interface pour les callbacks de progression
export interface ProgressCallbacks {
    onProgress: (percent: number, task: string) => void;
    onLog: (message: string) => void;
    onError: (error: string) => void;
}

export class GameManager {
    private launcher: Client;
    private gameDir: string;
    private runtimeDir: string;

    constructor() {
        this.launcher = new Client();
        // Dossier de jeu dans AppData ou Documents selon la plateforme
        this.gameDir = path.join(app.getPath('userData'), 'minecraft_game');
        this.runtimeDir = path.join(app.getPath('userData'), 'runtime');
        
        if (!fs.existsSync(this.gameDir)) {
            fs.mkdirSync(this.gameDir, { recursive: true });
        }
        if (!fs.existsSync(this.runtimeDir)) {
            fs.mkdirSync(this.runtimeDir, { recursive: true });
        }
    }

    /**
     * Vérifie si Java est installé et compatible, sinon le télécharge
     */
    async ensureJava(callbacks: ProgressCallbacks): Promise<string> {
        // 1. Vérifier si un Java embarqué existe déjà
        const javaPath = this.findEmbeddedJava();
        if (javaPath) {
            callbacks.onLog(`Java embarqué trouvé: ${javaPath}`);
            return javaPath;
        }

        // 2. Vérifier si Java est dans le PATH système
        // ATTENTION : Pour Minecraft 1.21+, il faut Java 21 !
        // Le Java système (souvent Java 8) ne suffira pas.
        // On force le téléchargement du Java embarqué (Java 17/21) si aucun Java embarqué n'est trouvé.
        // On ne se fie plus au Java système pour éviter les problèmes de version (comme le 1.8.0_401 détecté dans vos logs).
        
        callbacks.onLog("Recherche de Java embarqué...");

        // 3. Télécharger Java (Adoptium Temurin 21 pour MC 1.21+, 17 pour 1.18+, 8 pour <1.17)
        // On prend Java 21 pour être sûr de supporter les dernières versions
        callbacks.onLog("Java embarqué non trouvé. Téléchargement de Java 21...");
        return await this.downloadJava(callbacks);
    }

    private findEmbeddedJava(): string | null {
        const javaExec = process.platform === 'win32' ? 'java.exe' : 'java';
        // Chercher dans runtime/bin/java ou runtime/*/bin/java
        if (fs.existsSync(path.join(this.runtimeDir, 'bin', javaExec))) {
            return path.join(this.runtimeDir, 'bin', javaExec);
        }
        
        // Chercher dans les sous-dossiers (ex: runtime/jdk-17.../bin/java)
        const entries = fs.readdirSync(this.runtimeDir);
        for (const entry of entries) {
            const potentialPath = path.join(this.runtimeDir, entry, 'bin', javaExec);
            if (fs.existsSync(potentialPath)) {
                return potentialPath;
            }
        }
        return null;
    }

    private async checkSystemJava(): Promise<string | null> {
        return new Promise((resolve) => {
            const cmd = process.platform === 'win32' ? 'where java' : 'which java';
            const child = spawn(cmd, { shell: true });
            
            let output = '';
            child.stdout.on('data', (data) => output += data.toString());
            
            child.on('close', (code) => {
                if (code === 0) {
                    const paths = output.split(/\r?\n/).filter(p => p.trim() !== '');
                    if (paths.length > 0) resolve(paths[0].trim());
                    else resolve(null);
                } else {
                    resolve(null);
                }
            });
        });
    }

    private async downloadJava(callbacks: ProgressCallbacks): Promise<string> {
        // URL pour Windows x64 Java 21 (Adoptium)
        let url = '';
        if (process.platform === 'win32') {
            url = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk';
        } else if (process.platform === 'darwin') {
            url = 'https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse?project=jdk';
        } else {
            url = 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk';
        }

        const zipPath = path.join(this.runtimeDir, 'java.zip');
        
        callbacks.onProgress(0, "Téléchargement de Java...");
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erreur téléchargement Java: ${response.statusText}`);
        
        const fileStream = fs.createWriteStream(zipPath);
        
        const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
        callbacks.onLog(`Taille du téléchargement Java: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        
        let downloaded = 0;

        return new Promise((resolve, reject) => {
            response.body.on('data', (chunk) => {
                downloaded += chunk.length;
                fileStream.write(chunk);
                if (totalSize > 0) {
                    const percent = Math.round((downloaded / totalSize) * 100);
                    // On ne spamme pas les logs, on envoie juste la progression
                    // callbacks.onProgress(percent, `Téléchargement de Java: ${percent}%`);
                    // Mais on peut mettre à jour le message d'état
                    if (percent % 10 === 0) {
                        callbacks.onLog(`Téléchargement Java: ${percent}%`);
                    }
                }
            });

            response.body.on('error', (err) => {
                fileStream.close();
                reject(err);
            });

            response.body.on('end', () => {
                fileStream.close();
                callbacks.onProgress(100, "Extraction de Java...");
                
                try {
                    const zip = new AdmZip(zipPath);
                    zip.extractAllTo(this.runtimeDir, true);
                    fs.unlinkSync(zipPath); // Supprimer le zip
                    
                    const javaPath = this.findEmbeddedJava();
                    if (!javaPath) reject(new Error("Java extrait mais exécutable introuvable"));
                    else resolve(javaPath!);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async launch(options: any, callbacks: ProgressCallbacks) {
        try {
            callbacks.onLog("Initialisation du lancement...");
            
            // 1. Préparer Java
            const javaPath = await this.ensureJava(callbacks);
            
            // 2. Configuration du lancement
            
            // Gestion de l'authentification (Offline ou Microsoft)
            let authorization;
            if (options.accessToken && options.uuid) {
                // Mode connecté
                authorization = {
                    access_token: options.accessToken,
                    client_token: options.clientToken,
                    uuid: options.uuid,
                    name: options.username,
                    user_properties: {} as any,
                    meta: {} as any
                };
            } else {
                // Mode offline (Crack)
                callbacks.onLog("Mode hors-ligne détecté. Utilisation d'un profil local.");
                authorization = Authenticator.getAuth(options.username);
            }

            const opts: ILauncherOptions = {
                clientPackage: undefined, // Sera géré par version.number
                authorization: authorization,
                root: this.gameDir,
                version: {
                    number: options.version,
                    type: "release" // ou snapshot, etc.
                },
                memory: {
                    max: options.maxMem || "2G",
                    min: "1G"
                },
                javaPath: javaPath,
                overrides: {
                    detached: false // Pour voir la sortie dans la console Electron
                }
            };

            // Gestion Forge/Fabric (simplifiée)
            if (options.loader === 'forge') {
                opts.forge = path.join(this.gameDir, 'forge_installer.jar'); // TODO: Gérer l'installation forge
                callbacks.onLog("Support Forge pas encore complètement implémenté en mode sans-python");
            }

            callbacks.onLog(`Lancement de Minecraft ${options.version} avec Java à ${javaPath}`);
            
            this.launcher.launch(opts);

            this.launcher.on('debug', (e) => callbacks.onLog(`[DEBUG] ${e}`));
            this.launcher.on('data', (e) => callbacks.onLog(`[GAME] ${e}`));
            this.launcher.on('progress', (e) => {
                callbacks.onProgress(e.task / e.total * 100, `Chargement: ${e.type}`);
                callbacks.onLog(`[PROGRESS] ${e.type} - ${e.task}/${e.total}`);
            });
            this.launcher.on('download-status', (e) => {
                 callbacks.onLog(`[DOWNLOAD] ${e.name} (${e.current}/${e.total})`);
            });
            
        } catch (error: any) {
            callbacks.onError(error.message || error);
        }
    }
}
