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

def analyze(entry):
    return Analysis(
        [os.path.join(ROOT, "engine", entry)],
        pathex=SRC,
        binaries=[],
        datas=[],
        hiddenimports=hidden,
        hookspath=[],
        runtime_hooks=[],
        excludes=["tkinter", "test", "unittest"],
        noarchive=False,
    )


# Two binaries from the one package, each frozen into its own self-contained onedir bundle: the
# JSON-RPC `tapeflow-engine` sidecar the app spawns, and a standalone `tapeflow-cli` for scripts and
# agents. They duplicate the ~18 MB Python runtime rather than share it — trivial next to the app's
# overall size, and it keeps each bundle independent (the app could ship either alone).
a = analyze("pyinstaller_entry.py")
a_cli = analyze("pyinstaller_cli_entry.py")

pyz = PYZ(a.pure)
pyz_cli = PYZ(a_cli.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="tapeflow-engine",
    console=True,  # a stdio sidecar — it needs real stdin/stdout
    disable_windowed_traceback=False,
)
exe_cli = EXE(
    pyz_cli,
    a_cli.scripts,
    [],
    exclude_binaries=True,
    name="tapeflow-cli",
    console=True,  # prints the analysis JSON to stdout
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
coll_cli = COLLECT(
    exe_cli,
    a_cli.binaries,
    a_cli.datas,
    strip=False,
    upx=False,
    name="tapeflow-cli",
)
