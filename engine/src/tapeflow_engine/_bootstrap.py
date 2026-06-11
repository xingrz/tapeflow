"""Make the engine packages importable.

In a normal dev or frozen environment ``hdvmerge`` / ``dvmerge`` are already on the path (an
editable install, or bundled by PyInstaller). As a zero-setup fallback for a fresh recursive clone,
when they are *not* importable we add the pinned submodules' ``src/`` directories to ``sys.path``
so ``import hdvmerge`` just works without a separate install step. Harmless when frozen — the import
succeeds first and the fallback never runs.
"""

import os
import sys

# .../tapeflow/engine/src/tapeflow_engine/_bootstrap.py -> up 3 dirs from this file's dir = repo root
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def ensure_engines_importable():
    """Best-effort: ensure ``hdvmerge`` and ``dvmerge`` can be imported. Returns silently."""
    for pkg in ("hdvmerge", "dvmerge"):
        try:
            __import__(pkg)
            continue
        except ImportError:
            pass
        src = os.path.join(_REPO_ROOT, "engines", pkg, "src")
        if os.path.isdir(src) and src not in sys.path:
            sys.path.insert(0, src)
