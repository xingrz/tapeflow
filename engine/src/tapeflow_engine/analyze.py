"""Discover the captures in a working directory, route by format, and return a unified analysis.

A working dir is one tape = one format. We classify by extension; HDV goes to ``hdvmerge``, DV to
``dvmerge``. Mixing the two in one dir is a user error we surface, not something to merge. Engine
caches live under ``<dir>/.tapeflow/`` so the working dir stays clean.
"""

import os
import shutil

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


def route(directory):
    """Classify a working dir as one tape of one format. Returns ``(fmt, files)`` with ``fmt`` in
    ``{"hdv", "dv"}``. Raises ``ValueError`` on a non-directory, an empty dir, or a mix of formats
    (one tape is one format). Shared by ``analyze`` and ``build``."""
    if not directory or not os.path.isdir(directory):
        raise ValueError("not a directory: %r" % directory)
    hdv, dv = _discover(directory)
    if hdv and dv:
        raise ValueError("working dir mixes HDV (%d) and DV (%d) captures — one tape is one format"
                         % (len(hdv), len(dv)))
    if hdv:
        return "hdv", hdv
    if dv:
        return "dv", dv
    raise ValueError("no capture files found in %s" % directory)


def analyze(params, notify=None):
    """``{"dir": ...}`` -> ``tapeflow.analysis/1``. Streams ``progress`` notifications while
    indexing (the slow first pass; cached files re-run fast)."""
    directory = params.get("dir")
    fmt, files = route(directory)
    if fmt == "hdv":
        return _analyze_hdv(directory, files, notify)
    return _analyze_dv(directory, files, notify)


def verify(params, notify=None):
    """``{"file": ...}`` -> ``tapeflow.verify/1``: audit ONE already-built master from the file alone —
    its self-assessed completeness (the same ``archive`` "TF tag" a build stamps) and any duplicate
    frames. **Strictly read-only**: the file is indexed in memory with ``use_cache=False`` (no
    ``.tapeflow`` cache, no temp files), so it is safe against a master on a read-only / NAS volume.

    The tag is computed by re-running the merge analysis on the single file: a truly complete master
    re-reads as 100% (the build re-phases CC continuous, so seams carry no break; gaps/residuals are
    detected from the file's own tc/rec and damage flags). A master that genuinely carries residual
    damage may read slightly under its original tag — with no other capture present, ffmpeg's cascaded
    decode errors can't be discredited against a clean twin — but a 100% master is unaffected."""
    path = params.get("file")
    if not path or not os.path.isfile(path):
        raise ValueError("not a file: %r" % path)
    ext = os.path.splitext(path)[1].lower()
    if ext in DV_EXTS:
        raise ValueError("verify currently supports HDV masters only; got a DV file: %s" % path)
    if ext not in HDV_EXTS:
        raise ValueError("not a recognised master file (expected .m2t/.ts/…): %s" % path)
    return _verify_hdv(path, notify)


def _verify_hdv(path, notify):
    _bootstrap.ensure_engines_importable()
    from hdvmerge import (scan as hscan, plan as hplan, jsonout as hjson, probe as hprobe,
                          verify as hverify)
    from hdvmerge.model import Report
    if notify:
        notify("progress", {"phase": "index-start", "file": os.path.basename(path)})
    idx = hscan.ensure_index(path, decode=hprobe.have_ffmpeg(), use_cache=False)   # read-only: no cache
    if idx is None:
        raise ValueError("not a readable MPEG-TS master: %s" % path)
    if notify:
        notify("progress", {"phase": "indexed", "file": idx.tag, "cached": False})
    rep = Report(sources=[idx], chain=[idx.tag], shifts={idx.tag: 0}, gaps=[])
    plan = hplan.build_plan(rep)
    hdv = hjson.analysis(rep, plan)
    directory = os.path.dirname(os.path.abspath(path))
    norm = normalize.from_hdvmerge(hdv, directory, {idx.tag: os.path.basename(path)})
    sound, sinfo = hverify.verify(path)
    return {
        "schema": "tapeflow.verify/1",
        "format": "hdv",
        "file": os.path.basename(path),
        "archive": norm.get("archive"),
        "complete": norm.get("complete"),
        "summary": norm.get("summary"),
        "damage": norm.get("damage"),
        "duplicateFrames": hverify._duplicate_frames(idx.gops),
        "sound": bool(sound),
        "tc": {"head": sinfo.get("tc_head"), "tail": sinfo.get("tc_tail")},
        "rec": {"head": sinfo.get("rec_head"), "tail": sinfo.get("rec_tail")},
    }


