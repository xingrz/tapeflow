"""Export the merged file — the ``build`` RPC method.

HDV is hdvmerge's lossless byte-concat (no re-encode; the Sony AUX timecode survives) followed by
its self-check (AUX survival, CC/TEI integrity, optional decode). DV keeps dvrescue's merged stream
(dvmerge's ``run.analyze(output=...)``). Routes by format like :mod:`tapeflow_engine.analyze`.

The result reports the output path and, for HDV, a structured ``verify`` summary the UI can show as a
reassuring green check (or a warning when a knowingly-damaged merge is exported).
"""

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
        },
    }


def _build_dv(directory, files, output, notify):
    _bootstrap.ensure_engines_importable()
    if not shutil.which("dvrescue"):
        raise ValueError("DV needs the dvrescue binary on PATH (install MediaArea/MIPoPS dvrescue)")
    from dvmerge import run as dvrun

    cache_dir = os.path.join(directory, ".tapeflow", "dvmerge")
    if notify:
        notify("progress", {"phase": "building", "tool": "dvrescue"})
    dvrun.analyze(files, output=output, cache_dir=cache_dir)   # keeps the merged .dv at `output`
    return {
        "output": output,
        "format": "dv",
        "ok": True,
        "sizeBytes": os.path.getsize(output),
        "verify": None,   # the merge and its metadata are dvrescue's; no separate self-check
    }
