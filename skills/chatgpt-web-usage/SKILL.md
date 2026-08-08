---
name: chatgpt-web-usage
description: "chatgpt-web(网页版GPT通道)何时用/怎么用。触发: 需要更强模型做独立问答/头脑风暴/翻译/总结/代码, 或用户明确要求用chatgpt网页端时。"
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
但**有代价**：无会话记忆（每次请求独立网页会话）、慢（走网页）、不能并发。

## 何时使用 ✅

- **独立问答 / 头脑风暴 / 初稿**：低上下文依赖、自包含的问题
- **翻译 / 总结**：单次输入输出的任务
- **代码任务**（编写/重构/调试/审查的独立片段）：GPT 网页版代码能力强
- 用户**明确说**"主要使用 chatgpt 网页端/网页版"时：无条件使用

## 何时不用 ❌

- **需要会话记忆**（多轮连贯对话）→ 主模型自己做
- **需要工具**（文件读写/搜索/执行）→ 主模型自己做
- **私密上下文**（密钥/账号/隐私内容）→ 不要发给网页版
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
- 调用前先 `curl http://127.0.0.1:8765/v1/models` 确认可用
- 网页版会话可能被风控/登出，遇 401 时去 profile Chrome 重新登录
