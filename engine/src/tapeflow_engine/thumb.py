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
