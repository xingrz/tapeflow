"""The JSON-RPC methods the sidecar exposes. Each takes ``(params, notify=None)`` and returns a
JSON-serialisable result; raising propagates as a JSON-RPC error (see :mod:`tapeflow_engine.rpc`)."""

import re
import shutil
import subprocess

from . import __version__, _bootstrap
from . import analyze as analyzemod
from . import build as buildmod
from . import thumb as thumbmod


def _tool_version(path, flags):
    """A short version string for the binary at ``path`` (e.g. ``6.1.1``), or ``None`` if it doesn't
    report one. Best-effort and fast: one short subprocess per flag, first non-empty output line,
    with a version-looking token pulled out of it."""
    for flag in flags:
        try:
            out = subprocess.run([path, flag], capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            continue
        blob = (out.stdout or "") + "\n" + (out.stderr or "")
        line = next((ln.strip() for ln in blob.splitlines() if ln.strip()), "")
        if not line:
            continue
        m = re.search(r"version[:\s]+v?([0-9][\w.\-]*)", line, re.I) \
            or re.search(r"\bv?([0-9]+(?:[.\-][0-9][\w.\-]*)+)\b", line)
        return m.group(1) if m else line[:48]
    return None


def _tool_info(cmd, flags):
    """``{present, version}`` for an external tool: whether it's on PATH and, if so, its version."""
    path = shutil.which(cmd)
    if not path:
        return {"present": False, "version": None}
    return {"present": True, "version": _tool_version(path, flags)}


def capabilities(params=None, notify=None):
    """What this install can do: engine imports + external binaries on PATH (with their versions).
    The UI uses this to warn up front (DV needs dvrescue; thumbnails/HDV decode-detection use
    ffmpeg) and to show the tool versions in Settings."""
    _bootstrap.ensure_engines_importable()
    engines = {}
    for pkg in ("hdvmerge", "dvmerge"):
        try:
            __import__(pkg)
            engines[pkg] = True
        except ImportError:
            engines[pkg] = False
    return {
        "version": __version__,
        "engines": engines,
        "tools": {"ffmpeg": _tool_info("ffmpeg", ("-version",)),
                  "dvrescue": _tool_info("dvrescue", ("--version", "-h"))},
    }


def analyze(params, notify=None):
    return analyzemod.analyze(params, notify=notify)


def build(params, notify=None):
    return buildmod.build(params, notify=notify)


def thumbnail(params, notify=None):
    return thumbmod.thumbnail(params, notify=notify)


METHODS = {
    "capabilities": capabilities,
    "analyze": analyze,
    "build": build,
    "thumbnail": thumbnail,
}
