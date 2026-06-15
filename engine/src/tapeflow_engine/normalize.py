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


def _tc_frames(tc, fps):
    """Tape TC 'HH:MM:SS:FF' (or ';' drop-frame separators) -> absolute frame number — for relative
    layout only. Non-drop arithmetic (exact for PAL; the small label drift on NTSC drop-frame is
    immaterial since the UI labels with the raw tc string)."""
    if not tc:
        return 0
    try:
        h, m, s, f = (int(x) for x in tc.replace(";", ":").split(":"))
    except ValueError:
        return 0
    r = int(round(fps or 25))
    return ((h * 60 + m) * 60 + s) * r + f


# ---------- HDV (hdvmerge.analysis/1) ----------

def _residual_runs(group):
    """The PRECISE damaged sub-runs within a re-capture spot — consecutive damaged GOPs (by gop
    index) coalesced, each as a tape-TC span. A spot bridges short clean gaps for the re-capture
    cue, but the map should draw the actual damage; these runs line up exactly with the same
    capture's own-damage runs (both coalesce consecutive damaged GOPs)."""
    runs = []
    for r in group:
        if runs and r.get("gop") == runs[-1]["_g"] + 1:
            runs[-1]["tcEnd"] = r.get("tc")
            runs[-1]["_g"] = r.get("gop")
        else:
            runs.append({"tcStart": r.get("tc"), "tcEnd": r.get("tc"), "_g": r.get("gop")})
    for run in runs:
        del run["_g"]
    return runs


def _hdv_damage(hdv, fps):
    """The unified re-capture list. hdvmerge residuals (present-but-damaged GOPs with no clean copy)
    become ``dirty`` spots — consecutive ones within ~2 s on the same capture are coalesced into one
    spot, the way you'd rewind and re-shoot the region. Alignment gaps (tape no capture covers at
    all) become ``missing`` spots. Each spot also carries ``runs``: the precise damaged sub-spans
    (for drawing on the map), vs the coalesced spot extent (for the re-capture cue)."""
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
            "runs": _residual_runs(g),
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
            "runs": [],   # gaps have no TC; drawn by axis extent
        })
    # tape recorded but unreadable in every capture (rec-run TC + wall clock jump together)
    for k, lo in enumerate(hdv.get("lost", [])):
        out.append({
            "id": "l%d" % k,
            "kind": "missing",
            "axis": [lo["frame"], lo["frame"]],
            "tcStart": lo["tc0"], "tcEnd": lo["tc1"],
            "recStart": lo["rec0"], "recEnd": lo["rec1"],
            "durationFrames": lo["frames"],
            "coverage": [], "copies": 0,
            "severity": "recorded but unreadable in every capture",
            "runs": [{"tcStart": lo["tc0"], "tcEnd": lo["tc1"]}],
        })
    return out


def _hdv_capture_damage(s):
    """This capture's OWN damaged runs (where the capture itself is bad), by tape TC — shown on its
    lane regardless of whether another capture covers it cleanly. Distinct from the result-level
    ``damage[]`` (which is only where no clean copy exists)."""
    out = []
    for d in s.get("damage", []):
        kinds = []
        if d.get("cc"):
            kinds.append("continuity break")
        if d.get("tei"):
            kinds.append("transport error")
        if d.get("dec"):
            kinds.append("intra-frame damage")
        out.append({"tcStart": d.get("tc0"), "tcEnd": d.get("tc1"),
                    "severity": ", ".join(kinds) or "damage"})
    return out


def _capture_ranges(s, shift, a2f, fallback_axis):
    """The TC segments this capture actually covers (split at its internal drops), each with its
    physical-frame ``axis`` extent so the lane draws correctly in the axis (multi-session) layout —
    the TC alone is ambiguous there because it restarts each session. The runs stay contiguous on the
    frame axis across a TC reset (the GOPs are consecutive), so a reset shows no false gap. Falls back
    to the whole capture span when the engine supplies no coverage."""
    cov = s.get("coverage") or []
    if cov and a2f is not None:
        return [{"tcStart": c["tc0"], "tcEnd": c["tc1"],
                 "axis": [a2f(shift + c["j0"]), a2f(shift + c["j1"])]} for c in cov]
    if cov:
        return [{"tcStart": c["tc0"], "tcEnd": c["tc1"]} for c in cov]
    return [{"tcStart": s.get("tc0"), "tcEnd": s.get("tc1"), "axis": list(fallback_axis)}]


