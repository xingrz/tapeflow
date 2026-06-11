"""A tiny JSON-RPC 2.0 server framed as newline-delimited JSON (NDJSON) over stdio.

One JSON object per line. Requests get one response line; methods may emit ``progress``
notification lines (no id) while they run; stderr is for logs. Requests are handled sequentially —
the app runs one analysis/build at a time — which keeps the loop simple and correct.
"""

import json
import sys

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


def _error(rid, code, message):
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


def dispatch(req, methods, notify):
    """Handle one parsed request dict. Returns a response dict, or ``None`` for a notification
    (a request without ``id``). Pure apart from whatever the method itself does."""
    if not isinstance(req, dict) or req.get("jsonrpc") != "2.0" or "method" not in req:
        rid = req.get("id") if isinstance(req, dict) else None
        return _error(rid, INVALID_REQUEST, "invalid request")
    rid = req.get("id")
    fn = methods.get(req["method"])
    if fn is None:
        return _error(rid, METHOD_NOT_FOUND, "method not found: %s" % req["method"])
    try:
        result = fn(req.get("params") or {}, notify=notify)
    except NotImplementedError as e:
        return _error(rid, INTERNAL_ERROR, str(e) or "not implemented")
    except (ValueError, KeyError) as e:
        return _error(rid, INVALID_PARAMS, str(e))
    except Exception as e:  # noqa: BLE001 — surface any engine failure as an RPC error, never crash
        return _error(rid, INTERNAL_ERROR, "%s: %s" % (type(e).__name__, e))
    if rid is None:
        return None
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def serve(methods, stdin=None, stdout=None):
    """Read NDJSON requests from ``stdin``, write responses/notifications to ``stdout``."""
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout

    def send(obj):
        stdout.write(json.dumps(obj) + "\n")
        stdout.flush()

    def notify(method, params):
        send({"jsonrpc": "2.0", "method": method, "params": params})

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            send(_error(None, PARSE_ERROR, "parse error"))
            continue
        resp = dispatch(req, methods, notify)
        if resp is not None:
            send(resp)
