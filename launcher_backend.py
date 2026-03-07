import sys
import os
import subprocess
import uuid
import json
import minecraft_launcher_lib
import requests

# Configuration
MINECRAFT_DIRECTORY = os.path.join(os.getcwd(), 'minecraft_game')

def install_modpack(modpack_id, version_id, username, max_mem, user_uuid="", access_token=""):
    # Callbacks pour la progression
    current_max = 0
    def set_status(text):
        print(json.dumps({"status": "step", "message": text}))
        sys.stdout.flush()
    
    def set_progress(current):
        if current_max > 0:
            percent = int((current / current_max) * 100)
            print(json.dumps({"status": "progress", "percent": percent}))
            sys.stdout.flush()

    def set_max(max_val):
        nonlocal current_max
        current_max = max_val

    callbacks = {
        "setStatus": set_status,
        "setProgress": set_progress,
        "setMax": set_max
    }

    try:
        print(json.dumps({"status": "init", "message": f"Installation du modpack {modpack_id}..."}))
        sys.stdout.flush()

        # Récupération des informations de version du modpack depuis Modrinth
        # On cherche la version compatible avec le loader et la version de jeu spécifiés
        # Note: Pour simplifier ici, on prend la dernière version disponible du modpack
        # Dans une version avancée, on filtrerait par game_version et loader
        
        headers = {'User-Agent': 'XL-Launcher/1.0 (contact@example.com)'}
        version_url = f"https://api.modrinth.com/v2/project/{modpack_id}/version"
        resp = requests.get(version_url, headers=headers)
        versions = resp.json()
        
        if not versions:
            raise Exception("Aucune version trouvée pour ce modpack")
            
        latest_version = versions[0]
        game_version = latest_version['game_versions'][0]
        loader = latest_version['loaders'][0]
        files = latest_version['files']
        
        # Téléchargement du fichier principal (.mrpack)
        mrpack_url = files[0]['url']
        mrpack_filename = files[0]['filename']
        mrpack_path = os.path.join(MINECRAFT_DIRECTORY, mrpack_filename)
        
        print(json.dumps({"status": "step", "message": f"Téléchargement de {mrpack_filename}..."}))
        sys.stdout.flush()
        
        r = requests.get(mrpack_url, stream=True)
        total_size = int(r.headers.get('content-length', 0))
        block_size = 1024
        wrote = 0
        with open(mrpack_path, 'wb') as f:
            for data in r.iter_content(block_size):
                wrote = wrote + len(data)
                f.write(data)
                # Simple progress for download
                if total_size > 0:
                    percent = int((wrote / total_size) * 100)
                    print(json.dumps({"status": "progress", "percent": percent}))
                    sys.stdout.flush()

        # Installation du modpack (via une lib ou manuellement)
        # Pour l'instant, comme minecraft-launcher-lib ne gère pas nativement .mrpack,
        # on va simuler l'installation en installant la version de base + loader
        # C'est une simplification pour montrer le principe TLauncher
        
        print(json.dumps({"status": "step", "message": f"Installation du moteur {loader} {game_version}..."}))
        sys.stdout.flush()
        
        launch_version_id = game_version
        
        if loader == "fabric":
            launch_version_id = minecraft_launcher_lib.fabric.install_fabric(
                game_version,
                MINECRAFT_DIRECTORY,
                callback=callbacks
            )
        elif loader == "forge":
            forge_ver = minecraft_launcher_lib.forge.find_forge_version(game_version)
            launch_version_id = minecraft_launcher_lib.forge.install_forge_version(
                forge_ver,
                MINECRAFT_DIRECTORY,
                callback=callbacks
            )
            
        # Lancement
        print(json.dumps({"status": "step", "message": "Lancement du jeu..."}))
        sys.stdout.flush()
        
        # Gestion UUID/Token (Microsoft ou Cracké)
        final_uuid = user_uuid if user_uuid else str(uuid.uuid3(uuid.NAMESPACE_DNS, username))
        final_token = access_token if access_token else ""

        options = {
            "username": username,
            "uuid": final_uuid,
            "token": final_token,
            "jvmArguments": [f"-Xmx{max_mem}", f"-Xms{max_mem}"]
        }
        
        # Forcer la langue en Français
        try:
            options_file = os.path.join(MINECRAFT_DIRECTORY, 'options.txt')
            # On lit le fichier existant ou on en crée un
            existing_lines = []
            if os.path.exists(options_file):
                with open(options_file, 'r', encoding='utf-8') as f:
                    existing_lines = f.readlines()
            
            # On met à jour ou ajoute la ligne lang
            lang_found = False
            new_lines = []
            for line in existing_lines:
                if line.startswith("lang:"):
                    new_lines.append("lang:fr_fr\n")
                    lang_found = True
                else:
                    new_lines.append(line)
            
            if not lang_found:
                new_lines.append("lang:fr_fr\n")
                
            with open(options_file, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
                
        except Exception as e:
            print(json.dumps({"status": "step", "message": f"Info: Impossible de configurer la langue ({str(e)})"}))

        command = minecraft_launcher_lib.command.get_minecraft_command(launch_version_id, MINECRAFT_DIRECTORY, options)
        
        subprocess.call(command)
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.stdout.flush()

def install_and_launch(version, username, max_mem="2G", loader="vanilla"):
    # Création du dossier de jeu s'il n'existe pas
    if not os.path.exists(MINECRAFT_DIRECTORY):
        os.makedirs(MINECRAFT_DIRECTORY)
        
    # Force la langue FR avant même l'installation (utile si le dossier existe déjà)
    try:
        options_file = os.path.join(MINECRAFT_DIRECTORY, 'options.txt')
        if not os.path.exists(options_file):
            with open(options_file, 'w') as f:
                f.write("lang:fr_fr\n")
    except:
        pass

    # Déterminer la version réelle à lancer (ex: 1.20.1-forge-x.x.x)
    launch_version_id = version
    
    # Callbacks pour la progression
    current_max = 0
    def set_status(text):
        print(json.dumps({"status": "step", "message": text}))
        sys.stdout.flush()
    
    def set_progress(current):
        if current_max > 0:
            percent = int((current / current_max) * 100)
            print(json.dumps({"status": "progress", "percent": percent}))
            sys.stdout.flush()

    def set_max(max_val):
        nonlocal current_max
        current_max = max_val

    callbacks = {
        "setStatus": set_status,
        "setProgress": set_progress,
        "setMax": set_max
    }

    try:
        # Gestion des modloaders
        launch_version_id = version
        
        # Génération d'un UUID hors ligne cohérent basé sur le pseudo (Standard Minecraft: "OfflinePlayer:Pseudo")
        offline_uuid = str(uuid.uuid3(uuid.NAMESPACE_DNS, "OfflinePlayer:" + username))
        
        if loader == "forge":
            print(json.dumps({"status": "init", "message": f"Recherche de Forge pour {version}..."}))
            sys.stdout.flush()
            
            forge_version = minecraft_launcher_lib.forge.find_forge_version(version)
            if not forge_version:
                 raise Exception(f"Forge non trouvé pour la version {version}")
            
            launch_version_id = minecraft_launcher_lib.forge.install_forge_version(
                forge_version, 
                MINECRAFT_DIRECTORY,
                callback=callbacks
            )
            
        elif loader == "fabric":
            print(json.dumps({"status": "init", "message": f"Installation de Fabric pour {version}..."}))
            sys.stdout.flush()
            
            # Installe la dernière version stable de Fabric pour cette version MC
            launch_version_id = minecraft_launcher_lib.fabric.install_fabric(
                version,
                MINECRAFT_DIRECTORY,
                callback=callbacks
            )
            
            # Installation automatique de Sodium (Optimisation)
            try:
                print(json.dumps({"status": "step", "message": "Installation de Sodium (Boost FPS)..."}))
                sys.stdout.flush()
                
                # Créer le dossier mods s'il n'existe pas
                mods_dir = os.path.join(MINECRAFT_DIRECTORY, 'mods')
                if not os.path.exists(mods_dir):
                    os.makedirs(mods_dir)
                
                # Recherche de Sodium sur Modrinth
                api_url = f"https://api.modrinth.com/v2/project/sodium/version?game_versions=[\"{version}\"]&loaders=[\"fabric\"]"
                response = requests.get(api_url)
                
                if response.status_code == 200:
                    versions = response.json()
                    if versions:
                        # Prendre le premier fichier de la dernière version
                        file_url = versions[0]['files'][0]['url']
                        file_name = versions[0]['files'][0]['filename']
                        file_path = os.path.join(mods_dir, file_name)
                        
                        # Télécharger si pas déjà présent
                        if not os.path.exists(file_path):
                            print(json.dumps({"status": "step", "message": f"Téléchargement de {file_name}..."}))
                            sys.stdout.flush()
                            r = requests.get(file_url)
                            with open(file_path, 'wb') as f:
                                f.write(r.content)
            except Exception as e:
                print(json.dumps({"status": "error", "message": f"Erreur Sodium: {str(e)} (Le jeu se lancera sans)"}))
                sys.stdout.flush()

        else:
            # Vanilla
            print(json.dumps({"status": "init", "message": f"Préparation de la version {version}..."}))
            sys.stdout.flush()
            
            minecraft_launcher_lib.install.install_minecraft_version(
                version=version,
                minecraft_directory=MINECRAFT_DIRECTORY,
                callback=callbacks
            )

        # Force la langue FR avant le lancement
        try:
            options_file = os.path.join(MINECRAFT_DIRECTORY, 'options.txt')
            # On lit le fichier existant ou on en crée un
            existing_lines = []
            if os.path.exists(options_file):
                with open(options_file, 'r', encoding='utf-8') as f:
                    existing_lines = f.readlines()
            
            # On met à jour ou ajoute la ligne lang
            lang_found = False
            new_lines = []
            for line in existing_lines:
                if line.startswith("lang:"):
                    new_lines.append("lang:fr_fr\n")
                    lang_found = True
                else:
                    new_lines.append(line)
            
            if not lang_found:
                new_lines.append("lang:fr_fr\n")
                
            with open(options_file, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
                
        except Exception as e:
            print(json.dumps({"status": "step", "message": f"Info: Impossible de configurer la langue ({str(e)})"}))

        options = {
            "username": username,
            "uuid": offline_uuid,
            "token": offline_uuid, # Utiliser l'UUID comme token pour éviter les erreurs "Invalid Session" sur certains serveurs
            "jvmArguments": [f"-Xmx{max_mem}", f"-Xms{max_mem}"]
        }

    # Tentative de détection du bon Java pour les versions récentes
    # Si on lance du 1.18+, il faut Java 17 ou 21
    # On laisse minecraft-launcher-lib gérer ça, mais on peut aider
    # en spécifiant executablePath si on le connait
    
    # Pour l'instant on laisse 'java' par défaut, mais si l'erreur 
    # "fichier introuvable" apparait, c'est souvent que le runtime java
    # configuré par défaut n'est pas bon.
    
    # On ajoute une option pour utiliser le runtime embarqué si disponible
    # minecraft_launcher_lib peut télécharger le runtime java approprié
    
    # ... code existant ...

        # Lancement
        print(json.dumps({"status": "step", "message": f"Génération de la commande de lancement ({launch_version_id})..."}))
        sys.stdout.flush()
        
        command = minecraft_launcher_lib.command.get_minecraft_command(
            version=launch_version_id,
            minecraft_directory=MINECRAFT_DIRECTORY,
            options=options
        )
        
        print(json.dumps({"status": "success", "message": "Lancement du jeu !"}))
        sys.stdout.flush()

        # Exécuter la commande et attendre qu'elle se termine
        subprocess.run(command)
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "install_modpack":
            # Usage: launcher_backend.py install_modpack <modpack_id> <username> <max_mem>
            modpack_id = sys.argv[2]
            username = sys.argv[3]
            max_mem = sys.argv[4]
            install_modpack(modpack_id, None, username, max_mem)
        else:
            version = sys.argv[1]
            username = sys.argv[2]
            max_mem = sys.argv[3]
            loader = sys.argv[4]
            install_and_launch(version, username, max_mem, loader)