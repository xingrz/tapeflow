"""Normalising hdvmerge.analysis/1 -> tapeflow.analysis/1. Pure dict-in/dict-out, no engine import:
this is the seam where "DV and HDV behind one UI" happens, so it's pinned independently of the
engines actually running."""

import json
import unittest

from tapeflow_engine import normalize


def _hdv(residuals=(), gaps=(), unused=(), complete=True, bad_seams=0):
    return {
        "schema": "hdvmerge.analysis/1", "version": "0.1.0", "fps": 25.0,
        "total_frames": 200, "bad_seams": bad_seams, "complete": complete,
        "chain": ["capA", "capB"],
        "sources": [
            {"tag": "capA", "ngops": 40, "video_pid": 2064, "aux_pid": 2065, "fps": 25.0,
             "decoded": False, "shift": 0, "cc": 1, "tei": 0, "dec": 0,
             "rec0": "2007-01-01 09:00:00", "rec1": "2007-01-01 09:00:39",
             "tc0": "07:00:00:00", "tc1": "07:00:39:14"},
            {"tag": "capB", "ngops": 40, "video_pid": 2064, "aux_pid": 2065, "fps": 25.0,
             "decoded": False, "shift": 10, "cc": 0, "tei": 0, "dec": 0,
             "rec0": "2007-01-01 09:00:10", "rec1": "2007-01-01 09:00:49",
             "tc0": "07:00:10:00", "tc1": "07:00:49:24"}],
        "segments": [
            {"tag": "capA", "j0": 0, "j1": 29, "ngops": 30, "nbytes": 1000, "off": 0, "end": 1000,
             "frame0": 0, "gap_before": False, "rec": "2007-01-01 09:00:00",
             "rec_end": "2007-01-01 09:00:29", "tc": "07:00:00:00", "tc_end": "07:00:29:00"},
            {"tag": "capB", "j0": 20, "j1": 39, "ngops": 20, "nbytes": 800, "off": 0, "end": 800,
             "frame0": 120, "gap_before": False, "rec": "2007-01-01 09:00:30",
             "rec_end": "2007-01-01 09:00:49", "tc": "07:00:30:00", "tc_end": "07:00:49:24"}],
        "residuals": list(residuals),
        "divergences": [],
        "gaps": list(gaps),
        "unused_sources": list(unused),
    }


