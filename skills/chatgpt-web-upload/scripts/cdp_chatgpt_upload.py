#!/usr/bin/env python3
"""
ChatGPT 网页版 CDP 上传+发送工具（v1.1.0-hardening）
用法:
  python cdp_chatgpt_upload.py --file /path/to/file.mp3 --prompt "审核这段音频"
  python cdp_chatgpt_upload.py --file a.mp3 --file b.pdf --prompt "..." --port 9233

修复点（防阻塞 + 正确性）:
  1. cdp_call(): send 后带超时的匹配循环, 事件消息直接丢弃, 绝不死等
  2. eval_object_id(): Runtime.evaluate 返回 DOM 节点时取 objectId（returnByValue
     只给 value, DOM 节点需要 objectId 传给 DOM.setFileInputFiles）——P0 修复
  3. poll_until(): 上传/回复用轮询+上限, 不用一次性等待
  4. 上传失败/chip 未出现 → 停止, 绝不发送无附件请求 —— P0 修复
"""
import argparse, json, sys, time, urllib.request
import websocket

POLL_INTERVAL = 1.5

def get_target(port, url_contains="chatgpt"):
    """获取匹配 URL 的 page target（每次调用都刷新端点）"""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
        tabs = json.load(r)
    for t in tabs:
        if t.get("type") == "page" and url_contains in t.get("url", ""):
            return t
    return None

