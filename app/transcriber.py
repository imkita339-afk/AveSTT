"""Очередь файлов и распознавание речи через faster-whisper (полностью офлайн)."""
import logging
import os
import threading
import time
import uuid

from . import exporters, models

log = logging.getLogger("avestt")

AUDIO_EXT = {"mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "wma", "amr", "aiff", "aif", "mka", "ac3", "3gp"}
VIDEO_EXT = {"mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v", "mpg", "mpeg", "ts", "mts", "m2ts", "3g2", "ogv"}
MEDIA_EXT = AUDIO_EXT | VIDEO_EXT


class Cancelled(Exception):
    pass


def _friendly_error(e):
    text = str(e)
    name = type(e).__name__
    if "av." in type(e).__module__ or name in ("InvalidDataError", "FFmpegError") or "Invalid data" in text:
        return "Не удалось прочитать файл: формат не поддерживается или файл повреждён."
    if "does not contain any stream" in text or "audio stream" in text.lower():
        return "В файле нет звуковой дорожки."
    if isinstance(e, MemoryError) or "out of memory" in text.lower():
        return "Не хватает оперативной памяти. Попробуйте модель поменьше."
    return text or name


class Engine:
    def __init__(self, emit, settings, history):
        self._emit = emit
        self._settings = settings
        self._history = history
        self._jobs = {}
        self._order = []
        self._lock = threading.Lock()
        self._thread = None
        self._model = None
        self._model_key = None

    # ---------- очередь ----------
    def jobs(self):
        with self._lock:
            return [dict(self._jobs[j]) for j in self._order]

    @staticmethod
    def _expand(paths):
        """Папки разворачиваем в список медиафайлов внутри них."""
        for p in paths:
            if p and os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in sorted(files):
                        if os.path.splitext(f)[1].lower().lstrip(".") in MEDIA_EXT:
                            yield os.path.join(root, f)
            else:
                yield p

    def add(self, paths):
        added = []
        paths = list(self._expand(paths))
        with self._lock:
            known = {j["path"] for j in self._jobs.values() if j["status"] in ("pending", "running")}
            for p in paths:
                if not p or not os.path.isfile(p) or p in known:
                    continue
                ext = os.path.splitext(p)[1].lower().lstrip(".")
                job = {
                    "id": uuid.uuid4().hex[:10],
                    "path": p,
                    "name": os.path.basename(p),
                    "size": os.path.getsize(p),
                    "kind": "video" if ext in VIDEO_EXT else "audio",
                    "status": "pending",   # pending | running | done | error | cancelled
                    "stage": "",
                    "progress": 0.0,
                    "eta": None,
                    "error": None,
                    "history_id": None,
                    "_cancel": False,
                }
                self._jobs[job["id"]] = job
                self._order.append(job["id"])
                added.append(self._public(job))
        return added

    @staticmethod
    def _public(job):
        return {k: v for k, v in job.items() if not k.startswith("_")}

    def remove(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            if job["status"] == "running":
                job["_cancel"] = True
                return
            del self._jobs[job_id]
            self._order.remove(job_id)

    def clear_finished(self):
        with self._lock:
            for jid in list(self._order):
                if self._jobs[jid]["status"] in ("done", "error", "cancelled"):
                    del self._jobs[jid]
                    self._order.remove(jid)

    def cancel(self, job_id=None):
        with self._lock:
            targets = [self._jobs[job_id]] if job_id in self._jobs else (list(self._jobs.values()) if job_id is None else [])
            for job in targets:
                if job["status"] == "running":
                    job["_cancel"] = True
                elif job["status"] == "pending":
                    job["status"] = "cancelled"
                    self._emit("job", self._public(job))

    def retry(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job["status"] in ("error", "cancelled"):
                job.update(status="pending", progress=0.0, error=None, stage="", eta=None, _cancel=False)
                self._emit("job", self._public(job))

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    @property
    def busy(self):
        return bool(self._thread and self._thread.is_alive())

    # ---------- работа ----------
    def _next(self):
        with self._lock:
            for jid in self._order:
                if self._jobs[jid]["status"] == "pending":
                    return self._jobs[jid]
        return None

    def _update(self, job, **kw):
        with self._lock:
            job.update(kw)
            data = self._public(job)
        self._emit("job", data)

    def _run(self):
        self._emit("engine", {"busy": True})
        try:
            while True:
                job = self._next()
                if not job:
                    break
                self._process(job)
        finally:
            self._emit("engine", {"busy": False})

    def _get_model(self, model_id, threads):
        key = (model_id, threads)
        if self._model is not None and self._model_key == key:
            return self._model
        path = models.find(model_id)
        if not path:
            raise RuntimeError("Модель не установлена. Скачайте её в разделе «Модели».")
        from faster_whisper import WhisperModel
        self._model = None
        self._model = WhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=int(threads))
        self._model_key = key
        return self._model

    def _process(self, job):
        s = self._settings
        model_id = s.get("model")
        if not models.find(model_id):
            installed = models.installed_ids()
            model_id = installed[0] if installed else model_id
        language = s.get("language")
        task = s.get("task")
        self._update(job, status="running", stage="Загрузка модели…", progress=0.0, error=None)
        try:
            model = self._get_model(model_id, s.get("threads"))
            if job["_cancel"]:
                raise Cancelled()
            self._update(job, stage="Чтение аудио…")
            segments_iter, info = model.transcribe(
                job["path"],
                language=None if language in (None, "", "auto") else language,
                task=task if task in ("transcribe", "translate") else "transcribe",
                beam_size=5,
                vad_filter=bool(s.get("vad")),
                vad_parameters={"min_silence_duration_ms": 700},
                condition_on_previous_text=False,
            )
            duration = float(info.duration or 0) or 1.0
            self._update(job, stage="Распознавание…", language=info.language)
            segments = []
            started = time.monotonic()
            for seg in segments_iter:
                if job["_cancel"]:
                    raise Cancelled()
                item = {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()}
                segments.append(item)
                progress = min(seg.end / duration, 0.999)
                elapsed = time.monotonic() - started
                eta = elapsed / progress * (1 - progress) if progress > 0.02 else None
                with self._lock:
                    job.update(progress=progress, eta=eta)
                self._emit("segment", {"job": job["id"], "segment": item, "progress": progress, "eta": eta})
            record = self._history.add(
                name=os.path.splitext(job["name"])[0],
                source=job["path"],
                duration=float(info.duration or 0),
                language=info.language,
                model=model_id,
                task=task,
                segments=segments,
            )
            if s.get("autosave_txt"):
                try:
                    out = os.path.splitext(job["path"])[0] + ".txt"
                    exporters.export(record, "txt", out, s.get("txt_timestamps"))
                except OSError as e:
                    log.warning("autosave failed: %s", e)
            self._update(job, status="done", stage="Готово", progress=1.0, eta=None, history_id=record["id"])
        except Cancelled:
            self._update(job, status="cancelled", stage="Отменено", eta=None)
        except Exception as e:
            log.exception("transcription failed: %s", job["path"])
            self._update(job, status="error", stage="Ошибка", eta=None, error=_friendly_error(e))
