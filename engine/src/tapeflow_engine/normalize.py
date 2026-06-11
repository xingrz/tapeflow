"""Normalise an engine's faithful ``*.analysis/1`` dump into the unified ``tapeflow.analysis/1``.

This is where "DV and HDV behind one interface" actually happens. The renderer only ever sees the
unified shape; format-specific vocabulary (hdvmerge's residual/divergence, dvmerge's mosaic/missing)
stops here and is mapped to the shared ``damage[] {kind: dirty | missing}``.

See AGENTS.md for the full ``tapeflow.analysis/1`` schema and the per-engine mapping. Note on
``axis``: it is an opaque, monotonic, per-engine coordinate used only for *relative* layout; its
unit differs by engine and is not yet unified across entities — always label with ``tc``/``rec``,
never compute from ``axis``. The Canvas tape-map's precise geometry is a later refinement.
"""

from . import SCHEMA

_SEP = " -_.·"


def _title(tags):
    """A batch name from the captures' shared filename prefix (e.g. 'CLIP-A','CLIP-B' -> 'CLIP')."""
    uniq = list(dict.fromkeys(tags))
    if not uniq:
        return ""
    if len(uniq) == 1:
        return uniq[0]
    p = uniq[0]
    for t in uniq[1:]:
        while not t.startswith(p):
            p = p[:-1]
    cut = 0
    for i, c in enumerate(p):
        if c in _SEP:
            cut = i + 1
    return p[:cut].rstrip(_SEP)


# ---------- HDV (hdvmerge.analysis/1) ----------

def _hdv_damage(hdv, fps):
    """The unified re-capture list. hdvmerge residuals (present-but-damaged GOPs with no clean copy)
    become ``dirty`` spots — consecutive ones within ~2 s on the same capture are coalesced into one
    spot, the way you'd rewind and re-shoot the region. Alignment gaps (tape no capture covers at
    all) become ``missing`` spots."""
    out = []
    window = fps * 2
    groups = []
    for r in hdv["residuals"]:
        last = groups[-1][-1] if groups else None
        if last and r["tag"] == last["tag"] and r["frame"] - last["frame"] <= window:
            groups[-1].append(r)
        else:
            groups.append([r])
    for i, g in enumerate(groups):
        a, b = g[0], g[-1]
        kinds = []
        if any(x["cc"] for x in g):
            kinds.append("continuity break")
        if any(x["tei"] for x in g):
            kinds.append("transport error")
        if any(x.get("dec") for x in g):
            kinds.append("intra-frame damage")
        out.append({
            "id": "d%d" % i,
            "kind": "dirty",
            "axis": [a["frame"], b["frame"]],
            "tcStart": a.get("tc"), "tcEnd": b.get("tc"),
            "recStart": a.get("rec"), "recEnd": b.get("rec"),
            "durationFrames": max(1, b["frame"] - a["frame"] + 1),
            "coverage": [a["tag"]],
            "copies": 1,
            "severity": ", ".join(kinds) or "damage",
        })
    for k, (lo, hi) in enumerate(hdv["gaps"]):
        out.append({
            "id": "g%d" % k,
            "kind": "missing",
            "axis": [lo, hi],
            "tcStart": None, "tcEnd": None, "recStart": None, "recEnd": None,
            "durationFrames": (hi - lo + 1) * 12,   # ~12 frames/GOP, a rough estimate for display
            "coverage": [], "copies": 0,
            "severity": "missing in every capture",
        })
    return out


def _hdv_capture(s, files_by_tag):
    return {
        "tag": s["tag"],
        "file": files_by_tag.get(s["tag"], s["tag"]),
        "axis": [s["shift"], s["shift"] + s["ngops"]],   # GOP units on the tape axis
        "tcSpan": [s.get("tc0"), s.get("tc1")],
        "recSpan": [s.get("rec0"), s.get("rec1")],
        "health": [],   # per-GOP clean/damaged runs aren't in the engine JSON yet (a refinement)
    }


def _hdv_segments(segs, total):
    out = []
    for i, s in enumerate(segs):
        f0 = s["frame0"]
        f1 = segs[i + 1]["frame0"] if i + 1 < len(segs) else total
        out.append({
            "tag": s["tag"],
            "axis": [f0, f1],
            "tcSpan": [s.get("tc"), s.get("tc_end")],
            "recSpan": [s.get("rec"), s.get("rec_end")],
            "gapBefore": bool(s.get("gap_before")),
        })
    return out


def from_hdvmerge(hdv, working_dir, files_by_tag):
    """``hdvmerge.analysis/1`` dict -> ``tapeflow.analysis/1`` dict."""
    fps = hdv["fps"]
    segs = hdv["segments"]
    sources = hdv["sources"]
    damage = _hdv_damage(hdv, fps)
    tape = {
        "tcStart": segs[0].get("tc") if segs else None,
        "tcEnd": segs[-1].get("tc_end") if segs else None,
        "recStart": segs[0].get("rec") if segs else None,
        "recEnd": segs[-1].get("rec_end") if segs else None,
        "durationFrames": hdv["total_frames"],
        "title": _title([s["tag"] for s in sources]),
    }
    return {
        "schema": SCHEMA,
        "format": "hdv",
        "dir": working_dir,
        "fps": fps,
        "complete": hdv["complete"],
        "buildable": hdv["bad_seams"] == 0,
        "tape": tape,
        "summary": {
            "recaptureSpots": len(damage),
            "missingFrames": sum(d["durationFrames"] for d in damage if d["kind"] == "missing"),
            "unusedCaptures": len(hdv["unused_sources"]),
        },
        "captures": [_hdv_capture(s, files_by_tag) for s in sources],
        "segments": _hdv_segments(segs, hdv["total_frames"]),
        "damage": damage,
        "divergences": hdv["divergences"],
    }
