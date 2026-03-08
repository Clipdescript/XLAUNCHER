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
     * Vérifie et installe la version de Java appropriée pour la version de Minecraft demandée
     */
    async ensureJava(mcVersion: string, callbacks: ProgressCallbacks): Promise<string> {
        // Déterminer la version Java requise
        let javaVersion = 8;
        const v = parseFloat(mcVersion.replace(/\./g, '').substring(0, 3)); // ex: 1.20.1 -> 120
        
        // Logique de version Java
        if (mcVersion.startsWith("1.21") || mcVersion.startsWith("1.20.5") || mcVersion.startsWith("1.20.6")) {
            javaVersion = 21;
        } else if (v >= 118) { // 1.18+ -> Java 17
            javaVersion = 17;
        } else if (v >= 117) { // 1.17 -> Java 16 (on utilise 17 car compatible)
            javaVersion = 17;
        } else { // < 1.17 -> Java 8
            javaVersion = 8;
        }

        callbacks.onLog(`Version Minecraft ${mcVersion} détectée. Java requis : ${javaVersion}`);

        // Vérifier si cette version spécifique est déjà installée
        const javaPath = this.findEmbeddedJava(javaVersion);
        if (javaPath) {
            callbacks.onLog(`Java ${javaVersion} trouvé: ${javaPath}`);
            return javaPath;
        }

        callbacks.onLog(`Java ${javaVersion} manquant. Téléchargement...`);
        return await this.downloadJava(javaVersion, callbacks);
    }

    private findEmbeddedJava(version: number): string | null {
        const javaExec = process.platform === 'win32' ? 'java.exe' : 'java';
        // Structure: runtime/java-21/bin/java
        const specificPath = path.join(this.runtimeDir, `java-${version}`, 'bin', javaExec);
        if (fs.existsSync(specificPath)) return specificPath;
        
        // Fallback: chercher n'importe quel dossier contenant "jdk-version" ou "jre-version"
        const entries = fs.readdirSync(this.runtimeDir);
        for (const entry of entries) {
            if (entry.includes(version.toString()) && (entry.includes('jdk') || entry.includes('jre') || entry.includes('java'))) {
                const potentialPath = path.join(this.runtimeDir, entry, 'bin', javaExec);
                if (fs.existsSync(potentialPath)) return potentialPath;
            }
        }
        return null;
    }

    private async downloadJava(version: number, callbacks: ProgressCallbacks): Promise<string> {
        // URL pour Windows x64 (Adoptium)
        let url = '';
        const osType = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
        
        // Construction dynamique de l'URL Adoptium
        url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/${osType}/x64/jdk/hotspot/normal/eclipse?project=jdk`;

        const zipPath = path.join(this.runtimeDir, `java-${version}.zip`);
        const extractPath = path.join(this.runtimeDir, `java-${version}`); // Dossier cible propre
        
        callbacks.onProgress(0, `Téléchargement de Java ${version}...`);
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erreur téléchargement Java ${version}: ${response.statusText}`);
        
        const fileStream = fs.createWriteStream(zipPath);
        const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
        
        let downloaded = 0;

        return new Promise((resolve, reject) => {
            response.body.on('data', (chunk) => {
                downloaded += chunk.length;
                fileStream.write(chunk);
                if (totalSize > 0) {
                    const percent = Math.round((downloaded / totalSize) * 100);
                    if (percent % 10 === 0) callbacks.onLog(`DL Java ${version}: ${percent}%`);
                }
            });

            response.body.on('error', (err) => {
                fileStream.close();
                reject(err);
            });

            response.body.on('end', () => {
                fileStream.close();
                callbacks.onProgress(100, `Extraction de Java ${version}...`);
                
                try {
                    const zip = new AdmZip(zipPath);
                    // Extraction dans un dossier temporaire d'abord car le zip contient souvent un dossier racine "jdk-21..."
                    const tempExtractDir = path.join(this.runtimeDir, `temp-${version}`);
                    zip.extractAllTo(tempExtractDir, true);
                    fs.unlinkSync(zipPath);

                    // Déplacer le contenu du dossier extrait vers notre dossier propre "java-X"
                    const extractedFolder = fs.readdirSync(tempExtractDir)[0]; // Le dossier racine dans le zip
                    const source = path.join(tempExtractDir, extractedFolder);
                    
                    if (fs.existsSync(extractPath)) {
                        fs.rmdirSync(extractPath, { recursive: true });
                    }
                    fs.renameSync(source, extractPath);
                    fs.rmdirSync(tempExtractDir); // Supprimer le temp
                    
                    const javaPath = path.join(extractPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                    resolve(javaPath);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    // Fonction pour récupérer la dernière version d'un mod sur Modrinth compatible avec la version MC
    private async getModVersion(modId: string, mcVersion: string, loader: string = 'fabric'): Promise<string | null> {
        try {
            const url = `https://api.modrinth.com/v2/project/${modId}/version?loaders=["${loader}"]&game_versions=["${mcVersion}"]`;
            const response = await fetch(url);
            if (!response.ok) return null;
            
            const versions: any = await response.json();
            if (versions.length > 0) {
                // Retourne l'URL de téléchargement du premier fichier de la version la plus récente
                return versions[0].files[0].url;
            }
            return null;
        } catch (e) {
            console.error(`Erreur récup mod ${modId}:`, e);
            return null;
        }
    }

    // Télécharge et installe les mods optimisés
    private async installOptimizedMods(mcVersion: string, callbacks: ProgressCallbacks) {
        const modsDir = path.join(this.gameDir, 'mods');
        if (!fs.existsSync(modsDir)) {
            fs.mkdirSync(modsDir, { recursive: true });
        }

        // Liste des mods à installer (ID Modrinth)
        const mods = [
            { id: 'P7dR8mSH', name: 'Fabric API' },
            { id: 'AANobbMI', name: 'Sodium' },
            { id: '3P5GcnTA', name: 'Iris' },
            { id: 'hvFnDODi', name: 'Lithium' }
        ];

        callbacks.onLog("Vérification des mods d'optimisation...");

        for (const mod of mods) {
            try {
                // On vérifie si un fichier contenant le nom du mod existe déjà
                // C'est une vérif basique, l'idéal serait de vérifier le hash
                const existingFiles = fs.readdirSync(modsDir);
                const alreadyInstalled = existingFiles.some(f => f.toLowerCase().includes(mod.name.toLowerCase().replace(' ', '-')) && f.endsWith('.jar'));
                
                if (alreadyInstalled) {
                    callbacks.onLog(`${mod.name} déjà présent.`);
                    continue;
                }

                callbacks.onProgress(0, `Recherche de ${mod.name}...`);
                const downloadUrl = await this.getModVersion(mod.id, mcVersion);
                
                if (downloadUrl) {
                    const fileName = path.basename(downloadUrl);
                    const destPath = path.join(modsDir, fileName);
                    
                    callbacks.onLog(`Téléchargement de ${mod.name}...`);
                    
                    const response = await fetch(downloadUrl);
                    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
                    
                    const buffer = await response.buffer();
                    fs.writeFileSync(destPath, buffer);
                    callbacks.onLog(`${mod.name} installé.`);
                } else {
                    callbacks.onLog(`Aucune version compatible de ${mod.name} trouvée pour ${mcVersion}`);
                }
            } catch (e: any) {
                callbacks.onLog(`Erreur install ${mod.name}: ${e.message}`);
            }
        }
    }

    // Installe Fabric Loader manuellement via l'API Meta Fabric
    private async installFabric(mcVersion: string, callbacks: ProgressCallbacks): Promise<string> {
        callbacks.onLog("Vérification de Fabric Loader...");
        
        // 1. Récupérer la dernière version du loader
        const loaderUrl = 'https://meta.fabricmc.net/v2/versions/loader';
        const loaderResp = await fetch(loaderUrl);
        if (!loaderResp.ok) throw new Error("Impossible de récupérer les versions Fabric");
        const loaders: any = await loaderResp.json();
        const latestLoader = loaders[0].version; // ex: 0.15.7
        
        // Nom de la version finale (ex: fabric-loader-0.15.7-1.20.1)
        const fabricVersionName = `fabric-loader-${latestLoader}-${mcVersion}`;
        const versionDir = path.join(this.gameDir, 'versions', fabricVersionName);
        const versionJsonPath = path.join(versionDir, `${fabricVersionName}.json`);

        if (fs.existsSync(versionJsonPath)) {
            callbacks.onLog(`Fabric ${latestLoader} déjà installé.`);
            return fabricVersionName;
        }

        // 2. Télécharger le profil JSON complet
        callbacks.onProgress(0, "Installation du profil Fabric...");
        const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${latestLoader}/profile/json`;
        const profileResp = await fetch(profileUrl);
        if (!profileResp.ok) throw new Error("Impossible de télécharger le profil Fabric");
        
        const profileJson = await profileResp.json();
        
        // Sauvegarder le JSON
        if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
        fs.writeFileSync(versionJsonPath, JSON.stringify(profileJson, null, 2));
        
        callbacks.onLog(`Profil Fabric installé : ${fabricVersionName}`);
        return fabricVersionName;
    }

    // Installe Forge manuellement
    private async installForge(mcVersion: string, callbacks: ProgressCallbacks): Promise<string> {
        const forgeDir = path.join(this.gameDir, 'forge');
        if (!fs.existsSync(forgeDir)) fs.mkdirSync(forgeDir, { recursive: true });

        const installerPath = path.join(forgeDir, `forge-${mcVersion}-installer.jar`);

        // Si l'installateur existe déjà, on le retourne
        if (fs.existsSync(installerPath)) {
             callbacks.onLog(`Installateur Forge pour ${mcVersion} trouvé.`);
             return installerPath;
        }

        callbacks.onProgress(0, "Recherche de Forge...");
        
        // On utilise l'API de Piston Meta pour trouver la version recommandée de Forge
        // Note: L'API officielle de Forge est complexe (maven). Une alternative simple est d'utiliser une API tierce ou de construire l'URL Maven.
        // URL Maven Forge : https://maven.minecraftforge.net/net/minecraftforge/forge/{version}/forge-{version}-installer.jar
        // La version est souvent {mcVersion}-{forgeVersion}
        
        // On va essayer de récupérer la version "Recommended" ou "Latest" via l'API promo de Forge
        try {
            const promoUrl = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
            const promoResp = await fetch(promoUrl);
            if (!promoResp.ok) throw new Error("Impossible de récupérer les versions Forge");
            
            const promos: any = await promoResp.json();
            const promoKey = promos.promos[`${mcVersion}-recommended`] ? `${mcVersion}-recommended` : `${mcVersion}-latest`;
            const forgeVersion = promos.promos[promoKey];
            
            if (!forgeVersion) throw new Error(`Aucune version de Forge trouvée pour ${mcVersion}`);
            
            const fullVersion = `${mcVersion}-${forgeVersion}`;
            const downloadUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
            
            callbacks.onLog(`Téléchargement de Forge ${fullVersion}...`);
            
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`Erreur téléchargement Forge: ${response.status}`);
            
            const buffer = await response.buffer();
            fs.writeFileSync(installerPath, buffer);
            
            callbacks.onLog(`Forge ${fullVersion} téléchargé.`);
            return installerPath;
            
        } catch (e: any) {
             throw new Error(`Erreur installation Forge: ${e.message}`);
        }
    }

    async launch(options: any, callbacks: ProgressCallbacks) {
        try {
            callbacks.onLog("Initialisation du lancement...");
            
            // 1. Préparer Java
            const javaPath = await this.ensureJava(options.version, callbacks);
            
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

            // Aikar's Flags (Optimisation GC et performances)
            const jvmArgs = [
                "-XX:+UseG1GC",
                "-XX:+ParallelRefProcEnabled",
                "-XX:MaxGCPauseMillis=200",
                "-XX:+UnlockExperimentalVMOptions",
                "-XX:+DisableExplicitGC",
                "-XX:+AlwaysPreTouch",
                "-XX:G1NewSizePercent=30",
                "-XX:G1MaxNewSizePercent=40",
                "-XX:G1HeapRegionSize=8M",
                "-XX:G1ReservePercent=20",
                "-XX:G1HeapWastePercent=5",
                "-XX:G1MixedGCCountTarget=4",
                "-XX:InitiatingHeapOccupancyPercent=15",
                "-XX:G1MixedGCLiveThresholdPercent=90",
                "-XX:G1RSetUpdatingPauseTimePercent=5",
                "-XX:SurvivorRatio=32",
                "-XX:+PerfDisableSharedMem",
                "-XX:MaxTenuringThreshold=1",
                "-Dusing.aikars.flags=https://mcflags.emc.gs",
                "-Daikars.new.flags=true"
            ];

            // Préparation des options de base
            const opts: ILauncherOptions = {
                clientPackage: undefined, 
                authorization: authorization,
                root: this.gameDir,
                version: {
                    number: options.version,
                    type: "release"
                },
                memory: {
                    max: options.maxMem || "2G",
                    min: "1G"
                },
                javaPath: javaPath,
                customArgs: jvmArgs, // Ajout des flags d'optimisation
                overrides: {
                    detached: false
                }
            };

            // LOGIQUE VANILLA OPTIMISÉ (Fabric + Sodium + Iris)
            if (options.loader === 'vanilla' || options.loader === 'fabric') {
                callbacks.onLog("Mode Optimisé activé (Fabric + Sodium + Iris)");
                
                // 1. Installer les mods
                await this.installOptimizedMods(options.version, callbacks);
                
                // 2. Installer et configurer Fabric Loader
                try {
                    const fabricVersionName = await this.installFabric(options.version, callbacks);
                    
                    // IMPORTANT : On dit à MCLC d'utiliser cette version CUSTOM qu'on vient de créer
                    opts.version.number = options.version; // La version de base reste la version MC (ex: 1.20.1)
                    opts.version.custom = fabricVersionName; // Mais on charge le JSON custom (ex: fabric-loader-...)
                    
                } catch (e: any) {
                    callbacks.onLog(`Erreur installation Fabric: ${e.message}. Retour au Vanilla.`);
                }
            }

            // Gestion Forge
            if (options.loader === 'forge') {
                try {
                    callbacks.onLog("Installation de Forge...");
                    const forgeInstallerPath = await this.installForge(options.version, callbacks);
                    opts.forge = forgeInstallerPath;
                    callbacks.onLog(`Forge configuré avec l'installateur : ${forgeInstallerPath}`);
                } catch (e: any) {
                     callbacks.onError(`Impossible d'installer Forge: ${e.message}`);
                     return;
                }
            }

            callbacks.onLog(`Lancement de ${opts.version.custom || opts.version.number} avec Java à ${javaPath}`);
            
            this.launcher.launch(opts);

            this.launcher.on('debug', (e) => callbacks.onLog(`[DEBUG] ${e}`));
            this.launcher.on('data', (e) => callbacks.onLog(`[GAME] ${e}`));
            this.launcher.on('progress', (e) => {
                callbacks.onProgress(e.task / e.total * 100, `Chargement: ${e.type}`);
                callbacks.onLog(`[PROGRESS] ${e.type} - ${e.task}/${e.total}`);
            });
            this.launcher.on('download-status', (e) => {
                 // Calcul de la progression en MB
                 const currentMB = (e.current / 1024 / 1024).toFixed(1);
                 const totalMB = (e.total / 1024 / 1024).toFixed(1);
                 // Progression globale du téléchargement
                 const percent = Math.round((e.current / e.total) * 100);
                 
                 callbacks.onProgress(percent, `Téléchargement ${e.name}: ${currentMB}/${totalMB} MB`);
                 // On évite de spammer les logs
                 if (percent % 10 === 0) {
                     callbacks.onLog(`[DOWNLOAD] ${e.name} (${currentMB}/${totalMB} MB)`);
                 }
            });
            
        } catch (error: any) {
            callbacks.onError(error.message || error);
        }
    }
}
