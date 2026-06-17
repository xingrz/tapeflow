"""The thin CLI front-end. Exercises argument parsing and the user-error path (bad dir / mixed
formats / missing output) without any engine or external binary — the merge itself is engine-bound
and covered by the manual smokes, exactly like the build/thumbnail behaviour in test_actions."""

import io
import json
import os
import tempfile
import unittest

from tapeflow_engine import cli


def _touch(d, name):
    open(os.path.join(d, name), "wb").close()


def _run(argv):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(argv, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


class TestCli(unittest.TestCase):
    def test_no_command_exits(self):
        with self.assertRaises(SystemExit):           # argparse: a subcommand is required
            _run([])

    def test_build_requires_output_positional(self):
        with self.assertRaises(SystemExit):           # argparse: `build <dir>` is missing `output`
            _run(["build", "/some/dir"])

    def test_analyze_bad_dir_reports_error(self):
        code, out, err = _run(["analyze", "/no/such/dir/xyzzy"])
        self.assertEqual(code, 2)                     # ValueError -> clean error, not a traceback
        self.assertEqual(out, "")
        self.assertIn("error:", err)

    def test_analyze_mixed_formats_reports_error(self):
        d = tempfile.mkdtemp()
        _touch(d, "a.m2t")
        _touch(d, "b.dv")
        code, _, err = _run(["analyze", d])
        self.assertEqual(code, 2)
        self.assertIn("error:", err)

    def test_capabilities_prints_json(self):
        code, out, _ = _run(["capabilities"])         # no engines/binaries needed; reports absence
        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertIn("version", doc)
        self.assertIn("engines", doc)

    def test_compact_is_single_line(self):
        code, out, _ = _run(["--compact", "capabilities"])
        self.assertEqual(code, 0)
        self.assertEqual(len(out.strip().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
