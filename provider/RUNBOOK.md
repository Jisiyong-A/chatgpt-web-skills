# chatgpt-web-provider RUNBOOK

Quick operational reference. Companion skill: `chatgpt-web-provider-ops` (Hermes).

## Architecture (one line)

`Hermes → http://127.0.0.1:8765/v1 → Playwright/CDP → dedicated Chrome profile → chatgpt.com`
Adapter: TypeScript + Fastify + node:sqlite. Model alias: `chatgpt-web`.

## Start order

1. Dedicated Chrome (CDP 9233, profile keeps login):
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 --user-data-dir="C:\Hermes\chatgpt-web-profile" --no-first-run --no-default-browser-check "https://chatgpt.com"`
2. Adapter: `CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9233 ADAPTER_PORT=8765 LOG_LEVEL=info ./node_modules/.bin/tsx src/index.ts`
3. Health gate: `curl -s http://127.0.0.1:8765/health` → `browser_connected:true`, `auth_state:authenticated`
4. Smoke: `curl -s -X POST http://127.0.0.1:8765/v1/chat/completions -H 'content-type: application/json' -H 'X-Hermes-Session-Id: smoke' -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"只回复：OK"}]}'`
5. Hermes: `hermes -z "只回复两个字：联通" chat -m chatgpt-web --provider custom`

## Health interpretation

| Field | Meaning |
|---|---|
| `browser_connected` | adapter ↔ CDP OK |
| `auth_state: authenticated` | ChatGPT logged in (profile session) |
| `ui_state: compatible` | semantic locators matched |
| `healing_required` | false normally; true = rule recovery pending |

## Failure matrix

| Symptom | Cause | Action |
|---|---|---|
| 503 BROWSER_UNAVAILABLE | Chrome DevTools wedged (HTTP OK, ws timeout) or Chrome not running | kill `:9233` PID, relaunch Chrome; adapter auto-reconnects ≤20s |
| 180s GENERATION_TIMEOUT | page stuck (stop button visible) or manual UI interference | stop-controls excluded from submit candidates; reset page (click stop, goto chatgpt.com); retry |
| 409 REQUEST_IN_PROGRESS | previous request hung holding the tab lock | overall timeout (timeoutMs+30s) auto-releases; adapter swaps degraded client via reconnect loop |
| 400 stream+tools | stale adapter build | restart with latest src (streamed tool_calls supported) |
| Hermes "empty content" but adapter COMPLETED | stale build (pre newline-boundary fix) | restart with latest src |
| divergence on every request / 67s compose | stale `default` session rows in DB | delete sessions/requests rows for the session id |
| new-chat UI_UNKNOWN | sidebar unpin button mis-match (pre fix) | use latest src (exact-match + create-new-chat-button) |

## Data

- SQLite: `D:\hermes\data\bridge.db` — `sessions`, `requests`, `ui_rules`, `ui_fingerprints`, `healing_events`, `browser_events`
- Logs: adapter stdout (background process); `LOG_LEVEL=debug` for per-step tracing

## Safety rules

- Never delete `C:\Hermes\chatgpt-web-profile` (the login lives there).
- Never interact with the ChatGPT tab while the adapter is mid-request.
- Kill only the dedicated Chrome (port 9233), never the user's Chrome.
- After code changes: `npm run build` → `npm run test` → `playwright test tests/browser/` → live smoke → commit.
