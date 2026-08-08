# chatgpt-web-provider

Local, fail-closed browser adapter that lets **Hermes Agent, Codex CLI, or any OpenAI-compatible client** use the **ChatGPT web interface** as a model provider — no API key, no extra cost, powered by your logged-in ChatGPT account.

**Sharing with friends / Codex users**: see `CODEX_SHARING_GUIDE.md` (Chinese, step-by-step install; includes the `/v1/responses` endpoint Codex 2026 requires).

```text
Hermes Agent
    ↓  OpenAI-compatible
http://127.0.0.1:8765/v1
    ↓
chatgpt-web-provider (this repo)
    ↓  Playwright + CDP
Dedicated Chrome profile
    ↓
chatgpt.com (visible UI, normal authenticated session)
```

## Design principles

- **Deterministic normal path** — semantic multi-signal locators, never one hard-coded CSS selector.
- **Fail closed** — if the UI cannot be identified above a confidence threshold, the adapter stops and reports `UI_UNKNOWN` instead of guessing.
- **Exactly-once prompt submission** — one request per tab; duplicates are a critical defect.
- **No bypasses** — no cookie/token extraction, no CAPTCHA solving, no rate-limit evasion, no private `backend-api` reverse engineering, no core-code rewriting by a "healing" engine.
- **Hermes owns the conversation** — ChatGPT Web is an execution backend, not the canonical history store.

Full specification: `HERMES_CHATGPT_WEB_ADAPTER_IMPLEMENTATION.md` (attached to the project brief). Status: `IMPLEMENTATION_STATUS.md`.

## Current status

- `GET /health` — browser/page/auth/UI state
- `GET /v1/models` — `chatgpt-web`
- `POST /v1/chat/completions` — `stream=false` (text + tool protocol) and `stream=true` (sentence-buffered SSE)
- Explicit browser state machine (BOOT → AUTH_CHECK → READY → COMPOSING → SUBMITTED → GENERATING → COMPLETED → READY + error states)
- Semantic locator engine with configurable candidate scoring and confidence thresholds
- Full failure detection: login / rate limit / human verification / no composer / ambiguous UI / server error / generation timeout
- Durable exactly-once, crash resume, session↔thread mapping, context divergence → fresh thread
- UI fingerprints, rule registry with learning/rollback, self-healing recovery pipeline
- Hermes tool protocol (strict textual envelopes)
- 70 unit tests + 30 browser fixture tests (8 DOM variants + 9 failure fixtures)

## Requirements

- Node.js >= 20 (developed on Node 24)
- Google Chrome installed (Playwright drives it via `channel: chrome`; no browser download needed)
- A ChatGPT account; you log in **manually once** into the dedicated profile

## Quick start

### 1. Install

```bash
npm install --include=dev   # this machine's global npm has omit=dev; --include=dev is required
```

### 2. Configure

```bash
cp .env.example .env
```

Key settings (`CHROME_PROFILE_DIR`, `CHROME_CDP_PORT`, `ADAPTER_PORT`, `ADAPTER_API_KEY`).

> The default CDP port is **9233**. Port 9223 is commonly used by other local tools; keep them apart.

### 3. Launch the dedicated Chrome and log in once

```powershell
# PowerShell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9233 `
  --user-data-dir="C:\Hermes\chatgpt-web-profile" `
  --no-first-run
```

Open `chatgpt.com`, log in, and leave that Chrome window running (the adapter can also launch Chrome itself via `CHROME_LAUNCH_AT_STARTUP=true`, the default).

### 4. Run

```bash
npm run dev          # tsx watch (development)
npm run build        # tsc
npm start            # node dist/index.js
```

The server binds `127.0.0.1:8765` only — never exposed to the LAN.

### 5. Try it

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/v1/models
curl -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"Explain this concept."}]}'
```

### 6. Tests

```bash
npm test                    # unit tests (vitest)
./node_modules/.bin/playwright test   # browser fixture tests
```

## Hermes integration (Hermes Agent v0.20.x) — VERIFIED LIVE 2026-08-07

✅ `hermes -z "..." chat -m chatgpt-web --provider custom` works end-to-end (streaming + tools).

Hermes treats the adapter as a custom OpenAI-compatible provider (`custom_providers` list in `config.yaml` — verified format for v0.20.0, 2026-08):

```yaml
custom_providers:
  - name: chatgpt-web
    base_url: http://127.0.0.1:8765/v1
    key_env: CHATGPT_WEB_API_KEY   # local placeholder secret
    model: chatgpt-web
    context_length: 32768
    discover_models: false
    models:
      - chatgpt-web
