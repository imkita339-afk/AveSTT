"""Каталог моделей Whisper, их поиск на диске и скачивание."""
import json
import shutil
import threading
import urllib.request

from .paths import BUNDLED_MODELS_DIR, USER_MODELS_DIR

CATALOG = [
    {"id": "tiny", "name": "Tiny", "repo": "Systran/faster-whisper-tiny", "size_mb": 75,
     "quality": 1, "speed": 5, "desc": "Самая быстрая. Подходит для черновиков и слабых компьютеров."},
    {"id": "base", "name": "Base", "repo": "Systran/faster-whisper-base", "size_mb": 145,
     "quality": 2, "speed": 4, "desc": "Быстрая, качество немного лучше Tiny."},
    {"id": "small", "name": "Small", "repo": "Systran/faster-whisper-small", "size_mb": 484,
     "quality": 3, "speed": 3, "desc": "Баланс скорости и качества. Встроена в программу."},
    {"id": "medium", "name": "Medium", "repo": "Systran/faster-whisper-medium", "size_mb": 1530,
     "quality": 4, "speed": 2, "desc": "Хорошее качество, работает заметно медленнее."},
    {"id": "large-v3-turbo", "name": "Large v3 Turbo", "repo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
     "size_mb": 1620, "quality": 5, "speed": 3, "desc": "Рекомендуем: почти максимальное качество при хорошей скорости."},
    {"id": "large-v3", "name": "Large v3", "repo": "Systran/faster-whisper-large-v3", "size_mb": 3090,
     "quality": 5, "speed": 1, "desc": "Максимальное качество, самая медленная и тяжёлая."},
]
BY_ID = {m["id"]: m for m in CATALOG}

# Если huggingface.co недоступен, пробуем зеркало
HOSTS = ["https://huggingface.co", "https://hf-mirror.com"]
USER_AGENT = "AveSTT"


def _is_model_dir(path):
    return (path / "model.bin").is_file() and (path / "config.json").is_file()


def find(model_id):
    """Путь к папке модели или None, если она не установлена."""
    for base in (USER_MODELS_DIR, BUNDLED_MODELS_DIR):
        p = base / model_id
        if _is_model_dir(p):
            return p
    return None


def list_models(downloads):
    result = []
    for m in CATALOG:
        path = find(m["id"])
        item = dict(m)
        item["installed"] = path is not None
        item["bundled"] = path is not None and path.parent == BUNDLED_MODELS_DIR
        item["download"] = downloads.get(m["id"])
        result.append(item)
    return result


def installed_ids():
    return [m["id"] for m in CATALOG if find(m["id"])]


def delete(model_id):
    p = USER_MODELS_DIR / model_id
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)
        return True
    return False


class Cancelled(Exception):
    pass


def _open(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def _file_list(host, repo):
    with _open(f"{host}/api/models/{repo}/tree/main") as r:
        tree = json.load(r)
    files = [(f["path"], int(f.get("size") or 0)) for f in tree if f.get("type") == "file"]
    wanted = [f for f in files if f[0].endswith((".bin", ".json", ".txt")) and not f[0].startswith(".")]
    if not any(name == "model.bin" for name, _ in wanted):
        raise RuntimeError("В репозитории модели нет model.bin")
    return wanted


def download(model_id, on_progress, cancel_event):
    """Скачивает модель в USER_MODELS_DIR. on_progress(done_bytes, total_bytes)."""
    m = BY_ID[model_id]
    target = USER_MODELS_DIR / model_id
    tmp = USER_MODELS_DIR / (model_id + ".part")
    last_error = None
    for host in HOSTS:
        try:
            files = _file_list(host, m["repo"])
            total = sum(size for _, size in files) or m["size_mb"] * 1024 * 1024
            tmp.mkdir(parents=True, exist_ok=True)
            done = 0
            for name, size in files:
                dest = tmp / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                # Докачка: уже скачанный целиком файл пропускаем
                if size and dest.is_file() and dest.stat().st_size == size:
                    done += size
                    on_progress(done, total)
                    continue
                with _open(f"{host}/{m['repo']}/resolve/main/{name}", timeout=60) as r, open(dest, "wb") as f:
                    while True:
                        if cancel_event.is_set():
                            raise Cancelled()
                        chunk = r.read(1024 * 256)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        on_progress(done, total)
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            tmp.rename(target)
            return target
        except Cancelled:
            raise
        except Exception as e:  # сеть, 404, блокировка — пробуем следующий хост
            last_error = e
    raise RuntimeError(f"Не удалось скачать модель: {last_error}")


class Downloads:
    """Фоновые загрузки моделей с отчётом о прогрессе."""

    def __init__(self, emit):
        self._emit = emit
        self._state = {}
        self._cancel = {}
        self._lock = threading.Lock()

    def snapshot(self):
        with self._lock:
            return {k: dict(v) for k, v in self._state.items()}

    def start(self, model_id):
        if model_id not in BY_ID:
            return False
        with self._lock:
            if model_id in self._state:
                return True
            self._state[model_id] = {"done": 0, "total": BY_ID[model_id]["size_mb"] * 1024 * 1024}
            self._cancel[model_id] = threading.Event()
        threading.Thread(target=self._run, args=(model_id,), daemon=True).start()
        return True

    def cancel(self, model_id):
        with self._lock:
            ev = self._cancel.get(model_id)
        if ev:
            ev.set()

    def _run(self, model_id):
        last = [0]

        def progress(done, total):
            with self._lock:
                self._state[model_id] = {"done": done, "total": total}
            # Не чаще ~раза в 1 МБ, чтобы не заваливать интерфейс событиями
            if done - last[0] >= 1024 * 1024 or done >= total:
                last[0] = done
                self._emit("model_progress", {"id": model_id, "done": done, "total": total})

        ok, error = False, None
        try:
            download(model_id, progress, self._cancel[model_id])
            ok = True
        except Cancelled:
            error = "cancelled"
        except Exception as e:
            error = str(e)
        with self._lock:
            self._state.pop(model_id, None)
            self._cancel.pop(model_id, None)
        self._emit("model_done", {"id": model_id, "ok": ok, "error": error})
