---
name: chatgpt-web-usage
description: "chatgpt-web(网页版GPT通道)何时用/怎么用。触发: 需要更强模型做独立问答/头脑风暴/翻译/总结/代码, 或用户明确要求用chatgpt网页端时。"
slug: chatgpt-web-usage
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [chatgpt, routing, usage, decision]
---

# chatgpt-web 使用规则（路由决策）

chatgpt-web 是把真实 ChatGPT 网页会话包装成本地 OpenAI 端点的通道。它**很强**（网页版 GPT 是顶级模型），
但**有代价**：慢（走网页）、不能并发；默认无会话上下文（需显式传 `X-Hermes-Session-Id` 保持会话）。

## 何时使用 ✅

- **独立问答 / 头脑风暴 / 初稿**：低上下文依赖、自包含的问题
- **翻译 / 总结**：单次输入输出的任务
- **代码任务**（编写/重构/调试/审查的独立片段）：GPT 网页版代码能力强
- 用户**明确说**"主要使用 chatgpt 网页端/网页版"时：无条件使用

## 何时不用 ❌

- **需要会话记忆**（多轮连贯对话）→ 用主模型，或传 `X-Hermes-Session-Id` 复用网页线程（见下）
- **需要工具**（文件读写/搜索/执行）→ 主模型自己做
- **私密上下文**（密钥/账号/隐私内容）→ 不要发给网页版（注意：ChatGPT 网页版自带跨会话 Memory，显式让"记住"的内容可能穿透 session 隔离，被其他会话引用）
- **需要并发/低延迟** → 主模型或 API 通道

## 使用方式

### 作为 subagent（推荐）
任务适合委派时，把自包含子任务交给 chatgpt-web：
```bash
hermes -z "<自包含问题>" chat -m chatgpt-web
```

### 直接对话
用户明确要求时，主对话切模型：
```bash
hermes -z "..." chat -m chatgpt-web
```

### 会话保持（多轮对话，已验证 2026-08-10）

同一 `X-Hermes-Session-Id` 的多次请求复用同一网页线程（第二轮能引用第一轮内容）；
不同 session id 隔离到不同线程。已验证：线程内记忆 ✅、线程隔离 ✅。

```bash
curl -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "X-Hermes-Session-Id: my-session" \
  -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"记住暗号 MELON=西瓜汁，只回复：好"}]}'
# 第二轮（同一 session id）：
#   {"messages":[{"role":"user","content":"MELON是什么？"}]} → 西瓜汁
```

> ⚠️ **ChatGPT Memory 提示**：网页版自带跨会话记忆。显式说"记住 X"的内容可能被 ChatGPT
> Memory 捕获，**新线程/新 session 也能引用**（已验证）。这是产品特性，不是通道 bug。
> 传私密内容前先考虑这一点，或让网页版"忘掉"。

### 模式参数（mode，2026-08-11 实测）

`mode` 字段控制 composer 模式（**全部只在聊天视图运行，绝不使用工作视图**）：

| mode | 功能 | 状态 |
|---|---|---|
| `default` | 普通对话 | ✅ 稳定 |
| `image` | 创建图片（`+`→创建图片） | ✅ **live 验证通过**（返回图片 URL） |
| `deep-research` | 深度研究（`+`→更多→深度研究） | ⚠️ **实验性**：消息能发出但 ChatGPT 端无响应（2026-08-11 实测 6 次，根因疑似"工作额度 0%"——深度研究消耗工作额度；额度恢复后可能可用） |

```bash
curl -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"chatgpt-web","mode":"image","messages":[{"role":"user","content":"画一只猫"}]}'
# 响应额外字段: {"mode":"image","images":["https://chatgpt.com/backend-api/estuary/content?id=..."]}
# 注意：图片 URL 是会话内临时链接，数分钟内有效
```

**模型切换（model 别名）**：❌ **当前不可实现**——2026-08 新版 UI 的智能选择器（能力滑块/模型子菜单）
自动化交互被限制（子菜单 Radix hover 拦截、方向键/点击均无效，4 种方法实测失败）。
目前 `model` 仅支持 `chatgpt-web`。

### 上传文件审核（配 chatgpt-web-upload skill）
```bash
python skills/chatgpt-web-upload/scripts/cdp_chatgpt_upload.py \
  --file 文件.mp3 --prompt "审核这段内容" --port 9233
```

## 决策速查

```
任务来了 → 需要 chatgpt-web 吗？
├─ 用户明确要求用 chatgpt 网页端？ → 用
├─ 任务自包含 + 无工具/记忆/私密要求 + 需要更强模型？ → 作为 subagent 用
└─ 其他 → 主模型处理
```

## 注意

- 通道依赖 provider 在线（127.0.0.1:8765）+ Chrome 已登录（CDP 9233）
- 调用前先 `curl http://127.0.0.1:8765/v1/models` 确认可用（若启用鉴权需 `-H "Authorization: Bearer $ADAPTER_API_KEY"`）
- 网页版会话可能被风控/登出，遇 401 时去 profile Chrome 重新登录

## Safety and routing rules

- 默认路由是常规 provider，**不是** chatgpt-web。
- 仅对自包含、低敏感度任务使用 chatgpt-web。
- 未经用户明确批准，绝不发送：密钥/凭据、未发表手稿、私人个人数据、受监管数据、保密客户文件。
- 不用于批量自动化或并行请求。
- 调用前用本地 Bearer key 验证 `/health` 和 `/v1/models`（如已启用鉴权）。
- 遇 AUTH_REQUIRED / HUMAN_REQUIRED / RATE_LIMITED / UI_UNKNOWN / REQUEST_IN_PROGRESS：
  停止或 fallback，绝不盲目循环重试。

## 合规说明

本项目通过本地 Chrome/CDP 驱动网页登录态，技术路径不同于直接调用私有 HTTP API。
这不构成 OpenAI 官方 API，也不保证符合服务条款、账号政策或长期可用性。
使用者必须自行检查当前条款、账号权限、隐私和数据处理要求。
