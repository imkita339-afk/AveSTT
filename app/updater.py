"""Обновление программы из GitHub Releases.

В каждом релизе (тег вида v1.2.3) лежат два установщика:
  AveSTT-Setup-x.y.z.exe   — полный, со встроенной моделью (для первой установки)
  AveSTT-Update-x.y.z.exe  — лёгкий, без модели (для обновления)
"""
import json
import os
import re
import subprocess
import threading
import urllib.request

from .paths import UPDATES_DIR
from .version import GITHUB_REPO, __version__

API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def parse_version(v):
    nums = re.findall(r"\d+", v or "")
    return tuple(int(n) for n in nums[:3]) + (0,) * (3 - len(nums[:3]))


def _pick_asset(assets):
    exes = [a for a in assets if a.get("name", "").lower().endswith(".exe")]
    for key in ("update", "setup"):
        for a in exes:
            if key in a["name"].lower():
                return a
    return exes[0] if exes else None


def check():
    req = urllib.request.Request(API_URL, headers={
        "User-Agent": "AveSTT", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rel = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"available": False, "current": __version__, "latest": None,
                    "message": "Опубликованных версий пока нет."}
        raise
    latest = rel.get("tag_name", "").lstrip("vV")
    asset = _pick_asset(rel.get("assets", []))
    available = parse_version(latest) > parse_version(__version__) and asset is not None
    return {
        "available": available,
        "current": __version__,
        "latest": latest,
        "notes": rel.get("body") or "",
        "published": rel.get("published_at"),
        "url": asset["browser_download_url"] if asset else None,
        "asset_name": asset["name"] if asset else None,
        "size": asset.get("size") if asset else None,
        "page": rel.get("html_url"),
    }


class Updater:
    def __init__(self, emit):
        self._emit = emit
        self._cancel = threading.Event()
        self._thread = None

    def download(self, info):
        if self._thread and self._thread.is_alive():
            return
        self._cancel.clear()
        self._thread = threading.Thread(target=self._run, args=(info,), daemon=True)
        self._thread.start()

    def cancel(self):
        self._cancel.set()

    def _run(self, info):
        dest = UPDATES_DIR / info["asset_name"]
        part = dest.with_suffix(".part")
        try:
            req = urllib.request.Request(info["url"], headers={"User-Agent": "AveSTT"})
            with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
                total = int(r.headers.get("Content-Length") or info.get("size") or 0)
                done, last = 0, 0
                while True:
                    if self._cancel.is_set():
                        raise InterruptedError()
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if done - last > 512 * 1024:
                        last = done
                        self._emit("update_progress", {"done": done, "total": total})
            if total and done != total:
                raise IOError("Файл обновления скачался не полностью")
            os.replace(part, dest)
            self._emit("update_ready", {"path": str(dest)})
        except InterruptedError:
            self._emit("update_error", {"error": "cancelled"})
        except Exception as e:
            self._emit("update_error", {"error": str(e)})
        finally:
            if part.exists():
                try:
                    part.unlink()
                except OSError:
                    pass


def launch_installer(path):
    """Запускает установщик в тихом режиме; после установки он сам откроет программу."""
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"],
        creationflags=flags, close_fds=True)


def cleanup_old():
    for p in UPDATES_DIR.glob("*"):
        try:
            p.unlink()
        except OSError:
            pass
