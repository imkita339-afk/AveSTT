"""Все пути приложения в одном месте."""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)

if FROZEN:
    # Папка установки (рядом с AveSTT.exe) и папка с ресурсами PyInstaller
    APP_DIR = Path(sys.executable).resolve().parent
    RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
    BUNDLED_MODELS_DIR = APP_DIR / "models"
else:
    APP_DIR = Path(__file__).resolve().parent.parent
    RES_DIR = APP_DIR
    BUNDLED_MODELS_DIR = APP_DIR / "bundle" / "models"

UI_DIR = RES_DIR / "ui"

# Пользовательские данные: настройки, история, скачанные модели
DATA_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "AveSTT"
USER_MODELS_DIR = DATA_DIR / "models"
HISTORY_DIR = DATA_DIR / "history"
UPDATES_DIR = DATA_DIR / "updates"
SETTINGS_FILE = DATA_DIR / "settings.json"
LOG_FILE = DATA_DIR / "avestt.log"

for _d in (DATA_DIR, USER_MODELS_DIR, HISTORY_DIR, UPDATES_DIR):
    _d.mkdir(parents=True, exist_ok=True)