class TestNormalizeHdv(unittest.TestCase):
    def test_clean_tape_is_complete_and_serializable(self):
        d = normalize.from_hdvmerge(_hdv(), "/work", {"capA": "A.m2t", "capB": "B.m2t"})
        self.assertEqual(json.loads(json.dumps(d)), d)        # JSON round-trips

        self.assertEqual(d["schema"], "tapeflow.analysis/1")
        self.assertEqual(d["format"], "hdv")
        self.assertEqual(d["dir"], "/work")
        self.assertEqual(d["fps"], 25.0)
        self.assertTrue(d["complete"])
        self.assertTrue(d["buildable"])
        self.assertEqual(d["damage"], [])
        self.assertEqual(d["summary"]["recaptureSpots"], 0)

        self.assertEqual(d["tape"]["durationFrames"], 200)
        self.assertEqual(d["tape"]["tcStart"], "07:00:00:00")
        self.assertEqual(d["tape"]["tcEnd"], "07:00:49:24")
        # title is only a *separator*-delimited shared prefix (like hdvmerge's report); capA/capB
        # share no separator, so there's no clean batch name
        self.assertEqual(d["tape"]["title"], "")
        self.assertEqual(normalize._title(["CLIP-A", "CLIP-B"]), "CLIP")

        self.assertEqual([c["tag"] for c in d["captures"]], ["capA", "capB"])
        self.assertEqual(d["captures"][0]["file"], "A.m2t")
        self.assertEqual(d["captures"][0]["axis"], [0, 40])
        self.assertEqual([s["axis"] for s in d["segments"]], [[0, 120], [120, 200]])

    def test_residual_becomes_a_dirty_recapture_spot(self):
        res = [{"frame": 20, "rec": "2007-01-01 09:00:05", "tc": "07:00:05:00",
                "tag": "capA", "gop": 5, "cc": 1, "tei": 0, "dec": 0}]
        d = normalize.from_hdvmerge(_hdv(residuals=res, complete=False), "/work", {})
        self.assertFalse(d["complete"])
        self.assertEqual(len(d["damage"]), 1)
        spot = d["damage"][0]
        self.assertEqual(spot["kind"], "dirty")
        self.assertEqual(spot["coverage"], ["capA"])
        self.assertEqual(spot["copies"], 1)
        self.assertEqual(spot["tcStart"], "07:00:05:00")
        self.assertIn("continuity break", spot["severity"])
        self.assertEqual(d["summary"]["recaptureSpots"], 1)

    def test_consecutive_residuals_coalesce_into_one_spot(self):
        # three damaged GOPs within ~2 s on the same capture = one re-capture target
        res = [{"frame": f, "rec": None, "tc": "07:00:%02d:00" % (f // 4), "tag": "capA",
                "gop": f // 4, "cc": 1, "tei": 0, "dec": 0} for f in (20, 24, 28)]
        d = normalize.from_hdvmerge(_hdv(residuals=res, complete=False), "/work", {})
        self.assertEqual(len(d["damage"]), 1)
        self.assertEqual(d["damage"][0]["axis"], [20, 28])

    def test_gap_becomes_missing_with_no_coverage(self):
        d = normalize.from_hdvmerge(_hdv(gaps=[[40, 49]], complete=False), "/work", {})
        miss = [x for x in d["damage"] if x["kind"] == "missing"]
        self.assertEqual(len(miss), 1)
        self.assertEqual(miss[0]["coverage"], [])
        self.assertEqual(miss[0]["copies"], 0)
        self.assertGreater(d["summary"]["missingFrames"], 0)

    def test_bad_seams_makes_it_not_buildable(self):
        d = normalize.from_hdvmerge(_hdv(bad_seams=2, complete=False), "/work", {})
        self.assertFalse(d["buildable"])

    def test_unused_sources_counted(self):
        d = normalize.from_hdvmerge(_hdv(unused=[{"tag": "capC", "frames": 80}], complete=False),
                                    "/work", {})
        self.assertEqual(d["summary"]["unusedCaptures"], 1)

    def test_capture_carries_its_own_damage_runs(self):
        h = _hdv()
        h["sources"][0]["damage"] = [{"tc0": "07:00:05:00", "tc1": "07:00:06:00",
                                      "cc": 2, "tei": 0, "dec": 0, "ngops": 2}]
        d = normalize.from_hdvmerge(h, "/work", {})
        cap_a, cap_b = d["captures"]
        self.assertEqual(len(cap_a["damage"]), 1)
        self.assertEqual(cap_a["damage"][0]["tcStart"], "07:00:05:00")
        self.assertIn("continuity break", cap_a["damage"][0]["severity"])
        self.assertEqual(cap_b["damage"], [])        # source with no damage key -> empty


def _span(kind="mosaic", cover=(0,), miss=0, dmg=1, bmax=7):
    return {"tf0": 250, "tf1": 250, "length": 1, "tc0": "00:00:10:00", "tc1": "00:00:10:00",
            "rdt0": "2010-01-01 08:00:10", "rdt1": "2010-01-01 08:00:10",
            "kind": kind, "dmg": dmg, "miss": miss, "bmax": bmax, "cover": list(cover)}


def _dv(spans=(), miss=0, complete=True, unaligned=False):
    return {
        "schema": "dvmerge.analysis/1", "version": "0.1.0", "fps": 25.0,
        "total_frames": 1000, "tc0": "00:00:00:00", "tc1": "00:00:40:00",
        "rdt0": "2010-01-01 08:00:00", "rdt1": "2010-01-01 08:00:40",
        "clean": 1000 - miss, "dmg": 0, "miss": miss, "lost_frames": miss,
        "complete": complete, "files": ["A-1", "A-2"],
        "spans": list(spans),
        "sources": [
            {"tag": "A-1", "aligned": True, "tc0": "00:00:00:00", "tc1": "00:00:30:00",
             "rdt0": "2010-01-01 08:00:00", "rdt1": "2010-01-01 08:00:30"},
            {"tag": "A-2", "aligned": False} if unaligned else
            {"tag": "A-2", "aligned": True, "tc0": "00:00:10:00", "tc1": "00:00:40:00",
             "rdt0": "2010-01-01 08:00:10", "rdt1": "2010-01-01 08:00:40"}],
    }


class TestNormalizeDv(unittest.TestCase):
    def test_clean_tape_is_complete_and_serializable(self):
        d = normalize.from_dvmerge(_dv(), "/work", {"A-1": "A-1.dv", "A-2": "A-2.dv"})
        self.assertEqual(json.loads(json.dumps(d)), d)
        self.assertEqual(d["schema"], "tapeflow.analysis/1")
        self.assertEqual(d["format"], "dv")
        self.assertTrue(d["complete"])
        self.assertTrue(d["buildable"])
        self.assertEqual(d["segments"], [])              # DV has no segment chain
        self.assertEqual(d["damage"], [])
        self.assertEqual(d["tape"]["tcEnd"], "00:00:40:00")
        self.assertEqual([c["tag"] for c in d["captures"]], ["A-1", "A-2"])
        self.assertEqual(d["captures"][0]["file"], "A-1.dv")

    def test_mosaic_span_is_dirty_with_coverage(self):
        d = normalize.from_dvmerge(_dv(spans=[_span("mosaic", cover=(0,))], complete=False),
                                   "/work", {})
        self.assertEqual(len(d["damage"]), 1)
        spot = d["damage"][0]
        self.assertEqual(spot["kind"], "dirty")
        self.assertEqual(spot["coverage"], ["A-1"])
        self.assertEqual(spot["copies"], 1)
        self.assertIn("mosaic", spot["severity"])

    def test_missing_span_is_missing_with_no_coverage(self):
        d = normalize.from_dvmerge(
            _dv(spans=[_span("missing", cover=(), miss=5, dmg=0, bmax=0)], miss=5, complete=False),
            "/work", {})
        spot = d["damage"][0]
        self.assertEqual(spot["kind"], "missing")
        self.assertEqual(spot["coverage"], [])
        self.assertEqual(spot["copies"], 0)
        self.assertEqual(d["summary"]["missingFrames"], 5)

    def test_unaligned_source_counted(self):
        d = normalize.from_dvmerge(_dv(unaligned=True, complete=False), "/work", {})
        self.assertEqual(d["summary"]["unusedCaptures"], 1)

    def test_capture_carries_its_own_damage_runs(self):
        dv = _dv()
        dv["sources"][0]["damage"] = [{"tc0": "00:00:10:00", "tc1": "00:00:11:00", "frames": 25}]
        d = normalize.from_dvmerge(dv, "/work", {})
        cap = next(c for c in d["captures"] if c["tag"] == "A-1")
        self.assertEqual(len(cap["damage"]), 1)
        self.assertEqual(cap["damage"][0]["tcStart"], "00:00:10:00")
        self.assertEqual(cap["damage"][0]["severity"], "mosaic")


if __name__ == "__main__":
    unittest.main()