def _analyze_hdv(directory, files, notify):
    _bootstrap.ensure_engines_importable()
    from hdvmerge import scan as hscan, plan as hplan, jsonout as hjson, probe as hprobe
    from hdvmerge.model import Report

    cache_dir = os.path.join(directory, ".tapeflow", "hdvmerge")
    decode = hprobe.have_ffmpeg()

    def on_progress(done, total):
        if notify:
            notify("progress", {"phase": "indexing", "done": done, "total": total})

    def on_file(idx, cached=False, note=None, path=None):
        if notify:
            name = idx.tag if idx is not None else os.path.basename(path or "?")
            notify("progress", {"phase": "indexed", "file": name, "cached": bool(cached)})

    # Index file-by-file (this mirrors hdvmerge.scan.analyze) so we can announce WHICH file is
    # starting: the byte-level on_progress can't say which file it is in, and on_file fires only on
    # completion — without a start signal the UI can't show a per-file "indexing" state.
    if notify:
        # announce up front WHICH fragments this run will actually index: a cheap cache pre-check
        # (needs_index — fingerprint + cache validity, no scan) drops the already-indexed ones, so the
        # modal lists and counts only the real work — and a re-analyse of an indexed dir shows just the
        # newly dropped files, not the whole set. Fall back to the full list if the pinned hdvmerge
        # predates needs_index.
        check = getattr(hscan, "needs_index", None)
        todo = [p for p in files if check is None or check(p, decode=decode, cache_dir=cache_dir)]
        notify("progress", {"phase": "index-plan", "total": len(todo),
                            "files": [os.path.basename(p) for p in todo]})
    sources = []
    for path in files:
        if notify:
            notify("progress", {"phase": "index-start", "file": os.path.basename(path)})
        idx = hscan.ensure_index(path, decode=decode, cache_dir=cache_dir,
                                 on_progress=on_progress, on_file=on_file)
        if idx is not None:
            sources.append(idx)
    chain, shifts, gaps = hscan.align(sources)
    rep = Report(sources=sources, chain=chain, shifts=shifts, gaps=gaps)
    plan = hplan.build_plan(rep)
    hdv = hjson.analysis(rep, plan)
    files_by_tag = {os.path.splitext(os.path.basename(p))[0]: os.path.basename(p) for p in files}
    return normalize.from_hdvmerge(hdv, directory, files_by_tag)


def _analyze_dv(directory, files, notify):
    _bootstrap.ensure_engines_importable()
    if not shutil.which("dvrescue"):
        raise ValueError("DV needs the dvrescue binary on PATH "
                         "(install MediaArea/MIPoPS dvrescue)")
    from dvmerge import run as dvrun, jsonout as dvjson

    cache_dir = os.path.join(directory, ".tapeflow", "dvmerge")
    if notify:
        # dvrescue runs as one subprocess with no incremental progress; signal the long step.
        notify("progress", {"phase": "merging", "tool": "dvrescue"})
    # fps defaults to PAL 25 (dvmerge's default); NTSC (29.97) will need a per-tape setting later.
    plan = dvrun.analyze(files, cache_dir=cache_dir)
    dv = dvjson.analysis(plan)
    files_by_tag = {os.path.splitext(os.path.basename(p))[0]: os.path.basename(p) for p in files}
    return normalize.from_dvmerge(dv, directory, files_by_tag)
