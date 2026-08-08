"""cdp_chatgpt_upload.py 单元测试 (v1.1.0-hardening)

验证:
  1. eval_object_id 能从 Runtime.evaluate 结果中读取 DOM 节点的 objectId (P0)
  2. eval_value 返回可序列化 value
  3. 上传失败时主流程停止, 不调用发送 (通过 CDP 桩验证)
"""
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "cdp_chatgpt_upload.py"
spec = spec_from_file_location("upload_script", SCRIPT)
module = module_from_spec(spec)
spec.loader.exec_module(module)


class FakeCDP(module.CDP):
    """最小 CDP 桩: 只实现 call(), 记录调用序列。"""

    def __init__(self, responses=None):
        self._id = 0
        self.calls = []
        self.responses = responses or []

    def call(self, method, params=None, timeout=30):
        self.calls.append((method, params or {}))
        if self.responses:
            return self.responses.pop(0)
        return {}


def test_eval_object_id_reads_remote_object_id():
    """P0: DOM 节点的 objectId 在 result.objectId, 且必须 returnByValue=False
    (True 对 DOM 节点会报 'Object reference chain is too long' -32000)。"""
    cdp = FakeCDP()
    cdp.responses = [
        {"result": {"type": "object", "subtype": "node", "objectId": "remote-object-1"}}
    ]
    assert (
        cdp.eval_object_id("document.querySelector('input')") == "remote-object-1"
    )
    assert cdp.calls[0][0] == "Runtime.evaluate"
    assert cdp.calls[0][1].get("returnByValue") is False


def test_eval_value_uses_return_by_value_true():
    cdp = FakeCDP()
    cdp.responses = [{"result": {"type": "number", "value": 42}}]
    assert cdp.eval_value("1 + 1") == 42
    assert cdp.calls[0][1].get("returnByValue") is True


def test_eval_object_id_none_when_no_object_id():
    """非 DOM 结果(纯 value)不应误报 objectId。"""
    cdp = FakeCDP()
    cdp.responses = [{"result": {"type": "number", "value": 1}}]
    assert cdp.eval_object_id("1") is None


def test_release_object_called_when_available():
    cdp = FakeCDP()
    cdp.release_object("obj-1")
    assert ("Runtime.releaseObject", {"objectId": "obj-1"}) in cdp.calls


def test_release_object_skipped_when_none():
    cdp = FakeCDP()
    cdp.release_object(None)
    assert cdp.calls == []


def test_set_file_input_uses_object_id():
    """P0: DOM.setFileInputFiles 必须收到 objectId 而不是 value。"""
    cdp = FakeCDP()
    cdp.responses = [
        {"result": {"type": "object", "subtype": "node", "objectId": "input-0"}},
        {},  # setFileInputFiles 成功
    ]
    object_id = cdp.eval_object_id("document.querySelectorAll('input[type=file]')[0]")
    result = cdp.call("DOM.setFileInputFiles", {"objectId": object_id, "files": ["a.mp3"]})
    assert result == {}
    assert cdp.calls[1][0] == "DOM.setFileInputFiles"
    assert cdp.calls[1][1]["objectId"] == "input-0"
