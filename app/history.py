"""История расшифровок: по одному JSON-файлу на запись + индекс для быстрого списка."""
import json
import os
import threading
import uuid
from datetime import datetime

from .paths import HISTORY_DIR

INDEX_FILE = HISTORY_DIR / "index.json"
META_KEYS = ("id", "name", "source", "created", "duration", "language", "model", "task", "preview")


def _write_json(path, data):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


class History:
    def __init__(self):
        self._lock = threading.Lock()
        try:
            with open(INDEX_FILE, encoding="utf-8") as f:
                self._index = json.load(f)
        except (OSError, ValueError):
            self._index = self._rebuild()

    def _rebuild(self):
        index = []
        for p in HISTORY_DIR.glob("*.json"):
            if p == INDEX_FILE:
                continue
            try:
                with open(p, encoding="utf-8") as f:
                    item = json.load(f)
                index.append(self._meta(item))
            except (OSError, ValueError):
                pass
        index.sort(key=lambda m: m["created"], reverse=True)
        return index

    @staticmethod
    def _meta(item):
        text = " ".join(s["text"].strip() for s in item["segments"][:12])
        item["preview"] = text[:220]
        return {k: item.get(k) for k in META_KEYS}

    def _save_index(self):
        _write_json(INDEX_FILE, self._index)

    def list(self):
        with self._lock:
            return list(self._index)

    def add(self, name, source, duration, language, model, task, segments):
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name,
            "source": source,
            "created": datetime.now().isoformat(timespec="seconds"),
            "duration": duration,
            "language": language,
            "model": model,
            "task": task,
            "segments": segments,
        }
        with self._lock:
            meta = self._meta(item)
            _write_json(HISTORY_DIR / f"{item['id']}.json", item)
            self._index.insert(0, meta)
            self._save_index()
        return item

    def get(self, item_id):
        try:
            with open(HISTORY_DIR / f"{os.path.basename(item_id)}.json", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def update_segment(self, item_id, index, text):
        with self._lock:
            item = self.get(item_id)
            if not item or not (0 <= index < len(item["segments"])):
                return False
            item["segments"][index]["text"] = text
            _write_json(HISTORY_DIR / f"{item_id}.json", item)
            meta = self._meta(item)
            self._index = [meta if m["id"] == item_id else m for m in self._index]
            self._save_index()
            return True

    def rename(self, item_id, name):
        with self._lock:
            item = self.get(item_id)
            if not item:
                return False
            item["name"] = name
            _write_json(HISTORY_DIR / f"{item_id}.json", item)
            for m in self._index:
                if m["id"] == item_id:
                    m["name"] = name
            self._save_index()
            return True

    def delete(self, item_id):
        with self._lock:
            try:
                os.remove(HISTORY_DIR / f"{os.path.basename(item_id)}.json")
            except OSError:
                pass
            self._index = [m for m in self._index if m["id"] != item_id]
            self._save_index()