fallback_providers:
  - provider: custom
    model: chatgpt-web
    base_url: http://127.0.0.1:8765/v1
```

Then select the model as `custom:chatgpt-web` (`hermes model`, or config `model.default` / `model.aliases`). Recommended as a fallback route, not the only provider — the adapter can only answer when a logged-in Chrome is running.

Do **not** put the adapter URL/key in a shared `.env` used by other providers; keep the local adapter secret local to the adapter.

## API

| Endpoint | Notes |
|---|---|
| `GET /health` | `status`, `browser_connected`, `auth_state`, `ui_state`, `healing_required`, … |
| `GET /v1/models` | `chatgpt-web` |
| `POST /v1/chat/completions` | OpenAI format; `stream=true` (sentence-buffered SSE) or `false`; `tools` supported (strict envelope protocol) |
| `POST /v1/responses` | **OpenAI Responses API** (Codex CLI 2026 wire_api="responses"); JSON + SSE lifecycle events |

Error mapping (machine-readable `error.code`):

| Code | HTTP |
|---|---|
| `AUTH_REQUIRED` | 401 |
| `AUTHORIZATION_ERROR` | 403 |
| `RATE_LIMITED` | 429 |
| `CHATGPT_UNAVAILABLE` / `BROWSER_UNAVAILABLE` / `UI_UNKNOWN` / `HUMAN_REQUIRED` | 503 |
| `GENERATION_TIMEOUT` | 504 |
| `CONTEXT_DIVERGED` / `REQUEST_IN_PROGRESS` | 409 |
| `INVALID_REQUEST` | 400 |

## Security notes

- Server binds `127.0.0.1`; CDP binds `127.0.0.1`.
- Dedicated profile; the adapter never reads cookies or tokens.
- Optional local `ADAPTER_API_KEY` — if set, requests must send `Authorization: Bearer <key>`.
- Logs never contain auth headers or tokens. Screenshots/artifacts are not written in Phase 1.

## Troubleshooting

- **`BROWSER_UNAVAILABLE`** — Chrome isn't listening on the CDP port. Start/launch Chrome with the dedicated profile, or check `CHROME_CDP_PORT`/`CHROME_PROFILE_DIR`.
- **`AUTH_REQUIRED`** — the profile is logged out. Log in manually in the dedicated Chrome.
- **`HUMAN_REQUIRED`** — ChatGPT presented a CAPTCHA/security check. Stop; log in manually; do not try to bypass.
- **`RATE_LIMITED`** — usage limit. Wait or use a fallback provider.
- **`UI_UNKNOWN`** — the semantic locators couldn't reach the confidence threshold (or the UI changed). Check `/health`; save a screenshot of the ChatGPT page and open an issue with the fixture set.

## Project layout

```text
src/
  api/          fastify server, /health, /v1/models, /v1/chat/completions
  browser/      Chrome lifecycle, CDP connection
  chatgpt/      state machine, composer/submit/conversation/response, client orchestrator
  semantic/     UI contract, candidate scoring, locator engine
  observability/ logger
tests/
  unit/         vitest: state machine, error mapping, candidate scoring
  browser/      playwright: fixture flows (v1–v5) + failure fixtures
  fixtures/     fake ChatGPT pages (HTML)
scripts/        smoke.sh (degraded-mode server check), debug-*.ts
```

## Roadmap

Phase 2 — SQLite persistence, exactly-once across restarts, Hermes session ↔ thread mapping, context hashing, divergence → new thread.  
Phase 3 — semantic rule registry + UI fingerprints + validation/probation/rollback.  
Phase 4 — vision-assisted recovery (last resort).  
Phase 5 — Hermes tool-call protocol.  
Phase 6 — streaming, multi-tab, attachments (only after 1–4 stable).
