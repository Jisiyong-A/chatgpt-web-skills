---
name: chatgpt-web-upload
description: "给ChatGPT网页版(CDP 9233)上传文件并发送提示词。触发: 传MP3/PDF到chatgpt.com审核时。"
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [chatgpt, cdp, upload, web-automation, chrome]
---

# ChatGPT 网页版 CDP 上传工具

把文件（MP3/PDF/图片等）上传到 **已登录的 ChatGPT 网页版**（CDP 9233，profile `C:\Hermes\chatgpt-web-profile`）并发送提示词。

## 前置条件

1. chatgpt-web-profile Chrome 已启动且已登录：CDP 9233
   - 未启动时用：`"/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 --user-data-dir="C:\Hermes\chatgpt-web-profile" --remote-allow-origins=* --no-first-run "https://chatgpt.com"`
2. Python 有 `websocket-client`（Hermes venv 已有）
3. 必须已登录 ChatGPT（否则上传后无回复）

## 用法

```bash
python scripts/cdp_chatgpt_upload.py --file /path/a.mp3 --prompt "审核这段音频"
python scripts/cdp_chatgpt_upload.py --file a.mp3 --file b.pdf --prompt "..." --port 9233
```

参数:
- `--file` 可多次指定（多文件上传）
- `--prompt` 必填，发送给 ChatGPT 的提示词
- `--port` 默认 9233
- `--reply-timeout` 默认 300s（音频审核很慢，酌情加大）

## 流程

1. 前置检查 CDP 在线 + 找到 chatgpt 页面 target
2. `DOM.setFileInputFiles` 设置文件（ChatGPT 有多个 file input，逐个设置）
3. 轮询等待文件 chip 出现（上限 60s）
4. 聚焦编辑器 → `Input.insertText` 输入提示词（模拟真实输入，React 才认）
5. 点发送按钮（不可用则 Enter）
6. 轮询等待 assistant 回复（上限 300s，可调）

## 三大防阻塞修复（血泪教训）

### ① cdp_call() 超时匹配循环（最重要）
CDP 是单 WS 异步协议，recv 会收到大量**事件消息**（Network/Page/Runtime 事件，上传时尤其多）。
**错误写法**：recv 到非匹配 id 的消息就死等/抛错 → 挂到超时甚至永久。
**正确写法**：`while time.time() < deadline:` 循环 recv，`msg.get('id') == req_id` 才返回，
事件消息直接忽略继续；`ws.settimeout()` 兜底，绝不无限等待。

### ② 每次操作前刷新 target 端点
页面导航/reload 后 `webSocketDebuggerUrl` 会变，缓存旧端点会导致连接挂起。
**必须**每次从 `http://127.0.0.1:<port>/json` 重新拉取 target。

### ③ 上传/回复用轮询，不用一次性等待
SPA 异步渲染：上传后 chip 要 3-10s 才出现，音频回复可能 1-5 分钟。
用 `poll_until()`（间隔 1.5s + 上限），不要 sleep 一次猜时间，也不要无上限死等。

## Pitfalls

- **body 为空不是连接坏了**：新对话页是 SPA，内容异步渲染。先轮询再下结论。
- **3 个 file input 节点**：ChatGPT 有多个 `input[type=file]`，全部 set 一遍，总有一个生效。
- **输入框是 contenteditable**：`el.value=` 对 React 无效，用 `Input.insertText`（需先 focus）或 `document.execCommand('insertText')`。
- **发送按钮 data-testid="send-button"**，发送中会变 stop-button。
- **回复判断**：`[data-message-author-role="assistant"]` 最后一个元素 innerText 长度 > 20。
- **音频/视频审核慢**：reply-timeout 给 300-600s，别误判为卡死。
- **不要用 Hermes 内置 stealth 浏览器**：未登录 + 被 Cloudflare 拦，看不到已登录的 CDP Chrome。

## 验证

脚本成功输出 `===== ChatGPT 回复 =====` 即完成。失败时按错误提示检查:
- `CDP 不可达` → Chrome 没起/端口错
- `找不到 file input` → 页面没加载完或已开上传弹窗（脚本会自动点 attach 按钮）
- `等待回复超时` → 加大 --reply-timeout 或检查登录态
