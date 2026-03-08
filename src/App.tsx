import React, { useState, useEffect } from 'react';
import './App.css';
import logoIcon from './assets/Logo.ico';

// Types pour l'API exposée par preload.js
interface IElectronAPI {
  launchGame: (options: any) => Promise<any>;
  getVersions: () => Promise<any[]>;
  getModpacks: () => Promise<any[]>;
  loginMicrosoft: () => Promise<any>;
  onLog: (callback: (data: string) => void) => void;
  onProgress: (callback: (data: any) => void) => void;
  onUpdateStatus: (callback: (data: { status: string }) => void) => void;
  onUpdateProgress: (callback: (data: { percent: number, transferred: number, total: number }) => void) => void;
  restartApp: () => Promise<void>;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}

const App: React.FC = () => {
  const [username, setUsername] = useState('Steve');
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loader, setLoader] = useState('vanilla');
  const [minMem, setMinMem] = useState('1G');
  const [maxMem, setMaxMem] = useState('4G');
  
  const [modpacks, setModpacks] = useState<any[]>([]);
  const [showModpacks, setShowModpacks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);

  // États pour la mise à jour
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  useEffect(() => {
    // Vérification de sécurité pour éviter le crash si l'API n'est pas chargée
    if (!window.api) {
        console.error("L'API Electron n'est pas disponible !");
        return;
    }

    // Chargement initial des versions
    window.api.getVersions().then((vers) => {
      setVersions(vers);
      if (vers.length > 0) setSelectedVersion(vers[0].id);
    }).catch(err => console.error("Erreur chargement versions:", err));

    // Listeners
    window.api.onProgress((data) => {
      setProgress(data.current);
      setStatus(data.task || 'En cours...');
    });

    window.api.onLog((msg) => {
      console.log(msg);
      setLogs(prev => [...prev.slice(-50), msg]);
    });

    // Listeners Mise à jour
    window.api.onUpdateStatus((data) => {
      if (data.status === 'available') {
        setUpdateAvailable(true);
        setStatus("Mise à jour disponible...");
      } else if (data.status === 'downloaded') {
        setUpdateDownloaded(true);
        setUpdateAvailable(false);
        setStatus("Mise à jour prête !");
        setUpdateProgress(100);
      }
    });

    window.api.onUpdateProgress((data) => {
      setUpdateAvailable(true);
      setUpdateProgress(Math.round(data.percent));
      setStatus(`Téléchargement màj: ${Math.round(data.percent)}%`);
    });

  }, []);

  const handleRestart = async () => {
    await window.api.restartApp();
  };

  const handleLaunch = async () => {
    if (!username) return alert("Pseudo requis !");
    
    setIsLaunching(true);
    setStatus("Préparation...");
    setProgress(0);

    try {
      await window.api.launchGame({
        username,
        version: selectedVersion,
        loader,
        minMem,
        maxMem
      });
    } catch (e: any) {
      alert("Erreur: " + e.message);
      setIsLaunching(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setStatus("Connexion Microsoft...");
    const result = await window.api.loginMicrosoft();
    if (result.success) {
      setUserProfile(result.profile);
      setUsername(result.profile.name);
      alert(`Connecté en tant que ${result.profile.name}`);
    } else {
      alert("Erreur connexion: " + result.error);
    }
    setStatus("");
  };

  const loadModpacks = async () => {
    setShowModpacks(true);
    if (modpacks.length === 0) {
      const packs = await window.api.getModpacks();
      setModpacks(packs);
    }
  };

  const reloadApp = () => {
    window.location.reload();
  };

  const installModpack = async (pack: any) => {
    if (!confirm(`Installer ${pack.title} ?`)) return;
    
    setShowModpacks(false);
    setIsLaunching(true);
    setStatus(`Installation de ${pack.title}...`);
    
    try {
      await window.api.launchGame({
        username,
        modpack: pack.slug,
        minMem,
        maxMem
      });
    } catch (e: any) {
      alert("Erreur: " + e.message);
      setIsLaunching(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <img src={logoIcon} alt="Logo" className="app-logo" />
          <span className="app-title">Prism Launcher</span>
        </div>
        <nav className="nav-links">
          <a onClick={reloadApp} title="Recharger la page"><i className="fas fa-sync-alt"></i></a>
          <a onClick={loadModpacks}><i className="fas fa-cubes"></i> MODPACKS</a>
          <a><i className="fas fa-tshirt"></i> SKINS</a>
          <a><i className="fas fa-server"></i> SERVEURS</a>
          <a><i className="fas fa-question-circle"></i> AIDE</a>
        </nav>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Modpacks Overlay */}
        {showModpacks && (
          <div className="overlay-panel">
            <div className="overlay-header">
              <h2>Modpacks (Modrinth)</h2>
              <button className="close-btn" onClick={() => setShowModpacks(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modpacks-grid">
              {modpacks.length === 0 ? <p>Chargement...</p> : modpacks.map(pack => (
                <div key={pack.slug} className="modpack-card">
                  <div className="card-image">
                    {pack.icon_url ? <img src={pack.icon_url} alt={pack.title} /> : <i className="fas fa-box-open placeholder-icon"></i>}
                  </div>
                  <div className="card-info">
                    <h3>{pack.title}</h3>
                    <p>{pack.description}</p>
                    <button className="install-btn" onClick={() => installModpack(pack)}>
                      <i className="fas fa-download"></i> INSTALLER
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Area (News) */}
        <div className="content-area">
          <div className="news-block">
            <h3>Minecraft 1.21.11 - Mounts of Mayhem</h3>
            <span className="release-date">Date de sortie : 15 janvier 2026</span>
            
            <h4>Nouvelles Armes : Les Lances (Spears)</h4>
            <p>- Une nouvelle arme de portée ! Maintenez pour charger et relâchez pour infliger des dégâts, du recul et désarçonner les ennemis montés.</p>
            <p>- Nouvel enchantement "Lunge" (Fente) : Propulse le joueur vers l'avant lors d'une attaque chargée.</p>
            
            <h4>Nautilus et Vie Marine</h4>
            <p>- Ajout des créatures Nautilus et Zombie Nautilus dans les océans.</p>
            <p>- Nouvelle Armure de Nautilus offrant des effets uniques sous l'eau.</p>
            
            <h4>Montures et Améliorations</h4>
            <p>- Les Chevaux Zombies peuvent désormais être apprivoisés, équipés de selles et d'armures !</p>
            <p>- Ajout de l'Armure pour Cheval en Netherite : La protection ultime pour votre fidèle destrier, l'immunisant contre le feu et la lave.</p>
            <p>- Nouveaux mobs : Chameaux Husks et Parched.</p>
          </div>
        </div>

        {/* Sidebar Right */}
        <div className="sidebar-right">
          <div className="sidebar-title">
            <h2>PRISM LAUNCHER</h2>
            <span>LAUNCHER POUR MINECRAFT</span>
          </div>
          
          <button className="sidebar-btn"><i className="fas fa-play"></i> COMMENT JOUER ?</button>
          <button className="sidebar-btn"><i className="fas fa-question"></i> AIDE</button>
          <button className="sidebar-btn"><i className="fas fa-star"></i> INSTALLER SKIN</button>
          <button className="sidebar-btn"><i className="fas fa-star"></i> CAPES ANIMÉES</button>
          
          <button className="sidebar-btn orange">XL | PRISM-LAUNCHER.ORG</button>
          <button className="sidebar-btn blue">FB | PAGE FACEBOOK</button>
          
          <div className="sidebar-banner premium">
            <span>Prism Launcher PREMIUM</span>
          </div>
          
          <div className="sidebar-banner discord">
            <i className="fab fa-discord"></i>
            <span>REJOIGNEZ-NOUS !</span>
          </div>
        </div>
      </main>

      {/* Progress Bar */}
      {(isLaunching || updateAvailable || updateDownloaded) && (
        <div className="progress-bar-container">
          <div className="progress-info">
            <span>{status}</span>
            <span>{updateAvailable || updateDownloaded ? `${updateProgress}%` : `${progress}%`}</span>
          </div>
          <div className="progress-track">
            <div 
              className="progress-fill" 
              style={{ width: `${updateAvailable || updateDownloaded ? updateProgress : progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-popup">
          <div className="setting-group">
            <label>Mémoire RAM (Min/Max)</label>
            <div className="row">
              <input value={minMem} onChange={e => setMinMem(e.target.value)} placeholder="1G" />
              <input value={maxMem} onChange={e => setMaxMem(e.target.value)} placeholder="4G" />
            </div>
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      <footer className="bottom-bar">
        <div className="input-group">
          <input 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            placeholder="Nom d'utilisateur" 
            disabled={!!userProfile}
            className="user-input"
          />
          <div className="checkbox-row">
            <label className="checkbox-container">
              <input type="checkbox" checked={!!userProfile} readOnly />
              <span className="checkmark"></span>
              Comptes
            </label>
            {userProfile && <span className="account-name">{userProfile.name}</span>}
          </div>
        </div>

        <div className="version-group">
          <select value={selectedVersion} onChange={e => setSelectedVersion(e.target.value)} className="version-select">
            {versions.length === 0 && <option>Dernière version 1.21.5</option>}
            {versions.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}
          </select>
          <div className="checkbox-row">
            <label className="checkbox-container">
              <input type="checkbox" />
              <span className="checkmark"></span>
              Forcer la mise à jour
            </label>
          </div>
        </div>

        <button 
          className="play-btn" 
          onClick={updateDownloaded ? handleRestart : handleLaunch}
          disabled={isLaunching || updateAvailable}
          style={updateDownloaded ? { backgroundColor: '#e74c3c' } : {}}
        >
          {isLaunching ? 'LANCEMENT...' : 
           updateAvailable ? 'TÉLÉCHARGEMENT...' : 
           updateDownloaded ? 'REDÉMARRER' : 
           'Entrer dans le jeu'}
        </button>

        <div className="tools-group">
          <button className="tool-btn" onClick={() => setShowSettings(!showSettings)} title="Paramètres">
             <i className="fas fa-cog"></i>
          </button>
          <button className="tool-btn" title="Dossier du jeu">
             <i className="fas fa-folder"></i>
          </button>
          <button className="tool-btn" onClick={reloadApp} title="Rafraîchir">
             <i className="fas fa-sync-alt"></i>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
