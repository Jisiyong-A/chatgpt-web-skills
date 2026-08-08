---
name: chatgpt-web-provider-ops
description: "部署/运维 chatgpt-web-provider(本地OpenAI端点, 用CDP驱动真实ChatGPT网页版)。触发: 搭建/修复/诊断 chatgpt-web 通道时。"
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [chatgpt, provider, deployment, ops, cdp]
---

# chatgpt-web-provider 部署运维

把 ChatGPT 网页版包装成本地 OpenAI 兼容端点（`http://127.0.0.1:8765/v1`，model id = `chatgpt-web`），
任何 OpenAI SDK 客户端（Hermes/Codex/脚本）都能直接调用真实 ChatGPT 网页会话。

## 架构

```
OpenAI 客户端 → 127.0.0.1:8765 (TS+fastify, 本 skill 的 provider/)
              → CDP 9233 → Chrome (profile: C:\Hermes\chatgpt-web-profile, 已登录 chatgpt.com)
```

## 部署步骤（Windows）

1. **前置**：Node.js + npm，Python 3.10+（watchdog 用）
2. **启动 Chrome**（必须带 `--remote-allow-origins=*`，否则 CDP WebSocket 403）：
   ```bash
   "/c/Program Files/Google/Chrome/Application/chrome.exe" \
     --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 \
     --user-data-dir="C:\Hermes\chatgpt-web-profile" \
     --remote-allow-origins=* --no-first-run "https://chatgpt.com"
   ```
3. **首次使用**：在弹出的 Chrome 里手动登录 ChatGPT（cookie 持久化在该 profile）
4. **启动 provider**：
   ```bash
   cd provider/
   npm install --include=dev
   CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9233 ADAPTER_PORT=8765 npm run dev
   ```
5. **验证**：
   ```bash
   curl http://127.0.0.1:8765/v1/models          # 应返回 model: chatgpt-web
   curl http://127.0.0.1:8765/v1/chat/completions -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"hi"}]}'
   ```

## 接入 Hermes

```yaml
# config.yaml custom_providers 加一项:
- base_url: http://127.0.0.1:8765/v1
  model: chatgpt-web
  name: chatgpt-web
```
调用：`hermes -z ... chat -m chatgpt-web` 或配置为 fallback。

## 日常运维

| 症状 | 处理 |
|---|---|
| provider 挂了 | 看 `kill-chatgpt-chrome.ps1` 清理后重启；watchdog 会自愈 |
| CDP 403 (WebSocket 握手拒) | **Chrome 缺 `--remote-allow-origins=*`**（watchdog 拉起的实例可能参数不全）→ 按上文命令重启 Chrome |
| 401 Missing Auth header | 网页会话过期 → 在 profile Chrome 里重新登录 chatgpt.com |
| 回复慢/超时 | 网页版排队；检查 Chrome 窗口是否被关闭 |
| 模型列表空 | `/v1/models` 应返回 chatgpt-web；检查 ADAPTER_PORT |

## 支持 Codex

provider 实现了 `/v1/responses` 端点（wire_api=responses），Codex CLI 可直接用：
`codex --provider chatgpt-web`（详见 provider/CODEX_SHARING_GUIDE.md）

## Pitfalls

- **不要动 profile 目录**：`C:\Hermes\chatgpt-web-profile` 是登录态所在，删除=重新登录
- **Chrome 单实例限制**：同一 user-data-dir 不能开两个实例
- **npm 全局 omit=dev**：必须 `--include=dev` 安装（tsx 等 devDeps 是运行时依赖）
- **网页版无 API key**：所有"key"只是占位，鉴权在网页会话
