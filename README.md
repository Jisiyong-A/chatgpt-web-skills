# ChatGPT Web Skills 包

把 **真实 ChatGPT 网页版** 包装成 AI Agent 可用的完整工具链：本地 OpenAI 兼容端点 + CDP 文件上传 + 使用路由规则。

让任何 Agent（Hermes / Codex / 自研脚本）能调用**登录态下的 ChatGPT 网页版**——免费、无需 API key、支持文件上传审核。

## 包含什么

```
chatgpt-web-skills/
├── skills/                          # Agent 技能包（SKILL.md 标准格式）
│   ├── chatgpt-web-upload/          # 上传文件(MP3/PDF/图片)到网页版并发送提示词
│   │   ├── SKILL.md
│   │   └── scripts/cdp_chatgpt_upload.py
│   ├── chatgpt-web-provider-ops/    # provider 部署/运维/故障排查
│   │   └── SKILL.md
│   └── chatgpt-web-usage/           # 何时用/怎么用（路由决策）
│       └── SKILL.md
├── provider/                        # chatgpt-web-provider 完整源码
│   ├── src/                         # TS+fastify: OpenAI 兼容 API
│   │   ├── api/                     #   /v1/chat/completions, /v1/responses, /v1/models
│   │   ├── browser/                 #   Chrome CDP 驱动
│   │   └── chatgpt/                 #   网页会话状态机(新对话/流式/重连)
│   ├── tests/                       # 76 单元测试 + 浏览器集成测试
│   ├── scripts/                     # 诊断/压力测试/冒烟脚本
│   ├── CODEX_SHARING_GUIDE.md       # Codex 接入指南
│   └── HERMES_SHARING_GUIDE.md      # Hermes 接入指南
└── README.md                        # 本文件
```

## 架构

```
OpenAI 客户端 (Hermes/Codex/脚本)
    │  OpenAI 兼容 API
    ▼
127.0.0.1:8765  (provider: TS+fastify)
    │  Chrome DevTools Protocol
    ▼
Chrome (CDP 9233, profile 已登录 chatgpt.com)
    │
    ▼
ChatGPT 网页版（真实会话）
```

**为什么不用官方 API**：网页版免费、无 API key、可传文件、额度就是你的订阅/免费额度。

## 快速开始（Windows）

### 1. 启动 Chrome（必须带 `--remote-allow-origins=*`）

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 \
  --user-data-dir="C:\Hermes\chatgpt-web-profile" \
  --remote-allow-origins=* --no-first-run "https://chatgpt.com"
```

首次使用：在弹出的窗口登录 ChatGPT（登录态持久化在 profile）。

### 2. 启动 provider

```bash
cd provider/
npm install --include=dev
CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9233 ADAPTER_PORT=8765 npm run dev
```

### 3. 验证

```bash
curl http://127.0.0.1:8765/v1/models
# → {"object":"list","data":[{"id":"chatgpt-web",...}]}
```

### 4. 接入 Agent

**Hermes**：config.yaml `custom_providers` 加 `base_url: http://127.0.0.1:8765/v1, model: chatgpt-web, name: chatgpt-web`，然后 `-m chatgpt-web` 调用。

**Codex**：见 `provider/CODEX_SHARING_GUIDE.md`（支持 /v1/responses）。

### 5. 上传文件给网页版审核

```bash
python skills/chatgpt-web-upload/scripts/cdp_chatgpt_upload.py \
  --file audio.mp3 --prompt "审核这段音频" --port 9233
```

## Skills 安装到 Agent

把 `skills/` 下任意 skill 目录放进 Agent 的 skills 目录即可（Hermes: `hermes skills install` 或直接复制到 profile skills 目录）。

## 关键设计

- **防阻塞 CDP 客户端**：超时匹配循环（事件消息丢弃）、每次操作刷新 target 端点、轮询替代一次性等待——杜绝 WebSocket 死等
- **网页会话状态机**：新对话精确匹配、流式输出、断线自动重连、恰一次提交
- **真实用户输入模拟**：`Input.insertText` 走 CDP 输入域，React 编辑器才认
- **双协议**：`/v1/chat/completions`（OpenAI 标准）+ `/v1/responses`（Codex 专用）

## 测试

```bash
cd provider/
npm test          # 76 单元测试
npx playwright test   # 浏览器集成测试（需 Chrome + 登录态）
```

## 已知坑

| 坑 | 解法 |
|---|---|
| CDP WebSocket 403 | Chrome 缺 `--remote-allow-origins=*`，重启 Chrome 带全参数 |
| 401 Missing Auth | 网页会话过期，profile Chrome 重新登录 |
| body 为空/evaluate ERR | SPA 未渲染完，用轮询；不是连接坏了 |
| npm install 后缺 tsx | 必须 `--include=dev` |

## License

MIT（provider 内 LICENSE 为准）
