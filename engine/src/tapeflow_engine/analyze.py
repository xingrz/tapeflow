"""Discover the captures in a working directory, route by format, and return a unified analysis.

A working dir is one tape = one format. We classify by extension; HDV goes to ``hdvmerge``, DV to
``dvmerge``. Mixing the two in one dir is a user error we surface, not something to merge. Engine
caches live under ``<dir>/.tapeflow/`` so the working dir stays clean.
"""

import os

from . import _bootstrap, normalize

HDV_EXTS = (".m2t", ".m2ts", ".mts", ".ts", ".tts", ".trp", ".tp", ".mpg", ".mpeg")
DV_EXTS = (".dv", ".dif")


def _discover(directory):
    hdv, dv = [], []
    for name in sorted(os.listdir(directory)):
        path = os.path.join(directory, name)
        if not os.path.isfile(path) or name.endswith(".idx.jsonl"):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in HDV_EXTS:
            hdv.append(path)
        elif ext in DV_EXTS:
            dv.append(path)
    return hdv, dv


def analyze(params, notify=None):
    """``{"dir": ...}`` -> ``tapeflow.analysis/1``. Streams ``progress`` notifications while
    indexing (the slow first pass; cached files re-run fast)."""
    directory = params.get("dir")
    if not directory or not os.path.isdir(directory):
        raise ValueError("not a directory: %r" % directory)
    hdv, dv = _discover(directory)
    if hdv and dv:
        raise ValueError("working dir mixes HDV (%d) and DV (%d) captures — one tape is one format"
                         % (len(hdv), len(dv)))
    if hdv:
        return _analyze_hdv(directory, hdv, notify)
    if dv:
        raise ValueError("DV analysis is not wired yet (needs dvrescue); HDV works")
    raise ValueError("no capture files found in %s" % directory)


def _analyze_hdv(directory, files, notify):
    _bootstrap.ensure_engines_importable()
    from hdvmerge import scan as hscan, plan as hplan, jsonout as hjson, probe as hprobe

    cache_dir = os.path.join(directory, ".tapeflow", "hdvmerge")

    def on_progress(done, total):
        if notify:
            notify("progress", {"phase": "indexing", "done": done, "total": total})

    def on_file(idx, cached=False, note=None, path=None):
        if notify:
            name = idx.tag if idx is not None else os.path.basename(path or "?")
            notify("progress", {"phase": "indexed", "file": name, "cached": bool(cached)})

    rep = hscan.analyze(files, decode=hprobe.have_ffmpeg(), cache_dir=cache_dir,
                        on_progress=on_progress, on_file=on_file)
    plan = hplan.build_plan(rep)
    hdv = hjson.analysis(rep, plan)
    files_by_tag = {os.path.splitext(os.path.basename(p))[0]: os.path.basename(p) for p in files}
    return normalize.from_hdvmerge(hdv, directory, files_by_tag)
