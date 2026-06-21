"""Discover the captures in a working directory, route by format, and return a unified analysis.

A working dir is one tape = one format. We classify by extension; HDV goes to ``hdvmerge``, DV to
``dvmerge``. Mixing the two in one dir is a user error we surface, not something to merge. Engine
caches live under ``<dir>/.tapeflow/`` so the working dir stays clean.
"""

import os
import shutil
import tempfile

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
    its self-assessed completeness (the same ``archive`` "TF tag" a build stamps) and, for HDV, any
    duplicate frames. **Read-only w.r.t. the master**: nothing is written beside it (HDV indexes in
    memory; DV sends dvrescue's temps to system scratch and cleans them up), so it is safe on a
    read-only / NAS volume.

    HDV: the tag re-runs the merge analysis on the single file in memory (no cache). DV: dvrescue's CSV
    log is a *merge* artifact, so the tag re-runs dvrescue's merge on the one file with its temps in
    scratch — this reproduces the exact ``analyze`` tag, at the cost of a full-size scratch copy
    (guarded by a free-space check). Either way a truly complete master reads its full tag; one that
    carries real residual damage may read slightly under it."""
    path = params.get("file")
    if not path or not os.path.isfile(path):
        raise ValueError("not a file: %r" % path)
    ext = os.path.splitext(path)[1].lower()
    if ext in HDV_EXTS:
        return _verify_hdv(path, notify)
    if ext in DV_EXTS:
        return _verify_dv(path, notify)
    raise ValueError("not a recognised master file (expected .m2t/.ts/… or .dv): %s" % path)


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


def _verify_dv(path, notify):
    _bootstrap.ensure_engines_importable()
    if not shutil.which("dvrescue"):
        raise ValueError("DV verify needs the dvrescue binary on PATH "
                         "(install MediaArea/MIPoPS dvrescue)")
    from dvmerge import run as dvrun, jsonout as dvjson
    # dvrescue's CSV merge log — the basis of the completeness tag — is a *merge* artifact, so the only
    # way to reproduce the exact `analyze` tag for one master is to re-run the merge on it. That writes
    # a full-size throwaway .dv. To stay read-only w.r.t. the master, send every temp to a fresh SCRATCH
    # dir under the system temp (never beside the master) and remove it; guard on free space first
    # (the scratch needs roughly the master's own size). `TMPDIR` points scratch at a larger volume.
    scratch = tempfile.mkdtemp(prefix="tapeflow-verify-")
    try:
        need = os.path.getsize(path) + (256 << 20)        # the merged copy + small logs + margin
        free = shutil.disk_usage(scratch).free
        if free < need:
            raise ValueError("not enough scratch space to verify this DV master: need ~%.1f GB free in "
                             "%s, have %.1f GB (point $TMPDIR at a larger volume)"
                             % (need / 2**30, tempfile.gettempdir(), free / 2**30))
        if notify:
            notify("progress", {"phase": "merging", "tool": "dvrescue"})
        plan = dvrun.analyze([path], no_cache=True, tmp_dir=scratch)
        dv = dvjson.analysis(plan)
        directory = os.path.dirname(os.path.abspath(path))
        stem = os.path.splitext(os.path.basename(path))[0]
        norm = normalize.from_dvmerge(dv, directory, {stem: os.path.basename(path)})
    finally:
        shutil.rmtree(scratch, ignore_errors=True)        # belt-and-suspenders; dvmerge cleans its own
    return {
        "schema": "tapeflow.verify/1",
        "format": "dv",
        "file": os.path.basename(path),
        "archive": norm.get("archive"),
        "complete": norm.get("complete"),
        "summary": norm.get("summary"),
        "damage": norm.get("damage"),
        "duplicateFrames": [],   # HDV-only (a hash-coverage merge artifact); dvrescue's DV merge has none
        "sound": True,           # dvrescue parsed it to produce the log -> a readable DV stream
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
