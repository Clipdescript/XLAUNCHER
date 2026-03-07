import sys
import os
import subprocess
import threading
import uuid
import minecraft_launcher_lib
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QLabel, QLineEdit, QPushButton, QComboBox, QProgressBar, QMessageBox)
from PyQt6.QtCore import Qt, pyqtSignal, QObject, pyqtSlot

# Configuration
MINECRAFT_DIRECTORY = os.path.join(os.getcwd(), 'minecraft_game')

class LauncherSignals(QObject):
    progress_update = pyqtSignal(int)
    status_update = pyqtSignal(str)
    versions_loaded = pyqtSignal(list)
    launch_finished = pyqtSignal()
    error_occurred = pyqtSignal(str)

class MinecraftLauncher(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Mon Launcher Minecraft Custom")
        self.setGeometry(300, 300, 400, 350)
        self.setStyleSheet("""
            QMainWindow { background-color: #2b2b2b; color: white; }
            QLabel { color: white; font-size: 14px; }
            QLineEdit { padding: 8px; border-radius: 4px; border: 1px solid #555; background: #3b3b3b; color: white; }
            QPushButton { padding: 10px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; font-weight: bold; }
            QPushButton:hover { background-color: #45a049; }
            QComboBox { padding: 8px; border-radius: 4px; border: 1px solid #555; background: #3b3b3b; color: white; }
            QProgressBar { border: 1px solid #555; border-radius: 4px; text-align: center; }
            QProgressBar::chunk { background-color: #4CAF50; }
        """)

        # Création du dossier de jeu s'il n'existe pas
        if not os.path.exists(MINECRAFT_DIRECTORY):
            os.makedirs(MINECRAFT_DIRECTORY)
        
        # Initialisation des signaux
        self.signals = LauncherSignals()
        self.signals.progress_update.connect(self.update_progress)
        self.signals.status_update.connect(self.update_status)
        self.signals.versions_loaded.connect(self.populate_versions)
        self.signals.launch_finished.connect(self.on_launch_finished)
        self.signals.error_occurred.connect(self.show_error)

        self.init_ui()
        self.load_versions()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)
        layout.setSpacing(15)
        layout.setContentsMargins(30, 30, 30, 30)

        # Titre
        title = QLabel("Minecraft Launcher")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 24px; font-weight: bold; margin-bottom: 10px;")
        layout.addWidget(title)

        # Pseudo
        layout.addWidget(QLabel("Pseudo:"))
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Entrez votre pseudo...")
        layout.addWidget(self.username_input)

        # Version Selector
        layout.addWidget(QLabel("Version:"))
        self.version_combo = QComboBox()
        layout.addWidget(self.version_combo)

        # Progress Bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)

        # Status Label
        self.status_label = QLabel("")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("color: #aaa; font-size: 12px;")
        layout.addWidget(self.status_label)

        # Bouton Jouer
        self.play_btn = QPushButton("JOUER")
        self.play_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.play_btn.clicked.connect(self.launch_game)
        layout.addWidget(self.play_btn)

        layout.addStretch()

    # Slots pour les mises à jour UI
    @pyqtSlot(int)
    def update_progress(self, value):
        self.progress_bar.setValue(value)

    @pyqtSlot(str)
    def update_status(self, text):
        self.status_label.setText(text)

    @pyqtSlot(list)
    def populate_versions(self, versions):
        self.version_combo.addItems(versions)
        self.status_label.setText("Prêt")

    @pyqtSlot()
    def on_launch_finished(self):
        self.play_btn.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.status_label.setText("Prêt")

    @pyqtSlot(str)
    def show_error(self, message):
        self.status_label.setText(f"Erreur: {message}")
        # On ne montre pas de popup bloquante depuis le thread background, 
        # mais ici on est dans le slot main thread donc on pourrait.
        # Pour l'instant on met juste à jour le label pour éviter d'interrompre.

    def load_versions(self):
        self.status_label.setText("Chargement des versions...")
        threading.Thread(target=self._fetch_versions, daemon=True).start()

    def _fetch_versions(self):
        try:
            versions = minecraft_launcher_lib.utils.get_available_versions(MINECRAFT_DIRECTORY)
            release_versions = [v['id'] for v in versions if v['type'] == 'release'][:10]
            self.signals.versions_loaded.emit(release_versions)
        except Exception as e:
            self.signals.error_occurred.emit(str(e))

    def launch_game(self):
        username = self.username_input.text()
        version = self.version_combo.currentText()

        if not username:
            QMessageBox.warning(self, "Erreur", "Veuillez entrer un pseudo.")
            return

        self.play_btn.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.status_label.setText("Préparation du lancement...")

        threading.Thread(target=self._download_and_launch, args=(version, username), daemon=True).start()

    def _download_and_launch(self, version, username):
        options = {
            "username": username,
            "uuid": str(uuid.uuid4()),
            "token": ""
        }

        current_max = 0
        
        # Ces fonctions sont appelées par minecraft_launcher_lib dans le thread background
        # Elles doivent donc émettre des signaux au lieu de toucher l'UI directement
        def set_status(text):
            self.signals.status_update.emit(text)
        
        def set_progress(current):
            if current_max > 0:
                percent = int((current / current_max) * 100)
                self.signals.progress_update.emit(percent)

        def set_max(max_val):
            nonlocal current_max
            current_max = max_val

        callbacks = {
            "setStatus": set_status,
            "setProgress": set_progress,
            "setMax": set_max
        }

        try:
            self.signals.status_update.emit(f"Installation de la version {version}...")
            minecraft_launcher_lib.install.install_minecraft_version(
                version=version,
                minecraft_directory=MINECRAFT_DIRECTORY,
                callback=callbacks
            )

            self.signals.status_update.emit("Lancement du jeu...")
            command = minecraft_launcher_lib.command.get_minecraft_command(
                version=version,
                minecraft_directory=MINECRAFT_DIRECTORY,
                options=options
            )
            
            subprocess.Popen(command)
            self.signals.status_update.emit("Jeu lancé !")
            
        except Exception as e:
            self.signals.error_occurred.emit(str(e))
        finally:
            self.signals.launch_finished.emit()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MinecraftLauncher()
    window.show()
    sys.exit(app.exec())
