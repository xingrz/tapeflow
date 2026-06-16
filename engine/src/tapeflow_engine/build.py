"""Export the merged file — the ``build`` RPC method.

HDV is hdvmerge's lossless byte-concat (no re-encode; the Sony AUX timecode survives) followed by
its self-check (AUX survival, CC/TEI integrity, optional decode). DV keeps dvrescue's merged stream
(dvmerge's ``run.analyze(output=...)``). Routes by format like :mod:`tapeflow_engine.analyze`.

The result reports the output path and, for HDV, a structured ``verify`` summary the UI can show as a
reassuring green check (or a warning when a knowingly-damaged merge is exported).
"""

import inspect
import os
import shutil

from . import _bootstrap
from .analyze import route


def build(params, notify=None):
    """``{"dir": ..., "output": ...}`` -> a result dict with the output path and verify summary."""
    directory = params.get("dir")
    output = params.get("output")
    if not output:
        raise ValueError("build requires an 'output' path")
    fmt, files = route(directory)
    if fmt == "hdv":
        return _build_hdv(directory, files, output, notify)
    return _build_dv(directory, files, output, notify)


def _build_hdv(directory, files, output, notify):
    _bootstrap.ensure_engines_importable()
    from hdvmerge import (scan as hscan, plan as hplan, build as hbuild, verify as hverify,
                          probe as hprobe)

    cache_dir = os.path.join(directory, ".tapeflow", "hdvmerge")
    decode = hprobe.have_ffmpeg()
    rep = hscan.analyze(files, decode=decode, cache_dir=cache_dir)
    plan = hplan.build_plan(rep)
    if plan.bad_seams:
        raise ValueError("%d non-tape-adjacent seam(s); refusing to build" % plan.bad_seams)

    def on_prog(done, total):
        if notify:
            notify("progress", {"phase": "building", "done": done, "total": total})

    if notify:
        notify("progress", {"phase": "building"})
    hbuild.build(plan, output, on_progress=on_prog)
    if notify:
        notify("progress", {"phase": "verifying"})
    ok, info = hverify.verify_build(output, plan, decode=decode)
    return {
        "output": output,
        "format": "hdv",
        "ok": bool(ok),
        "sizeBytes": os.path.getsize(output),
        "verify": {
            "aux": bool(info.get("rec_head") and info.get("rec_tail")),
            "recHead": info.get("rec_head"), "tcHead": info.get("tc_head"),
            "recTail": info.get("rec_tail"), "tcTail": info.get("tc_tail"),
            "ccOk": (info.get("cc") == info.get("expected_cc")
                     and info.get("tei") == info.get("expected_tei")),
            "cc": info.get("cc"), "expectedCc": info.get("expected_cc"),
            "tei": info.get("tei"), "expectedTei": info.get("expected_tei"),
            "decodeErrors": info.get("decode_errors"),
            "unexplainedDecode": info.get("unexplained_decode"),
            "decodeGate": info.get("decode_gate"),
            # demuxer timestamp discontinuities at byte-exact splices — not content damage, surfaced
            # so the UI can reassure rather than warn (affects only some players' seeking)
            "seamDiscontinuities": info.get("seam_discontinuities"),
        },
    }


def _dv_total_frames(files, cache_dir, dvrun):
    """An expected output frame count for the export progress bar. Exact when a prior analyze cached
    the merge log (one row per output frame); otherwise the longest raw .dv capture's frame count (a
    raw .dv file is a whole number of fixed-size frames: 144000 PAL / 120000 NTSC)."""
    try:
        csv = os.path.join(cache_dir, "merge-%s.csv" % dvrun.signature(files))
        if os.path.exists(csv):
            with open(csv, "rb") as f:
                n = sum(1 for _ in f)
            if n > 1:
                return n - 1   # minus the header row
    except Exception:
        pass
    best = 0
    for f in files:
        try:
            sz = os.path.getsize(f)
        except OSError:
            continue
        fb = 144000 if sz % 144000 == 0 else (120000 if sz % 120000 == 0 else 144000)
        best = max(best, sz // fb)
    return best or 1


def _build_dv(directory, files, output, notify):
    _bootstrap.ensure_engines_importable()
    if not shutil.which("dvrescue"):
        raise ValueError("DV needs the dvrescue binary on PATH (install MediaArea/MIPoPS dvrescue)")
    from dvmerge import run as dvrun

    cache_dir = os.path.join(directory, ".tapeflow", "dvmerge")
    # Older dvmerge builds don't accept on_progress; passing it would crash the whole export. Detect
    # support and degrade to a determinate-less "building" notice rather than failing.
    supports_progress = "on_progress" in inspect.signature(dvrun.analyze).parameters
    total = _dv_total_frames(files, cache_dir, dvrun) if supports_progress else 0

    def on_prog(done):
        if notify:
            notify("progress", {"phase": "building", "tool": "dvrescue", "done": done, "total": total})

    if notify:
        start = {"phase": "building", "tool": "dvrescue"}
        if supports_progress:
            start["total"] = total
        notify("progress", start)
    if supports_progress:
        dvrun.analyze(files, output=output, cache_dir=cache_dir, on_progress=on_prog)
    else:
        dvrun.analyze(files, output=output, cache_dir=cache_dir)
    return {
        "output": output,
        "format": "dv",
        "ok": True,
        "sizeBytes": os.path.getsize(output),
        "verify": None,   # the merge and its metadata are dvrescue's; no separate self-check
    }
