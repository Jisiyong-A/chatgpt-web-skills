# Implementation Status

> v1.1.0-hardening — 本文件只保留单一当前状态表（2026-08-09 重写）。
> 测试数量来自实际命令输出（npm test / pytest），不是手工填写。

## Current verified state

| Capability | Status | Evidence | Limitation |
|---|---|---|---|
| `/v1/chat/completions` | verified | unit + browser fixture | single active request |
| `/v1/responses` (Codex) | verified | Hermes smoke test | depends on current Codex wire |
| `stream=true` | verified | SSE tests | sentence-buffered, not token-level |
| tool protocol | verified | fixture tests | model may still refuse tool call |
| file upload (CDP script) | **verified** | **Gate E live smoke 通过 (2026-08-09):** 真实上传 small-test.txt → chip 出现 → ChatGPT 回复 UPLOAD_OK; 修复2个隐藏bug (objectId returnByValue / 短回复阈值) | single file per call |
| local API auth (Bearer) | verified | unit tests (401 without key / 200 with key) | key is local-only, not a ChatGPT credential |
| Hermes integration | **verified** | **live E2E 2026-08-09**: `-m chatgpt-web --provider custom:chatgpt-web` 真实回复; 鉴权 401/200 实测 | 必须用 named provider 语法; 改 key 后需重启 gateway (见 docs/HERMES_INTEGRATION.md) |
| Node >= 22.13.0 guard | verified | check-node.mjs pre-script | Node 24.x recommended |
| `--remote-allow-origins` unified | verified | ChromeManager + bat + README aligned | keep CDP loopback-only |
| multi-tab | not implemented | none | returns 409 (REQUEST_IN_PROGRESS) |
| CAPTCHA bypass | intentionally unsupported | design constraint | manual intervention only |
| Chinese UI markers | implemented | config markers (登录/验证你是人类/使用上限) | fixture coverage pending |

## Test gates

- **Gate A** (static): `npm ci --include=dev && npm run build && git diff --check`
- **Gate B** (unit): `npm test` + `python -m pytest skills/chatgpt-web-upload/tests -q`
- **Gate C** (degraded smoke): provider starts without Chrome; `/health` + `/v1/models` require Bearer when `ADAPTER_API_KEY` set
- **Gate D** (browser fixtures): `npx playwright test` — login/human/rate-limit pages, 409 on concurrent second request
- **Gate E** (upload live smoke): manual only, with non-sensitive test file — `python skills/chatgpt-web-upload/scripts/cdp_chatgpt_upload.py --file test-fixtures/small-test.pdf --prompt "只回复：UPLOAD_OK"`

## Known operational notes

- 本机部署（Hermes 集成）当前使用**兼容模式**（不设 ADAPTER_API_KEY，不要求鉴权）。
  生产/共享部署建议启用：`setx ADAPTER_API_KEY <随机长密钥>`，Hermes `custom_providers` 配 `key_env: ADAPTER_API_KEY`。
- `ADAPTER_TIMEOUT_MS=600000` 建议值（网页版长任务）；默认 180000。
- 长任务必须用异步模式（background + notify），避免同步等待阻塞。
