"""A thin command-line front-end to the sidecar methods.

Same code, different door. The Electron app drives the sidecar as a long-lived JSON-RPC/NDLJSON
loop (:mod:`tapeflow_engine.rpc`); this is a one-shot CLI that dispatches the *very same*
:data:`tapeflow_engine.methods.METHODS` and prints the result as JSON. It exists so a script — or an
automated agent — can get the unified ``tapeflow.analysis/1`` (or run an export) without speaking
JSON-RPC: point it at a working dir and it routes the format, runs the engine, and prints the
normalised analysis.

It adds **no processing of its own**: ``build`` is byte-for-byte hdvmerge/dvmerge, exactly as the
GUI's export is, and ``analyze`` is the same normalisation the renderer consumes. stdout carries one
JSON document (the result); progress notifications stream to stderr so stdout stays clean.
"""

import argparse
import json
import sys

from . import __version__
from .methods import METHODS


def _notify(stream):
    """A ``notify(method, params)`` that writes progress to ``stream`` (stderr), one JSON line each,
    keeping stdout a single clean result document."""
    def notify(method, params):
        stream.write(json.dumps({"event": method, **params}, ensure_ascii=False) + "\n")
        stream.flush()
    return notify


def _emit(result, compact, out):
    out.write(json.dumps(result, indent=None if compact else 2, ensure_ascii=False) + "\n")


def main(argv=None, out=None, err=None):
    out = out or sys.stdout
    err = err or sys.stderr
    parser = argparse.ArgumentParser(
        prog="tapeflow",
        description="Analyse and merge overlapping DV/HDV tape captures — a thin CLI over the "
                    "tapeflow sidecar methods (the same logic the desktop app uses).",
    )
    parser.add_argument("--version", action="version", version="tapeflow-engine %s" % __version__)
    parser.add_argument("--compact", action="store_true",
                        help="emit the JSON result on one line instead of pretty-printed")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("capabilities",
                   help="report engine imports + ffmpeg/dvrescue presence and versions")
    p_an = sub.add_parser("analyze",
                          help="route a working dir by format and print the unified "
                               "tapeflow.analysis/1")
    p_an.add_argument("dir", help="working directory: the captures of ONE tape (one format)")
    p_ve = sub.add_parser("verify",
                          help="audit one already-built master from the file alone (READ-ONLY): its "
                               "TF tag + any duplicate frames")
    p_ve.add_argument("file", help="path to a built master file (.m2t/.ts/…)")
    p_bu = sub.add_parser("build",
                          help="export the merged file (byte-for-byte hdvmerge/dvmerge)")
    p_bu.add_argument("dir", help="working directory of captures")
    p_bu.add_argument("output", help="destination path for the merged file")

    args = parser.parse_args(argv)
    params = {"capabilities": {},
              "analyze": {"dir": getattr(args, "dir", None)},
              "verify": {"file": getattr(args, "file", None)},
              "build": {"dir": getattr(args, "dir", None),
                        "output": getattr(args, "output", None)}}[args.command]
    try:
        result = METHODS[args.command](params, notify=_notify(err))
    except (ValueError, KeyError) as e:
        # The same user-facing failures the RPC layer maps to INVALID_PARAMS (bad dir, mixed
        # formats, missing output, no dvrescue, …) — report cleanly instead of a traceback.
        err.write("error: %s\n" % e)
        return 2
    _emit(result, args.compact, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
