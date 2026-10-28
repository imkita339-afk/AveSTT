"""Методы, которые вызывает интерфейс (window.pywebview.api.*)."""
import json
import logging
import os
import subprocess
import threading
import webbrowser

import webview

from . import exporters, models, updater
from .history import History
from .settings import Settings
from .transcriber import AUDIO_EXT, VIDEO_EXT, Engine
from .version import GITHUB_REPO, __version__

log = logging.getLogger("avestt")

LANGUAGES = [
    ("auto", "Определить автоматически"), ("ru", "Русский"), ("en", "Английский"), ("uk", "Украинский"),
    ("be", "Белорусский"), ("kk", "Казахский"), ("uz", "Узбекский"), ("de", "Немецкий"), ("fr", "Французский"),
    ("es", "Испанский"), ("it", "Итальянский"), ("pt", "Португальский"), ("pl", "Польский"), ("tr", "Турецкий"),
    ("zh", "Китайский"), ("ja", "Японский"), ("ko", "Корейский"), ("ar", "Арабский"), ("hi", "Хинди"),
    ("nl", "Нидерландский"), ("cs", "Чешский"), ("sv", "Шведский"), ("fi", "Финский"), ("he", "Иврит"),
    ("hy", "Армянский"), ("ka", "Грузинский"), ("az", "Азербайджанский"), ("ro", "Румынский"),
]


class Api:
    def __init__(self):
        self._window = None
        self._ready = False
        self._settings = Settings()
        self._history = History()
        self._engine = Engine(self._emit, self._settings, self._history)
        self._downloads = models.Downloads(self._emit)
        self._updater = updater.Updater(self._emit)
        self._update_info = None
        self._update_path = None

    # ---------- служебное ----------
    def _attach(self, window):
        self._window = window

    def _emit(self, kind, data):
        if not (self._window and self._ready):
            return
        try:
            payload = json.dumps({"type": kind, "data": data}, ensure_ascii=False)
            self._window.evaluate_js(f"window.AveSTT && window.AveSTT.onEvent({payload})")
        except Exception:
            log.debug("emit failed", exc_info=True)

    def _on_drop(self, event):
        files = (event.get("dataTransfer") or {}).get("files") or []
        paths = [f.get("pywebviewFullPath") for f in files if f.get("pywebviewFullPath")]
        if paths:
            self._emit("files_added", self._engine.add(paths))

    # ---------- общее состояние ----------
    def ready(self):
        self._ready = True
        if self._settings.get("auto_update_check"):
            threading.Thread(target=self._auto_check, daemon=True).start()
        return True

    def get_state(self):
        return {
            "version": __version__,
            "repo": GITHUB_REPO,
            "settings": self._settings.all(),
            "languages": LANGUAGES,
            "models": models.list_models(self._downloads.snapshot()),
            "jobs": self._engine.jobs(),
            "busy": self._engine.busy,
            "cpu_count": os.cpu_count() or 4,
            "formats": {"audio": sorted(AUDIO_EXT), "video": sorted(VIDEO_EXT)},
        }

    def set_settings(self, values):
        return self._settings.update(values or {})

    # ---------- файлы и очередь ----------
    def pick_files(self):
        exts = ";".join(f"*.{e}" for e in sorted(AUDIO_EXT | VIDEO_EXT))
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=True,
            file_types=(f"Аудио и видео ({exts})", "Все файлы (*.*)"))
        return self._engine.add(list(result or []))

    def add_paths(self, paths):
        return self._engine.add(paths or [])

    def start(self):
        self._engine.start()
        return True

    def cancel(self, job_id=None):
        self._engine.cancel(job_id)

    def retry(self, job_id):
        self._engine.retry(job_id)
        self._engine.start()

    def remove_job(self, job_id):
        self._engine.remove(job_id)
        return self._engine.jobs()

    def clear_finished(self):
        self._engine.clear_finished()
        return self._engine.jobs()

    # ---------- история ----------
    def get_history(self):
        return self._history.list()

    def get_item(self, item_id):
        return self._history.get(item_id)

    def update_segment(self, item_id, index, text):
        return self._history.update_segment(item_id, int(index), text)

    def rename_item(self, item_id, name):
        return self._history.rename(item_id, name)

    def delete_item(self, item_id):
        self._history.delete(item_id)
        return True

    def export(self, item_id, fmt, timestamps=False):
        item = self._history.get(item_id)
        if not item or fmt not in exporters.FORMATS:
            return {"ok": False, "error": "Запись не найдена"}
        directory = os.path.dirname(item.get("source") or "") or os.path.expanduser("~\\Documents")
        if not os.path.isdir(directory):
            directory = os.path.expanduser("~\\Documents")
        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE, directory=directory,
            save_filename=f"{item['name']}.{fmt}", file_types=(exporters.FORMATS[fmt],))
        if not result:
            return {"ok": False, "cancelled": True}
        path = result if isinstance(result, str) else result[0]
        if not path.lower().endswith("." + fmt):
            path += "." + fmt
        try:
            exporters.export(item, fmt, path, bool(timestamps))
        except OSError as e:
            return {"ok": False, "error": f"Не удалось сохранить файл: {e}"}
        return {"ok": True, "path": path}

    def get_text(self, item_id, timestamps=False):
        item = self._history.get(item_id)
        return exporters.to_txt(item, bool(timestamps)) if item else ""

    def reveal(self, path):
        if path and os.path.exists(path):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])

    def open_url(self, url):
        if url and url.startswith("https://"):
            webbrowser.open(url)

    # ---------- модели ----------
    def get_models(self):
        return models.list_models(self._downloads.snapshot())

    def download_model(self, model_id):
        return self._downloads.start(model_id)

    def cancel_download(self, model_id):
        self._downloads.cancel(model_id)

    def delete_model(self, model_id):
        if self._engine.busy and self._settings.get("model") == model_id:
            return {"ok": False, "error": "Модель сейчас используется. Дождитесь окончания расшифровки."}
        return {"ok": models.delete(model_id)}

    # ---------- обновления ----------
    def _auto_check(self):
        try:
            info = updater.check()
            self._update_info = info
            if info.get("available"):
                self._emit("update_available", info)
        except Exception:
            log.info("auto update check failed", exc_info=True)

    def check_update(self):
        try:
            self._update_info = updater.check()
            return {"ok": True, **self._update_info}
        except Exception as e:
            return {"ok": False, "error": "Нет подключения к интернету или GitHub недоступен.", "detail": str(e)}

    def download_update(self):
        if not (self._update_info and self._update_info.get("available")):
            return False
        self._updater.download(self._update_info)
        return True

    def cancel_update(self):
        self._updater.cancel()

    def install_update(self, path):
        if not path or not os.path.isfile(path):
            return False
        self._engine.cancel()
        updater.launch_installer(path)
        threading.Timer(0.5, self._window.destroy).start()
        return True
