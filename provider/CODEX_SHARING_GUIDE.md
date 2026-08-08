# 给朋友的安装指南：让 Codex 用上 ChatGPT 网页版

> 一句话：这个工具让你本地的 **Codex CLI 直接驱动你登录的 ChatGPT 网页版**（GPT-5.x），
> **不需要 OpenAI API key，不花 API 钱**——用的就是你的 ChatGPT 账号。
> 适配器在本地起一个 OpenAI 兼容服务（127.0.0.1:8765），Codex 指向它即可。

---

## 1. 这是什么

```
Codex CLI
   ↓ (OpenAI Responses API)
本地适配器  http://127.0.0.1:8765/v1/responses
   ↓ (Playwright / CDP)
专用 Chrome（你登录过的 ChatGPT 账号）
   ↓
chatgpt.com 网页版
```

**安全边界**（设计如此，请放心）：
- 不提取你的 Cookie / Token / 密码
- 不绕过 ChatGPT 的 CAPTCHA / 限流 / 安全验证
- 只在本地运行（127.0.0.1），不对外网开放
- 遇到登录失效、限流、人机验证，会停止并明确报错，绝不硬闯

---

## 2. 前置条件（Windows）

| 项目 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 |
| Node.js | ≥ 20（建议 24，下载：https://nodejs.org） |
| Chrome | 已安装（系统自带即可） |
| ChatGPT 账号 | 有一个能登录 chatgpt.com 的账号 |

---

## 3. 安装适配器

```powershell
# 1) 下载代码（或让朋友把 chatgpt-web-provider 文件夹发给你）
git clone <你朋友的仓库地址> chatgpt-web-provider
cd chatgpt-web-provider

# 2) 安装依赖（注意：必须带 --include=dev，否则缺少编译工具）
npm install --include=dev

# 3) 验证（可选但推荐）
npm run build          # 应无报错
npm run test           # 应显示 76 passed
```

---

## 4. 首次登录（只需一次）

双击运行 `start-adapter.bat`，或者手动执行：

```powershell
# 启动专用 Chrome（登录态保存在 C:\Hermes\chatgpt-web-profile）
"C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 `
  --user-data-dir="C:\Hermes\chatgpt-web-profile" `
  --no-first-run --no-default-browser-check "https://chatgpt.com"
```

在弹出的 Chrome 窗口里**登录 ChatGPT 一次**。之后登录态会一直保存在这个专用 profile 里（和你的日常 Chrome 互不干扰）。

接着启动适配器：

```powershell
# 在项目目录里
$env:CHROME_LAUNCH_AT_STARTUP="false"
$env:CHROME_CDP_PORT="9233"
$env:ADAPTER_PORT="8765"
.\node_modules\.bin\tsx.cmd src\index.ts
```

看到 `listening on http://127.0.0.1:8765` 就成功了。验证：

```powershell
curl http://127.0.0.1:8765/health
# 期望: {"status":"ok","browser_connected":true,...,"auth_state":"authenticated",...}
```

---

## 5. 配置 Codex

编辑 `%USERPROFILE%\.codex\config.toml`（没有就新建）：

```toml
model = "chatgpt-web"
model_provider = "chatgptweb"

[model_providers.chatgptweb]
name = "ChatGPT Web"
base_url = "http://127.0.0.1:8765/v1"
env_key = "CHATGPT_WEB_API_KEY"
```

然后设置环境变量（PowerShell）：

```powershell
setx CHATGPT_WEB_API_KEY local-adapter-secret
# 重新打开终端生效（适配器没有强制校验，占位即可）
```

> 说明：Codex 2026 版只支持 Responses API（`wire_api="responses"`），
> 适配器已内置 `/v1/responses` 兼容端点，所以不需要额外配置 `wire_api`。

---

## 6. 验证 Codex

```powershell
codex "用一句话介绍你自己"
```

如果看到 ChatGPT 网页版风格的回复（比如"我是 GPT-5.x..."），就成功了 🎉

再试试写代码任务：

```powershell
cd 你的项目目录
codex "帮我写一个 Python 函数：判断一个字符串是否是回文"
```

---

## 7. 日常使用

- **每次开机**：双击 `start-adapter.bat`（它会自动启动 Chrome + 适配器，重复运行也没关系，不会开两个）
- **如果 ChatGPT 网页上登录掉了**：在专用 Chrome 里重新登录一次即可
- **平时不用关**：放着就行，不占什么资源；不用 Codex 时关掉 Chrome 窗口即可

可选：想让它开机自动启动（不推荐，保持简单）——用任务计划程序运行 `start-adapter.bat`。

---

## 8. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `503 BROWSER_UNAVAILABLE` | Chrome 没启动或 CDP 端口被占 | 运行 `start-adapter.bat`；确认 9233 端口空闲 |
| `auth_state: not_checked / unknown` | 专用 Chrome 没登录 | 打开专用 Chrome 登录 chatgpt.com 一次 |
| 回复很慢（10-30 秒） | ChatGPT 网页生成本来就要这么久 | 正常，不是卡死 |
| `404 /v1/responses` | 适配器版本旧（没有 Responses 端点） | `git pull` + `npm install --include=dev` + 重启 |
| 卡在生成中很久 | 页面状态异常 | 重启适配器（Ctrl+C 再启动） |
| Codex 报 `model_not_found` | config.toml 没生效 | 确认 `model` 和 `model_provider` 拼写、重启 Codex |

---

## 9. 给朋友的一句话总结

> 先跑 `start-adapter.bat`（登录一次 ChatGPT），
> 再改 `~/.codex/config.toml` 指向 `http://127.0.0.1:8765/v1`，
> 然后 Codex 就变成"ChatGPT 网页版驱动"了——零 API 费用。

---

## 技术备注（给好奇的朋友）

- 适配器 = TypeScript + Fastify + Playwright，SQLite 持久化（`D:\hermes\data\bridge.db`）
- 自带：恰好一次提交（不会重复发消息）、崩溃恢复、ChatGPT UI 变化自适应（语义定位 + 自愈规则）、工具调用协议（文本信封）
- 兼容任意 OpenAI 兼容客户端：除了 Codex，Cline / Aider / Continue / Open WebUI 都可以指过来用
- 完整规格与状态：`IMPLEMENTATION_STATUS.md`；故障手册：`RUNBOOK.md`
