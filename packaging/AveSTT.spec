# -*- mode: python ; coding: utf-8 -*-
# Сборка: pyinstaller packaging/AveSTT.spec --noconfirm
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files

ROOT = Path(SPECPATH).parent

datas = [(str(ROOT / "ui"), "ui")]
binaries = []
hiddenimports = []
for pkg in ("ctranslate2", "faster_whisper", "av", "onnxruntime", "tokenizers"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h
datas += collect_data_files("docx")
datas += collect_data_files("webview")

a = Analysis(
    [str(ROOT / "AveSTT.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + ["webview.platforms.edgechromium", "webview.platforms.winforms", "clr"],
    excludes=["tkinter", "matplotlib", "IPython", "pytest", "torch", "tensorflow", "PyQt5", "PyQt6", "PySide6",
              "webview.platforms.qt", "webview.platforms.gtk", "webview.platforms.cef", "sympy", "pandas", "scipy"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AveSTT",
    icon=str(ROOT / "assets" / "icon.ico"),
    version=str(ROOT / "packaging" / "version_info.txt"),
    console=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="AveSTT")
