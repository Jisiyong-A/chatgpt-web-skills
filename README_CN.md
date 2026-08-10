<div align="center">

# 🤖 ChatGPT Web Skills

**把真实 ChatGPT 网页版变成你的 AI Agent 免费 API 通道**

[![GitHub stars](https://img.shields.io/github/stars/Jisiyong-A/chatgpt-web-skills?style=flat-square&color=black)](https://github.com/Jisiyong-A/chatgpt-web-skills)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Jisiyong-A/chatgpt-web-skills/pulls)

**网页登录态驱动 · 原生支持文件上传 · Agent Skills 开箱即用**

[English](README.md) | 中文

> ⚠️ **合规提示**：本项目通过本地 Chrome/CDP 驱动你的网页登录态，**不构成 OpenAI 官方 API**，
> 也不保证符合服务条款、账号政策或长期可用性。使用者必须自行检查当前条款、账号权限、隐私和数据处理要求。

</div>

---

## 🎯 这是什么

一套把 **你已登录的 ChatGPT 网页版** 包装成 **本地 OpenAI 兼容 API** 的完整工具链：

```
OpenAI 客户端 (Hermes / Codex / 任意脚本)
    │  OpenAI 兼容 API (chat/completions + responses)
    ▼
127.0.0.1:8765  (provider: TS + fastify)
    │  Chrome DevTools Protocol
    ▼
真实 Chrome (CDP 9233, 已登录的 chatgpt.com 会话)
```

**技术路径**：不是逆向私有 HTTP API，而是通过 Chrome DevTools Protocol 驱动**你自己的真实浏览器登录会话**——行为接近真人操作，避免直接逆向接口的稳定性问题。但这**不构成合规保证**：是否违反 OpenAI 服务条款由使用者自行评估。

## ✨ 特性

- 🔌 **OpenAI 兼容端点**：`/v1/chat/completions` + `/v1/responses`（Codex 2026 只认 Responses API）
- 🖥️ **CDP 驱动真实 Chrome**：非 HTTP 逆向，真人浏览器会话，抗风控
- 📎 **原生文件上传**：MP3 / PDF / 图片直接上传给网页版审核（同类项目几乎都不支持）
- 🧩 **Agent Skills 开箱即用**：上传、运维、路由规则三个标准 SKILL.md
- 🔄 **会话状态机**：新对话精确匹配、流式输出、断线自动重连、恰一次提交
- 🛡️ **防阻塞 CDP 客户端**：超时匹配循环 + 端点刷新 + 轮询，杜绝 WebSocket 死等
- 🧪 **76 单元测试 + 浏览器集成测试**，状态机经 20 并发压力测试

## 📊 与同类项目对比

| 能力 | **本仓库** | [chat2api](https://github.com/lanqian528/chat2api) | [ChatGPT-Web2API](https://github.com/Octo-Lex/ChatGPT-Web2API) | [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) |
|---|---|---|---|---|
| 驱动方式 | **真实 Chrome (CDP)** | HTTP 逆向 | CDP | 逆向/API 混合 |
| 逆向接口稳定性风险 | 🟡 低（真人会话路径） | 🔴 高 | 🟡 低 | 🟡 中 |
| 文件上传 (MP3/PDF) | ✅ **支持** | ❌ | ❌ | ❌ |
| Codex Responses API | ✅ **支持** | ❌ | ❌ | ✅ |
| Agent Skills 配套 | ✅ **3 个标准 skill** | ❌ | 仅 MCP | ❌ |
| 多模型聚合 | ❌ (专注 ChatGPT) | ❌ | ❌ | ✅ (46.5k⭐) |
| 安装复杂度 | 🟢 低 (npm + Chrome) | 🟡 中 (Docker) | 🟡 中 | 🟢 低 |

> **定位差异**：头部项目做"多平台聚合"，本仓库专注把 **ChatGPT 网页版这一个通道做到极致**——真实浏览器稳定会话 + 文件上传 + Agent 原生集成。

## 🚀 快速开始（Windows）

### 1. 启动 Chrome（必须带 `--remote-allow-origins=*`）

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 \
  --user-data-dir="C:\Hermes\chatgpt-web-profile" \
  --remote-allow-origins=* --no-first-run "https://chatgpt.com"
```

> ⚠️ 首次使用：在弹出的窗口手动登录 ChatGPT，登录态持久化在该 profile。

### 2. 生成本地 API key（v1.1.0 默认必填）

```bash
python -c "import secrets; print(secrets.token_hex(32))"   # 复制输出
setx ADAPTER_API_KEY <上一步的输出>                          # Windows 持久化
```

> 所有请求需带 `Authorization: Bearer <key>`。本机单用户可跳过（设 `ADAPTER_REQUIRE_API_KEY=false`），但不建议。

### 3. 启动 provider

```bash
cd provider/
npm install --include=dev
CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9233 ADAPTER_PORT=8765 ADAPTER_API_KEY=<key> npm run dev
```

### 4. 验证

```bash
curl -H "Authorization: Bearer <key>" http://127.0.0.1:8765/v1/models
# → {"object":"list","data":[{"id":"chatgpt-web",...}]}
```

### 4. 接入 Agent

**Hermes**：config.yaml `custom_providers` 添加（详见 [`docs/HERMES_INTEGRATION.md`](docs/HERMES_INTEGRATION.md)）：
```yaml
- name: chatgpt-web
  base_url: http://127.0.0.1:8765/v1
  api_key: <本地密钥>
  model: chatgpt-web
```
调用必须用 named provider 语法（单独 `-m chatgpt-web` 会因 key 解析路径不同而 401）：
```bash
hermes -z "..." chat -m chatgpt-web --provider custom:chatgpt-web
```

**会话保持（多轮对话，已验证 2026-08-10）**：同一 `X-Hermes-Session-Id` 的多次请求
复用同一网页线程（第二轮能引用第一轮内容），不同 session id 隔离到不同线程。
```bash
curl -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "X-Hermes-Session-Id: my-session" \
  -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"记住暗号 MELON=西瓜汁，只回复：好"}]}'
