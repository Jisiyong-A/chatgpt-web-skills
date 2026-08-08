# Hermes Agent 接入指南

> v1.2.0 — 基于真实部署验证（2026-08-09），包含本次 API 鉴权启用的全部踩坑结论。

## 架构回顾

```
Hermes (Agent) → localhost:8765 (provider) → CDP 9233 → Chrome (已登录 chatgpt.com)
```

## 1. config.yaml 配置（custom_providers）

```yaml
custom_providers:
  - name: chatgpt-web
    base_url: http://127.0.0.1:8765/v1
    api_key: <本地密钥>            # 推荐内联（named provider 路径直接读取）
    key_env: CHATGPT_WEB_API_KEY   # 备选：环境变量名（需 Hermes 进程可见）
    model: chatgpt-web
    context_length: 32768
    discover_models: false
    models:
      - chatgpt-web
```

## 2. ⚠️ 调用铁律：必须用 named provider 语法

```bash
# ✅ 正确：显式指定 provider 名
hermes -z "问题" chat -m chatgpt-web --provider custom:chatgpt-web

# ❌ 错误：只给 -m，不给 --provider
hermes -z "问题" chat -m chatgpt-web
```

**原因**：`-m chatgpt-web` 单独使用时，Hermes 的 provider 解析走 "explicit custom endpoint" 路径，
API key 从 `OPENAI_API_KEY` 读取（而不是 custom provider 的 key_env）。
`OPENAI_API_KEY` 通常被其他服务占用（如 DeepSeek），因此请求会带上占位 key 并被 provider 拒绝（401）。
显式 `--provider custom:chatgpt-web` 走 named custom provider 路径，正确读取 `api_key`/`key_env`。

> 若在桌面 app 的模型选择器里使用，请在自定义模型配置中同时指定 provider 名。

## 3. API 鉴权（v1.1.0+ 默认启用）

provider 要求所有请求带 `Authorization: Bearer <key>`。启用步骤：

```bash
# 1. 生成并持久化（Windows：注册表用户级环境变量）
python -c "import secrets; print(secrets.token_hex(32))"
setx ADAPTER_API_KEY <生成的key>       # provider 侧校验
setx CHATGPT_WEB_API_KEY <生成的key>   # Hermes 侧读取（与 config 的 key_env 对应）
```

```bash
# 2. 启动 provider 时必须带 key（否则 loadConfig 直接抛错拒绝启动）
ADAPTER_API_KEY=<key> ADAPTER_REQUIRE_API_KEY=true \
ADAPTER_TIMEOUT_MS=600000 \
CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9233 ADAPTER_PORT=8765 \
npm run dev
```

### ⚠️ 环境变量生效时机（重要）

- `setx` 只对**之后启动的进程**生效
- **已运行的 Hermes gateway / 桌面 app 不会自动读到新 key**——必须重启
  - 桌面 app 重启 ≠ gateway 重启（gateway 是独立进程）：`hermes gateway restart`
  - 或者重启 Hermes 桌面 app 并确认 gateway 被拉起
- 验证生效：`hermes -z "hi" chat -m chatgpt-web --provider custom:chatgpt-web`
  成功返回即链路通

## 4. 验证

```bash
# provider 鉴权
curl -H "Authorization: Bearer <key>" http://127.0.0.1:8765/v1/models   # 200
curl http://127.0.0.1:8765/v1/models                                     # 401

# 端到端（需 Chrome 已登录 + provider 运行）
hermes -z "用3个词回答:你好" chat -m chatgpt-web --provider custom:chatgpt-web
```

## 5. 长任务（音频/文件审核）

网页版回答慢（1-5 分钟+），同步等待会让 Hermes 卡住。用异步模式：

```bash
# 配合 chatgpt-web-upload skill：后台运行 + 完成自动通知
python skills/chatgpt-web-upload/scripts/cdp_chatgpt_upload.py \
  --file audio.mp3 --prompt "审核" --reply-timeout 600
# Hermes 侧: terminal(background=true, notify_on_complete=true)
```

provider 超时建议 `ADAPTER_TIMEOUT_MS=600000`（默认 180000 对长审核不够）。

## 6. 故障速查

| 现象 | 原因 | 解法 |
|---|---|---|
| 401 invalid adapter API key | 请求没带 key 或 key 不匹配 | 检查 provider 启动参数 + Hermes key 配置；确认 gateway 已重启 |
| 401 + provider 日志显示占位 key | 调用没用 named provider 语法 | 加 `--provider custom:chatgpt-web` |
| 启动即报 ADAPTER_API_KEY is required | requireApiKey=true 但没传 key | 启动命令加 `ADAPTER_API_KEY=<key>` |
| CDP WebSocket 403 | Chrome 缺 `--remote-allow-origins=*` | 按仓库快速开始重启 Chrome |
| 长任务卡住/超时 | 同步等待 + 默认 180s 超时 | 用异步模式 + ADAPTER_TIMEOUT_MS=600000 |
