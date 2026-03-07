// Logique UI
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const versionSelect = document.getElementById('version');
const statusText = document.getElementById('statusText');
const percentText = document.getElementById('percentText');
const progressBar = document.getElementById('progressBar');
const progressOverlay = document.getElementById('progressOverlay');
const playBtn = document.getElementById('playBtn');

const tlModsBtn = document.getElementById('tlModsBtn');
const modsOverlay = document.getElementById('modsOverlay');
const closeModsBtn = document.getElementById('closeModsBtn');

// Gestion TL Mods
let modpacksLoaded = false;
const modpacksList = document.getElementById('modpacksList');

tlModsBtn.addEventListener('click', async () => {
    modsOverlay.style.display = 'block';
    
    if (!modpacksLoaded) {
        try {
            modpacksList.innerHTML = '<p style="color: #aaa;">Chargement des modpacks...</p>';
            const modpacks = await window.api.getModpacks();
            
            if (modpacks && modpacks.length > 0) {
                modpacksList.innerHTML = '';
                modpacks.forEach(pack => {
                    const card = document.createElement('div');
                    card.style.cssText = 'background: #333; border: 1px solid #444; border-radius: 5px; overflow: hidden; display: flex; flex-direction: column; min-height: 250px;';
                    
                    const iconUrl = pack.icon_url ? pack.icon_url : '';
                    const iconHtml = iconUrl 
                        ? `<img src="${iconUrl}" style="width: 100%; height: 100%; object-fit: cover; position: relative; z-index: 1;" onerror="this.style.display='none'">` 
                        : '';
                    
                    card.innerHTML = `
                        <div style="height: 140px; background: #eee; display: flex; align-items: center; justify-content: center; position: relative;">
                            ${iconHtml}
                            <i class="fas fa-box-open" style="font-size: 40px; color: #ccc; position: absolute; z-index: 0;"></i>
                        </div>
                        <div style="padding: 15px; flex: 1; display: flex; flex-direction: column;">
                            <h3 style="margin: 0 0 5px 0; font-size: 16px;">${pack.title}</h3>
                            <p style="font-size: 12px; color: #666; margin: 0 0 10px 0; flex: 1; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${pack.description}</p>
                            <button class="install-modpack-btn" data-slug="${pack.slug}" data-title="${pack.title}" style="width: 100%; padding: 8px; background: #4CAF50; border: none; color: white; cursor: pointer; border-radius: 3px; margin-top: auto;"><i class="fas fa-download"></i> INSTALLER</button>
                        </div>
                    `;
                    modpacksList.appendChild(card);
                });
                
                // On attache les écouteurs sur le conteneur parent (délégation d'événements)
                // car si on recharge la liste, on perd les écouteurs précédents
                modpacksList.addEventListener('click', async (e) => {
                    if (e.target && e.target.classList.contains('install-modpack-btn')) {
                        const btn = e.target;
                        const slug = btn.getAttribute('data-slug');
                        const title = btn.getAttribute('data-title');
                        const username = document.getElementById('username').value;
                        const minMem = document.getElementById('minMem').value;
                        const maxMem = document.getElementById('maxMem').value;
                        
                        if (!username) {
                            alert("Veuillez entrer un pseudo avant d'installer.");
                            return;
                        }

                        if(confirm(`Voulez-vous installer et lancer le modpack "${title}" ?\nCela peut prendre du temps.`)) {
                             modsOverlay.style.display = 'none';
                             playBtn.disabled = true;
                             playBtn.textContent = "INSTALLATION...";
                             progressOverlay.style.display = 'block';
                             progressBar.style.width = '0%';
                             percentText.textContent = '0%';
                             statusText.textContent = `Installation de ${title}...`;
                             
                             try {
                                 // On appelle launchGame avec le paramètre modpack
                                 const result = await window.api.launchGame({
                                     username,
                                     modpack: slug, 
                                     minMem,
                                     maxMem
                                 });
                                 
                                 // launchGame ne retourne rien directement ici car c'est géré par les events
                                 // mais si c'était le cas on gérerait le retour
                             } catch (error) {
                                 console.error(error);
                                 alert("Erreur lors du lancement de l'installation.");
                                 resetUI();
                             }
                        }
                    }
                });
                
                modpacksLoaded = true;
            } else {
                modpacksList.innerHTML = '<p style="color: #ff5252;">Aucun modpack trouvé.</p>';
            }
        } catch (error) {
            console.error(error);
            modpacksList.innerHTML = '<p style="color: #ff5252;">Erreur de chargement.</p>';
        }
    }
});

closeModsBtn.addEventListener('click', () => {
    modsOverlay.style.display = 'none';
});

// Gestion des paramètres (Popup)
settingsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
});

document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsToggle) {
        settingsPanel.style.display = 'none';
    }
});

// Chargement des versions au démarrage
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const versions = await window.api.getVersions();
        
        if (versions && versions.length > 0) {
            versionSelect.innerHTML = '';
            versions.forEach(v => {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = v.id; // Juste le numéro de version
                versionSelect.appendChild(option);
            });
            // Sélectionner la première version (la plus récente)
            versionSelect.selectedIndex = 0;
        } else {
            const option = document.createElement('option');
            option.textContent = "Erreur chargement versions";
            versionSelect.appendChild(option);
        }
    } catch (e) {
        console.error(e);
        versionSelect.innerHTML = '<option>Erreur réseau</option>';
    }
});

playBtn.addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const version = versionSelect.value;
    const loader = document.getElementById('modLoader').value;
    const minMem = document.getElementById('minMem').value;
    const maxMem = document.getElementById('maxMem').value;
    const javaPath = document.getElementById('javaPath').value;

    if (!username) {
        alert("Veuillez entrer un pseudo.");
        return;
    }

    // UI Update
    playBtn.disabled = true;
    playBtn.textContent = "CHARGEMENT...";
    progressOverlay.style.display = 'block';
    progressBar.style.width = '0%';
    percentText.textContent = '0%';
    statusText.textContent = 'Préparation...';

    try {
        const result = await window.api.launchGame({
            username,
            version,
            loader,
            minMem,
            maxMem,
            javaPath
        });

        if (!result.success) {
            alert("Erreur: " + result.error);
            resetUI();
        }
    } catch (error) {
        alert("Erreur critique: " + error);
        resetUI();
    }
});

function resetUI() {
    playBtn.disabled = false;
    playBtn.textContent = "JOUER";
    progressOverlay.style.display = 'none';
}

// Écouteurs IPC
window.api.onLog((data) => {
    console.log(data);
    if (typeof data === 'string') {
        if (data.includes('[INFO]')) {
            statusText.textContent = data.replace('[INFO] ', '');
        } else if (data.includes('[ERREUR]')) {
            statusText.textContent = "Erreur !";
            alert(data);
            resetUI();
        } else if (data.includes('[STOP]')) {
            resetUI();
        }
    }
});

window.api.onProgress((data) => {
    if (data && data.total) {
        const percent = Math.round((data.current / data.total) * 100);
        progressBar.style.width = percent + "%";
        percentText.textContent = percent + "%";
        statusText.textContent = `Téléchargement en cours...`;
    }
});