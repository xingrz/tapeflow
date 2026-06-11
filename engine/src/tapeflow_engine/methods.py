"""The JSON-RPC methods the sidecar exposes. Each takes ``(params, notify=None)`` and returns a
JSON-serialisable result; raising propagates as a JSON-RPC error (see :mod:`tapeflow_engine.rpc`)."""

import shutil

from . import __version__, _bootstrap
from . import analyze as analyzemod


def capabilities(params=None, notify=None):
    """What this install can do: engine imports + external binaries on PATH. The UI uses this to
    warn up front (DV needs dvrescue; thumbnails/HDV decode-detection use ffmpeg)."""
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
        "tools": {"ffmpeg": bool(shutil.which("ffmpeg")),
                  "dvrescue": bool(shutil.which("dvrescue"))},
    }


def analyze(params, notify=None):
    return analyzemod.analyze(params, notify=notify)


def build(params, notify=None):
    raise NotImplementedError("build is not wired yet")


def thumbnail(params, notify=None):
    raise NotImplementedError("thumbnail is not wired yet")


METHODS = {
    "capabilities": capabilities,
    "analyze": analyze,
    "build": build,
    "thumbnail": thumbnail,
}