def _tc_key(tc):
    """Order key for a tape TC ``"HH:MM:SS:FF"`` (or -1 if unparseable) — to find the furthest TC a
    multi-session tape reaches, where the last GOP's TC is a restarted session near zero."""
    try:
        h, m, s, f = (int(x) for x in tc.replace(";", ":").split(":"))
    except (ValueError, AttributeError):
        return -1
    return ((h * 60 + m) * 60 + s) * 100 + f


def _hdv_capture(s, files_by_tag, frame_ext=None, a2f=None):
    # Lay the lane out on the physical FRAME axis (consistent with segments/damage and the axis
    # anchors) so a multi-session tape doesn't collapse; fall back to GOP units if a source somehow
    # has no placed segment.
    ext = (frame_ext or {}).get(s["tag"])
    axis = [ext[0], ext[1]] if ext else [s["shift"], s["shift"] + s["ngops"]]
    # span the TC across all of this capture's sessions: with a TC reset, the last GOP's tc0/tc1 is a
    # restarted session near zero, so take the min/max over its coverage ranges (a no-op otherwise)
    cov = s.get("coverage") or []
    tc0 = min((c["tc0"] for c in cov), key=_tc_key) if cov else s.get("tc0")
    tc1 = max((c["tc1"] for c in cov), key=_tc_key) if cov else s.get("tc1")
    return {
        "tag": s["tag"],
        "file": files_by_tag.get(s["tag"], s["tag"]),
        "axis": axis,
        "tcSpan": [tc0, tc1],
        "recSpan": [s.get("rec0"), s.get("rec1")],
        "health": [],   # legacy run-length field, unused; per-capture damage is `damage` below
        "damage": _hdv_capture_damage(s),
        "ranges": _capture_ranges(s, s["shift"], a2f, axis),
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
    total = hdv["total_frames"]
    damage = _hdv_damage(hdv, fps)
    multi = bool(hdv.get("multi_session"))
    # The aligned GOP axis (where align placed each capture by content hash) -> output frames. The
    # segments tile that axis in order, so they ARE the axis->frame map. A capture's lane must span
    # its FULL aligned extent [shift, shift+ngops] mapped to frames — not just the segments the merge
    # happened to pick it for — otherwise two overlapping transfers of one tape look appended end to
    # end instead of overlapping.
    shift_by_tag = {s["tag"]: s["shift"] for s in sources}
    amap = []   # (axis0, axis1, frame0, frame1) per output segment, in axis order
    for i, sg in enumerate(segs):
        sh = shift_by_tag.get(sg["tag"], 0)
        f1 = segs[i + 1]["frame0"] if i + 1 < len(segs) else total
        amap.append((sh + sg["j0"], sh + sg["j1"], sg["frame0"], f1))

    def _axis_to_frame(a):
        for a0, a1, f0, f1 in amap:
            if a0 <= a <= a1:
                return f0 if a1 <= a0 else int(round(f0 + (a - a0) * (f1 - f0) / (a1 - a0)))
        if not amap or a <= amap[0][0]:
            return amap[0][2] if amap else 0
        return amap[-1][3]

    frame_ext = {s["tag"]: (_axis_to_frame(s["shift"]), _axis_to_frame(s["shift"] + s["ngops"]))
                 for s in sources}
    # the per-position (frame -> tc, rec) curve + recording-session seam positions (see hdvmerge)
    anchors = [{"axis": a["axis"] if "axis" in a else a["frame"], "tc": a["tc"], "rec": a["rec"]}
               for a in hdv.get("anchors", [])]
    # On a multi-session tape the record-run TC restarts, so segs[-1].tc_end is a tiny restarted
    # session near zero, NOT the tape's end — that collapsed the whole TC range. Show the furthest TC
    # actually reached instead, and lay the map out on the physical axis via the anchors below.
    tc_end = segs[-1].get("tc_end") if segs else None
    if multi and anchors:
        tc_end = max(anchors, key=lambda a: _tc_key(a["tc"]))["tc"]
    tape = {
        "tcStart": segs[0].get("tc") if segs else None,
        "tcEnd": tc_end,
        "recStart": segs[0].get("rec") if segs else None,
        "recEnd": segs[-1].get("rec_end") if segs else None,
        "durationFrames": total,
        "title": _title([s["tag"] for s in sources]),
        # per-position (tape TC -> wall clock) curve so the map shows each position's true recording
        # time instead of extrapolating from recStart (which a stray/older head chunk would poison)
        "recAnchors": hdv.get("rec_curve") or [],
        # a tape that splices on later footage restarts its TC: lay it out on the physical frame axis
        # (axisAnchors label tc/rec per position; seams mark the session boundaries), exactly like DV
        "multiSession": multi,
        "axisAnchors": anchors,
        "seams": list(hdv.get("seams") or []),
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
        "captures": [_hdv_capture(s, files_by_tag, frame_ext, _axis_to_frame) for s in sources],
        "segments": _hdv_segments(segs, hdv["total_frames"]),
        "damage": damage,
        "divergences": hdv["divergences"],
    }


# ---------- DV (dvmerge.analysis/1) ----------
#
# dvmerge lays the tape out on a PHYSICAL axis (``pf`` — FramePos, frames in tape read order, with
# missing frames taking their width), NOT on tape timecode, because a DV tape commonly holds several
# recording sessions whose record-run tc each restart (overwrite, multi-day footage, over-capture).
# We pass that physical axis straight through as ``axis`` and carry dvmerge's per-position tc/rec
# ``anchors`` and session ``seams`` so the map can label by tc and mark the boundaries.

def _dv_damage(dv):
    """dvmerge re-capture spans -> the unified damage list. A span that is purely ``missing`` (no
    capture has it) maps to ``missing``; anything with damaged-but-present frames (mosaic, or
    mosaic+missing) maps to ``dirty`` — there are copies to improve on. ``axis`` is the physical
    ``pf`` extent; ``runs`` carry both tc (labels) and pf (layout) so the map can draw the real
    scattered damage on either axis."""
    files = dv["files"]
    out = []
    for i, sp in enumerate(dv["spans"]):
        cover = [files[j] for j in sp["cover"] if j < len(files)]
        sev = sp["kind"]
        if sp.get("bmax"):
            sev += " · max %d blk" % sp["bmax"]
        runs = sp.get("runs") or []
        out.append({
            "id": "s%d" % i,
            "kind": "missing" if sp["kind"] == "missing" else "dirty",
            "axis": [sp["pf0"], sp["pf1"]],
            "tcStart": sp["tc0"], "tcEnd": sp["tc1"],
            "recStart": sp["rdt0"], "recEnd": sp["rdt1"],
            "durationFrames": sp["length"],
            "coverage": cover,
            "copies": len(cover),
            "severity": sev,
            "runs": ([{"tcStart": r["tc0"], "tcEnd": r["tc1"], "axis": [r["pf0"], r["pf1"]]}
                      for r in runs]
                     or [{"tcStart": sp["tc0"], "tcEnd": sp["tc1"],
                          "axis": [sp["pf0"], sp["pf1"]]}]),
        })
    return out


def _dv_capture_damage(src):
    """This capture's OWN mosaic runs (Status 'P'), shown on its lane regardless of whether the merge
    repaired it from another copy — tc for labels, pf for the physical layout so a capture that is
    damaged throughout (a bad transfer) reads as mosaic the whole length of its lane."""
    return [{"tcStart": d.get("tc0"), "tcEnd": d.get("tc1"), "severity": "mosaic",
             "axis": [d.get("pf0"), d.get("pf1")]}
            for d in src.get("damage", [])]


def _dv_capture(src, files_by_tag):
    tag = src["tag"]
    if not src.get("aligned"):
        return {"tag": tag, "file": files_by_tag.get(tag, tag), "axis": [0, 0],
                "tcSpan": [None, None], "recSpan": [None, None], "health": [], "damage": [],
                "ranges": []}
    cov = src.get("coverage") or []
    ranges = ([{"tcStart": c["tc0"], "tcEnd": c["tc1"], "axis": [c.get("pf0"), c.get("pf1")]}
               for c in cov]
              or [{"tcStart": src["tc0"], "tcEnd": src["tc1"],
                   "axis": [src.get("pf0", 0), src.get("pf1", 0)]}])
    out = {
        "tag": tag,
        "file": files_by_tag.get(tag, tag),
        "axis": [src.get("pf0", 0), src.get("pf1", 0)],
        "tcSpan": [src["tc0"], src["tc1"]],
        "recSpan": [src["rdt0"], src["rdt1"]],
        "health": [],
        "damage": _dv_capture_damage(src),
        # the runs this capture actually holds, split at its internal drops — tc for labels, pf for
        # layout (falls back to the whole span on an older dvmerge that doesn't surface coverage)
        "ranges": ranges,
    }
    # the STA concealment profile from dvrescue's -x XML (how heavily/by which method this pass is
    # concealed, and the azimuth split) — characterises each transfer (HDV captures have none)
    if src.get("errorProfile"):
        out["errorProfile"] = src["errorProfile"]
    return out


def _dv_segments(dv):
    """Result-track coverage segments straight from dvmerge: the coarse covered runs on the physical
    axis, already split at session seams and large missing holes. ``gapBefore`` marks a run that a
    seam or a missing hole precedes (drawn in the seam colour)."""
    title = _title(dv["files"])
    return [{
        "tag": title,
        "axis": [s["pf0"], s["pf1"]],
        "tcSpan": [s["tc0"], s["tc1"]],
        "recSpan": [s["rdt0"], s["rdt1"]],
        "gapBefore": bool(s.get("break_before")),
    } for s in dv.get("segments", [])]


def from_dvmerge(dv, working_dir, files_by_tag):
    """``dvmerge.analysis/1`` dict -> ``tapeflow.analysis/1`` dict. Laid out on dvmerge's physical
    ``pf`` axis; ``segments`` are dvmerge's coarse covered runs, ``axisAnchors``/``seams`` let the
    map label tc/rec per position and mark recording-session boundaries."""
    fps = dv["fps"]
    damage = _dv_damage(dv)
    anchors = [{"axis": a["pf"], "tc": a["tc"], "rec": a["rdt"]} for a in dv.get("anchors", [])]
    return {
        "schema": SCHEMA,
        "format": "dv",
        "dir": working_dir,
        "fps": fps,
        "complete": dv["complete"],
        "buildable": True,   # dvrescue always writes a valid DV stream; there is no seam concept
        "tape": {
            "tcStart": dv["tc0"], "tcEnd": dv["tc1"],
            "recStart": dv["rdt0"], "recEnd": dv["rdt1"],
            "durationFrames": dv["total_frames"],   # PHYSICAL frame count (the pf axis extent)
            "title": _title(dv["files"]),
            "recAnchors": [],
            # per-position (pf -> tc, rec) curve so the map labels each physical position; and the
            # physical positions of recording-session boundaries (seam markers). multiSession tells
            # the map to lay out on the physical axis instead of tc (which restarts at every session).
            "axisAnchors": anchors,
            "seams": list(dv.get("seams", []) or []),
            "multiSession": bool(dv.get("multi_session")),
        },
        "summary": {
            "recaptureSpots": len(damage),
            "missingFrames": dv["miss"],
            "unusedCaptures": sum(1 for s in dv["sources"] if not s.get("aligned")),
        },
        "captures": [_dv_capture(s, files_by_tag) for s in dv["sources"]],
        "segments": _dv_segments(dv),
        "damage": damage,
        "divergences": [],
    }
