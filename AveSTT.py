"""AveSTT — офлайн-расшифровка аудио и видео в текст."""
import logging
import multiprocessing
import sys

from app.paths import DATA_DIR, LOG_FILE, UI_DIR


def main():
    logging.basicConfig(
        filename=LOG_FILE, level=logging.INFO, encoding="utf-8",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    import webview
    from webview.dom import DOMEventHandler

    from app import updater
    from app.api import Api

    updater.cleanup_old()
    api = Api()
    window = webview.create_window(
        "AveSTT", url=str(UI_DIR / "index.html"), js_api=api,
        width=1240, height=820, min_size=(980, 660), background_color="#0f1014")
    api._attach(window)

    def on_start(win):
        noop = DOMEventHandler(lambda e: None, prevent_default=True, stop_propagation=True)
        win.dom.document.events.dragover += noop
        win.dom.document.events.drop += DOMEventHandler(api._on_drop, prevent_default=True, stop_propagation=True)

    webview.start(on_start, window, gui="edgechromium", debug="--debug" in sys.argv,
                  private_mode=False, storage_path=str(DATA_DIR / "webview"))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