```
> ⚠️ 注意：ChatGPT 网页版自带跨会话 Memory——显式让"记住"的内容可能被新线程引用（已验证）。

**Codex**：见 [`provider/CODEX_SHARING_GUIDE.md`](provider/CODEX_SHARING_GUIDE.md)。

### 5. 上传文件给网页版审核

```bash
python skills/chatgpt-web-upload/scripts/cdp_chatgpt_upload.py \
  --file audio.mp3 --prompt "审核这段音频" --port 9233
```

### 6. mode 参数（v1.3.0 新增，2026-08-11 实测）

`mode` 字段控制 composer 模式（**只在聊天视图运行**）：

| mode | 功能 | 状态 |
|---|---|---|
| `default` | 普通对话 | ✅ 稳定 |
| `image` | 创建图片 | ✅ live 验证通过（返回图片 URL） |
| `deep-research` | 深度研究 | ⚠️ 实验性（消息发出但 ChatGPT 端无响应，疑似工作额度 0%） |

```bash
curl -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"chatgpt-web","mode":"image","messages":[{"role":"user","content":"画一只猫"}]}'
# 响应含 {"mode":"image","images":["https://chatgpt.com/backend-api/estuary/content?id=..."]}
# 注意：图片 URL 是会话内临时链接，数分钟内有效
```

> 模型切换（多模型别名）：当前不可实现——2026-08 新版 UI 智能选择器自动化受限（详见 skills/chatgpt-web-usage）。

## 🧩 Skills 一览

| Skill | 作用 | 安装 |
|---|---|---|
| `chatgpt-web-upload` | CDP 上传文件 + 发送提示词（防阻塞版） | 复制 `skills/chatgpt-web-upload/` 到 Agent skills 目录 |
| `chatgpt-web-provider-ops` | provider 部署/运维/故障排查 | 同上 |
| `chatgpt-web-usage` | 何时用/怎么用（路由决策） | 同上 |

## 🔧 部署选项

- **Windows 本机**（推荐）：见上方快速开始
- **其他平台**：provider 是纯 Node.js + CDP，macOS/Linux 同样可用（改 `CHROME_PATH` 即可）
- **Docker**：见 [`provider/RUNBOOK.md`](provider/RUNBOOK.md)

## ❓ FAQ

**Q: 会被封号吗？**
A: 本项目驱动真实浏览器 + 真实登录态，不逆向私有接口。但**无法承诺合规**：请自行阅读 OpenAI 服务条款（含"不得自动或程序化提取数据或输出"等限制），在可信设备上仅作低频个人使用。

**Q: 为什么不用官方 API？**
A: 网页版无需 OpenAI API key（用登录态），额度=你的订阅/免费额度，还支持文件上传。官方 API 更适合需要 SLA/并发的生产场景。

**Q: 出现 401 Missing Auth header？**
A: 网页会话过期，去 profile Chrome 重新登录 chatgpt.com 即可。

**Q: CDP WebSocket 403？**
A: Chrome 启动时缺 `--remote-allow-origins=*`，按快速开始命令重启。

**Q: 支持多账号/多用户吗？**
A: 当前单账号（单 profile）。多账号可复制多份 provider 实例 + 独立 profile。

## 🔒 隐私声明

- 本项目**不会**把你的登录态/密钥上传到任何第三方服务器
- 所有流量在本地：浏览器 → 本机 provider → OpenAI 服务器
- profile 目录（登录态）只存在于你的本机磁盘
- 使用前请阅读 OpenAI 服务条款，遵守网页版使用规则

## 🧪 测试

```bash
cd provider/
npm test              # 76 单元测试
npx playwright test   # 浏览器集成测试（需 Chrome + 登录态）
```

## 🤝 贡献

欢迎 PR！方向建议：
- 多账号支持
- 更多 Agent 集成示例（Cursor / Windsurf / Continue）
- 非 Windows 平台的自动化部署脚本

## 📄 License

MIT —— 自由使用、修改、商用（保留版权声明即可）。

---

<div align="center">

**如果这个项目帮到了你，点个 ⭐ 就是最大的支持！**

</div>
