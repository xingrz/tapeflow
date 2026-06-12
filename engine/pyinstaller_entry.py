"""PyInstaller entry point for the frozen sidecar.

Runs the same stdio JSON-RPC loop as ``python -m tapeflow_engine``, but as a standalone binary the
desktop app ships — so end users need no Python install. The merge engines (hdvmerge, dvmerge) are
frozen in by the spec's hidden imports; ffmpeg and dvrescue stay external (found on PATH at runtime).
"""

from tapeflow_engine.__main__ import main

if __name__ == "__main__":
    main()
