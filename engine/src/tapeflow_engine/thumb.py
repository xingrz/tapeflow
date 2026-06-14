"""Damage-frame thumbnails — the ``thumbnail`` RPC method.

Grab one frame from a capture at a given playback offset and return it as a PNG data URL.
Format-agnostic via ffmpeg (handles both .m2t and .dv). The sidecar stays dumb: the *caller*
computes ``seconds`` = the playback offset into the capture's own timeline, i.e. the tape-TC of the
target frame minus that capture's start TC (the renderer has both from ``tapeflow.analysis/1``).
``-ss`` before ``-i`` does a fast keyframe seek — exact for DV (all-intra), nearest-keyframe for
long-GOP HDV, which is fine for a thumbnail.
"""

import base64
import os
import shutil
import subprocess

DV_EXTS = (".dv", ".dif")


def damage_frame(params, notify=None):
    """``{dir, file, seconds=0, fps=25}`` -> ``{dataUrl, file, seconds, highlighted}``.

    For a DV capture, render the frame with dvrescue's error-concealment regions highlighted in
    yellow (via ``dvplay -b <byteOffset> -O -``), so the damage view shows *where* the damage is —
    not just a count. dvplay needs the frame's byte offset; DV is frame-aligned (PAL DV25 = 144000
    bytes/frame, NTSC = 120000), so it's ``round(seconds*fps) * frameSize``. Falls back to the plain
    ffmpeg thumbnail for HDV or when dvplay is absent (``highlighted: False``)."""
    directory = params.get("dir")
    file = params.get("file")
    if not directory or not file:
        raise ValueError("damageFrame requires 'dir' and 'file'")
    path = os.path.join(directory, file)
    if not os.path.isfile(path):
        raise ValueError("no such capture: %s" % file)
    seconds = float(params.get("seconds") or 0)
    fps = float(params.get("fps") or 25)
    is_dv = os.path.splitext(file)[1].lower() in DV_EXTS
    if is_dv and shutil.which("dvplay"):
        frame_size = 144000 if round(fps or 25) == 25 else 120000
        byte = max(0, round(seconds * round(fps or 25))) * frame_size
        proc = subprocess.run(["dvplay", "-b", str(byte), "-O", "-", path],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if proc.returncode == 0 and proc.stdout[:2] == b"\xff\xd8":   # a real JPEG (SOI marker)
            return {"file": file, "seconds": seconds, "highlighted": True,
                    "dataUrl": "data:image/jpeg;base64,"
                    + base64.b64encode(proc.stdout).decode("ascii")}
    # HDV, or dvplay missing/failed: plain frame, no highlight
    out = thumbnail({"dir": directory, "file": file, "seconds": seconds,
                     "maxWidth": params.get("maxWidth")}, notify)
    out["highlighted"] = False
    return out


def thumbnail(params, notify=None):
    """``{"dir", "file", "seconds"=0, "maxWidth"=320}`` -> ``{"dataUrl", "file", "seconds"}``."""
    directory = params.get("dir")
    file = params.get("file")
    if not directory or not file:
        raise ValueError("thumbnail requires 'dir' and 'file'")
    seconds = float(params.get("seconds") or 0)
    max_w = int(params.get("maxWidth") or 320)
    path = os.path.join(directory, file)
    if not os.path.isfile(path):
        raise ValueError("no such capture: %s" % file)
    if not shutil.which("ffmpeg"):
        raise ValueError("thumbnails need ffmpeg on PATH")

    cmd = ["ffmpeg", "-v", "error", "-ss", "%.3f" % max(0.0, seconds), "-i", path,
           "-frames:v", "1", "-vf", "scale=%d:-1" % max_w,
           "-f", "image2pipe", "-vcodec", "png", "-"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError("ffmpeg failed: %s"
                           % proc.stderr.decode("utf-8", "replace").strip()[:200])
    return {
        "file": file,
        "seconds": seconds,
        "dataUrl": "data:image/png;base64," + base64.b64encode(proc.stdout).decode("ascii"),
    }