class CDP:
    def __init__(self, ws_url, timeout=30):
        self.ws = websocket.create_connection(ws_url, timeout=timeout)
        self._id = 0

    def call(self, method, params=None, timeout=30):
        """核心修复①: 匹配循环 + 硬超时, 事件消息丢弃, 绝不阻塞"""
        self._id += 1
        req_id = self._id
        self.ws.send(json.dumps({"id": req_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.ws.settimeout(max(0.5, deadline - time.time()))
            try:
                msg = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                break
            except Exception as e:
                return {"error": f"ws error: {e}"}
            if msg.get("id") == req_id:
                if "error" in msg:
                    return {"error": msg["error"]}
                return msg.get("result", {})
            # 非匹配 id (事件/别的响应) → 忽略继续
        return {"error": f"timeout after {timeout}s waiting for {method}"}

    def eval_result(self, expression, timeout=20):
        """返回 Runtime.evaluate 的完整 result 对象（含 value 和 objectId）。"""
        r = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True},
            timeout=timeout,
        )
        if "error" in r:
            return None
        return r.get("result", {})

    def eval_value(self, expression, timeout=20):
        """执行 JS 并返回可序列化的 value; DOM 节点/不可序列化时返回 None。"""
        result = self.eval_result(expression, timeout=timeout)
        if not result:
            return None
        return result.get("value")

    def eval_object_id(self, expression, timeout=20):
        """P0 修复: DOM 节点的 objectId 在 result.objectId, 不在 value 里。"""
        result = self.eval_result(expression, timeout=timeout)
        if not result:
            return None
        return result.get("objectId")

    def release_object(self, object_id):
        """释放 RemoteObject, 避免泄漏。"""
        if object_id:
            self.call("Runtime.releaseObject", {"objectId": object_id}, timeout=5)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

def poll_until(fn, desc, timeout, interval=POLL_INTERVAL):
    """核心修复③: 轮询+上限"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            v = fn()
            if v:
                print(f"  ✓ {desc}")
                return True
        except Exception:
            pass
        time.sleep(interval)
    print(f"  ✗ 超时: {desc} (>{timeout}s)")
    return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", action="append", required=True, help="要上传的文件(可多次)")
    ap.add_argument("--prompt", required=True, help="发送给 ChatGPT 的提示词")
    ap.add_argument("--port", type=int, default=9233)
    ap.add_argument("--reply-timeout", type=int, default=300, help="等待回复上限(秒)")
    args = ap.parse_args()

    # 0. 前置检查: Chrome/CDP 在线
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/version", timeout=3) as r:
            json.load(r)
        print(f"✓ CDP {args.port} 在线")
    except Exception as e:
        print(f"✗ CDP {args.port} 不可达: {e}\n  请先启动 chatgpt-web-profile Chrome (9233)")
        sys.exit(1)

    # 1. 拿到最新 target（核心修复②: 每次刷新端点）
    target = get_target(args.port)
    if not target:
        print("✗ 没找到 ChatGPT 页面, 请先打开 chatgpt.com")
        sys.exit(1)
    print(f"✓ 目标页面: {target.get('url','')[:60]}")

    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    cdp.call("DOM.enable")

    # 2. 上传文件: 找到所有 file input 并设置 (ChatGPT 有多个 input 节点)
    inputs = cdp.eval_value("""
      (() => { const els = document.querySelectorAll('input[type=file]');
                return els.length ? Array.from(els).map((_, i) => i) : null; })()
    """)
    if inputs is None:
        # 没有 file input 就打开上传入口
        print("· 未找到 file input, 尝试打开上传入口...")
        cdp.eval_value("""
          (() => { const b = document.querySelector('button[aria-label*="attach" i], button[data-testid="composer-attach"]');
                    if (b) b.click(); return !!b; })()
        """)
        time.sleep(2)
        inputs = cdp.eval_value("""
          (() => { const els = document.querySelectorAll('input[type=file]');
                    return els.length ? Array.from(els).map((_, i) => i) : null; })()
        """)
    if not inputs:
        print("✗ 找不到上传 input")
        cdp.close()
        sys.exit(1)

    # P0 修复: 用 eval_object_id 拿 DOM 节点 objectId, 设置后立即释放
    set_ok = False
    for i in inputs:
        object_id = cdp.eval_object_id(
            f"document.querySelectorAll('input[type=file]')[{i}]"
        )
        if not object_id:
            continue
        try:
            result = cdp.call(
                "DOM.setFileInputFiles",
                {"objectId": object_id, "files": args.file},
                timeout=30,
            )
            if "error" not in result:
                set_ok = True
                break
        finally:
            cdp.release_object(object_id)

    if not set_ok:
        print("✗ 文件设置失败: 所有 file input 都无法接受文件")
        cdp.close()
        sys.exit(1)
    print(f"✓ 文件已设置 ({len(args.file)} 个)")

    # 3. P0 修复: chip 未出现必须停止, 绝不发送无附件请求
    chip_ok = poll_until(
        lambda: cdp.eval_value(
            "!!document.querySelector('[data-testid*=\"file\"]')"
        ),
        "文件 chip 出现",
        timeout=60,
    )
    if not chip_ok:
        print("✗ 文件 chip 未出现, 停止发送(避免发送无附件请求)。若 ChatGPT 改了 selector 需更新脚本。")
        cdp.close()
        sys.exit(1)

    # 4. 输入提示词 (聚焦编辑器 → Input.insertText 模拟真实输入)
    focused = cdp.eval_value("""
      (() => { const ed = document.querySelector('#prompt-textarea, div[contenteditable="true"][data-testid*="composer"], div.prose');
                if (ed) { ed.focus(); return true; } return false; })()
    """)
    if focused:
        cdp.call("Input.insertText", {"text": args.prompt})
        time.sleep(1)
    else:
        print("· 编辑器未找到, 尝试粘贴方式...")
        cdp.eval_value(f"""
          (() => {{ const ed = document.querySelector('#prompt-textarea, div[contenteditable="true"]');
                    if (ed) {{ ed.focus();
                      document.execCommand('insertText', false, {json.dumps(args.prompt)});
                      return true; }} return false; }})()
        """)

    # 5. 点击发送
    sent = cdp.eval_value("""
      (() => { const b = document.querySelector('button[data-testid="send-button"]');
                if (b && !b.disabled) { b.click(); return true; } return false; })()
    """)
    if not sent:
        print("· 发送按钮不可用, 尝试 Enter...")
        cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13})
    print("✓ 已发送, 等待回复...")

    # 6. 轮询等待 assistant 回复 (音频审核可能很慢, 默认上限 300s)
    def got_reply():
        return cdp.eval_value("""
          (() => { const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
                    const t = msgs.length ? msgs[msgs.length-1].innerText : '';
                    return t && t.length > 20 ? t : null; })()
        """)
    deadline = time.time() + args.reply_timeout
    while time.time() < deadline:
        t = got_reply()
        if t:
            print("\n===== ChatGPT 回复 =====\n")
            print(t[:2000])
            print("\n===== 结束 =====")
            cdp.close()
            sys.exit(0)
        time.sleep(POLL_INTERVAL)

    print(f"✗ 等待回复超时 ({args.reply_timeout}s), 可能仍在处理或页面异常")
    cdp.close()
    sys.exit(1)

if __name__ == "__main__":
    main()
