"""tapeflow-engine — the Python sidecar.

It is the only component that knows both merge engines. It discovers the captures in a working
directory, routes by file extension to ``hdvmerge`` (HDV / MPEG-TS) or ``dvmerge`` (DV), consumes
each engine's ``--json`` analysis, and **normalises both into one model** (``tapeflow.analysis/1``)
that the Electron UI renders without caring which format it came from. It speaks JSON-RPC 2.0 framed
as newline-delimited JSON over stdio (see :mod:`tapeflow_engine.rpc`).
"""

__version__ = "1.0.0"

# The unified contract between the sidecar and the renderer. Versioned: reshaping it is a breaking
# change across the process boundary, so bump to /2 rather than silently changing fields.
SCHEMA = "tapeflow.analysis/1"
