# PyInstaller spec for the tapeflow sidecar. Run from the REPO ROOT, e.g.
#   pyinstaller --noconfirm --clean --distpath engine/dist --workpath engine/build engine/tapeflow-engine.spec
#
# Freezes tapeflow_engine plus the hdvmerge / dvmerge submodules into one self-contained, onedir
# binary so the desktop app needs no Python. The engines are pure-Python with no third-party deps;
# ffmpeg and dvrescue stay external (resolved on PATH at runtime, not bundled).
import os
import sys

from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.abspath(os.getcwd())
SRC = [
    os.path.join(ROOT, "engine", "src"),
    os.path.join(ROOT, "engines", "hdvmerge", "src"),
    os.path.join(ROOT, "engines", "dvmerge", "src"),
]

# put the sources on sys.path so collect_submodules can enumerate them at analysis time
for p in SRC:
    if p not in sys.path:
        sys.path.insert(0, p)

# the engines are imported lazily and dynamically (see tapeflow_engine/_bootstrap.py), so static
# analysis won't catch every submodule — pull them all in explicitly
hidden = (
    collect_submodules("tapeflow_engine")
    + collect_submodules("hdvmerge")
    + collect_submodules("dvmerge")
)

a = Analysis(
    [os.path.join(ROOT, "engine", "pyinstaller_entry.py")],
    pathex=SRC,
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="tapeflow-engine",
    console=True,  # a stdio sidecar — it needs real stdin/stdout
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="tapeflow-engine",
)
