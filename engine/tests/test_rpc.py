"""The JSON-RPC dispatch: results, errors, notifications, and progress passthrough."""

import unittest

from tapeflow_engine import rpc


def _noop(method, params):
    pass


class TestDispatch(unittest.TestCase):
    def test_result(self):
        methods = {"ping": lambda p, notify=None: {"ok": True, "echo": p}}
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 7, "method": "ping", "params": {"a": 1}},
                         methods, _noop)
        self.assertEqual(r["id"], 7)
        self.assertEqual(r["result"], {"ok": True, "echo": {"a": 1}})

    def test_method_not_found(self):
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 1, "method": "nope"}, {}, _noop)
        self.assertEqual(r["error"]["code"], rpc.METHOD_NOT_FOUND)

    def test_invalid_request_missing_jsonrpc(self):
        r = rpc.dispatch({"id": 1, "method": "ping"}, {"ping": lambda p, notify=None: 1}, _noop)
        self.assertEqual(r["error"]["code"], rpc.INVALID_REQUEST)

    def test_notification_gets_no_response(self):
        methods = {"ping": lambda p, notify=None: 1}
        r = rpc.dispatch({"jsonrpc": "2.0", "method": "ping"}, methods, _noop)  # no id
        self.assertIsNone(r)

    def test_value_error_is_invalid_params(self):
        def boom(p, notify=None):
            raise ValueError("bad dir")
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 2, "method": "boom"}, {"boom": boom}, _noop)
        self.assertEqual(r["error"]["code"], rpc.INVALID_PARAMS)
        self.assertIn("bad dir", r["error"]["message"])

    def test_not_implemented_is_internal_error(self):
        def todo(p, notify=None):
            raise NotImplementedError("soon")
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 3, "method": "todo"}, {"todo": todo}, _noop)
        self.assertEqual(r["error"]["code"], rpc.INTERNAL_ERROR)

    def test_unexpected_exception_becomes_error_not_crash(self):
        def crash(p, notify=None):
            return 1 / 0
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 4, "method": "crash"}, {"crash": crash}, _noop)
        self.assertEqual(r["error"]["code"], rpc.INTERNAL_ERROR)
        self.assertIn("ZeroDivisionError", r["error"]["message"])

    def test_progress_notifications_pass_through(self):
        got = []
        def work(p, notify=None):
            notify("progress", {"done": 1, "total": 2})
            notify("progress", {"done": 2, "total": 2})
            return {"ok": True}
        r = rpc.dispatch({"jsonrpc": "2.0", "id": 5, "method": "work"}, {"work": work},
                         lambda m, pr: got.append((m, pr)))
        self.assertEqual(r["result"], {"ok": True})
        self.assertEqual(got, [("progress", {"done": 1, "total": 2}),
                               ("progress", {"done": 2, "total": 2})])


if __name__ == "__main__":
    unittest.main()
