import json
import os
import threading

from .paths import SETTINGS_FILE

DEFAULTS = {
    "theme": "system",          # light | dark | system
    "model": "small",
    "language": "auto",
    "task": "transcribe",       # transcribe | translate
    "threads": max(2, (os.cpu_count() or 4) // 2),
    "vad": True,                # пропускать тишину
    "txt_timestamps": False,
    "autosave_txt": False,      # сохранять .txt рядом с исходным файлом
    "auto_update_check": True,
}


class Settings:
    def __init__(self):
        self._lock = threading.Lock()
        self._data = dict(DEFAULTS)
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                saved = json.load(f)
            self._data.update({k: v for k, v in saved.items() if k in DEFAULTS})
        except (OSError, ValueError):
            pass

    def get(self, key):
        with self._lock:
            return self._data.get(key, DEFAULTS.get(key))

    def all(self):
        with self._lock:
            return dict(self._data)

    def update(self, values):
        with self._lock:
            for k, v in values.items():
                if k in DEFAULTS:
                    self._data[k] = v
            tmp = SETTINGS_FILE.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, SETTINGS_FILE)
            return dict(self._data)
