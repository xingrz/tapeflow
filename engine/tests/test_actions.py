"""Routing + the build/thumbnail guard paths (no engines or ffmpeg needed). The full build/thumbnail
behaviour is engine/ffmpeg-bound and exercised by manual smokes against real media."""

import os
import tempfile
import unittest

from tapeflow_engine import analyze as analyzemod, build as buildmod, thumb as thumbmod


def _touch(d, name):
    open(os.path.join(d, name), "wb").close()


class TestRoute(unittest.TestCase):
    def test_hdv(self):
        d = tempfile.mkdtemp()
        _touch(d, "clip.m2t")
        self.assertEqual(analyzemod.route(d)[0], "hdv")

    def test_dv(self):
        d = tempfile.mkdtemp()
        _touch(d, "clip.dv")
        self.assertEqual(analyzemod.route(d)[0], "dv")

    def test_index_files_are_ignored(self):
        d = tempfile.mkdtemp()
        _touch(d, "clip.m2t")
        _touch(d, "clip.m2t.idx.jsonl")
        fmt, files = analyzemod.route(d)
        self.assertEqual(fmt, "hdv")
        self.assertEqual(len(files), 1)

    def test_mixed_formats_raise(self):
        d = tempfile.mkdtemp()
        _touch(d, "a.m2t")
        _touch(d, "b.dv")
        with self.assertRaises(ValueError):
            analyzemod.route(d)

    def test_empty_dir_raises(self):
        with self.assertRaises(ValueError):
            analyzemod.route(tempfile.mkdtemp())

    def test_not_a_directory_raises(self):
        with self.assertRaises(ValueError):
            analyzemod.route("/no/such/dir/xyzzy")


class TestBuildGuards(unittest.TestCase):
    def test_build_requires_output(self):
        d = tempfile.mkdtemp()
        _touch(d, "clip.m2t")
        with self.assertRaises(ValueError):
            buildmod.build({"dir": d})            # output omitted -> refuse before doing any work


class TestThumbnailGuards(unittest.TestCase):
    def test_requires_dir_and_file(self):
        with self.assertRaises(ValueError):
            thumbmod.thumbnail({"dir": tempfile.mkdtemp()})

    def test_missing_capture_raises(self):
        with self.assertRaises(ValueError):
            thumbmod.thumbnail({"dir": tempfile.mkdtemp(), "file": "nope.m2t"})


if __name__ == "__main__":
    unittest.main()
