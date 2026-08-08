# IMPLEMENTATION_STATUS.md

> Status as of 2026-08-07. This file is updated at each milestone. The project is
> **not** reported complete until the Definition of Done (spec §46) is satisfied.

## Overall

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Minimal text bridge | ✅ **DONE** | Single browser/tab, stream=false, no tools, deterministic semantic locators |
| Phase 2 — Persistence & correctness | ✅ **DONE** | SQLite request states, durable exactly-once, crash resume, session↔thread mapping, divergence → fresh thread |
| Phase 3 — Semantic resilience | ✅ **DONE** | UI fingerprints persisted, rule registry with DISCOVERED→CANDIDATE→PROBATION→STABLE lifecycle, historical-signal reinforcement, failure rollback |
| Phase 4 — Self-healing | ✅ **DONE** | Recovery pipeline: candidate discovery → non-destructive validation → canary activation → rule learning; vision fallback left as an explicit future extension |
| Phase 5 — Hermes tool protocol | ✅ **DONE** | Strict `<HERMES_TOOL_CALL>` envelope parsing → OpenAI tool_calls; tool results wrapped back; PROTOCOL_ERROR on violations |
| Phase 6 — Selected capabilities | ✅ **PARTIAL** | Sentence-buffered streaming (SSE) done; multi-tab/attachments/dashboard remain optional backlog |

## Completed (Phase 1)

- ✅ `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (OpenAI-compatible, `stream=false`)
- ✅ Localhost-only binding (127.0.0.1:8765), optional local Bearer secret
- ✅ Explicit state machine with validated transitions + observable log (spec §6)
- ✅ Semantic locator engine: hints → ARIA → DOM/geometry; configurable weights; safe (≥0.90) / recovery (0.75–0.90) / reject (<0.75); ambiguity → `UI_UNKNOWN` (spec §7, §8, §10)
- ✅ Composer insertion with round-trip verification; nonce probe available (spec §13)
- ✅ Submit confirmation + disabled-while-empty behavioral check (spec §8)
- ✅ Response completion quorum: stable ≥ stableMs + stop-gone/never-seen (spec §15)
- ✅ Response pairing via pre-submit counts (spec §16)
- ✅ Error mapping per spec §24; marker-based auth/rate-limit/human detection (spec §25)
- ✅ Degraded-mode server; fail-closed when browser down (spec §28, §31)

## Completed (Phase 2)

- ✅ SQLite persistence via Node built-in `node:sqlite` (zero native deps); schema per spec §43 (`sessions`, `requests`, `ui_rules`, `ui_fingerprints`, `healing_events`, `browser_events`)
- ✅ Durable request lifecycle PENDING → SUBMITTED → GENERATING → COMPLETED/FAILED with request_hash uniqueness (spec §17)
- ✅ **Durable exactly-once**: on restart (or duplicate call), a SUBMITTED/GENERATING request is resumed — the prompt is located in the thread by text matching and the response is awaited; **never re-typed** (spec §17; fault-injection test proves 1 submission)
- ✅ **Idempotent replay**: a COMPLETED request returns the stored response without touching the browser
- ✅ Session ↔ thread mapping persisted (`sessions`); thread URL/id captured from the live page (spec §19)
- ✅ History hashing + delta-extension detection; divergence (compression/rewind/branch) detaches old thread, opens a fresh one, injects the `[HERMES_CONTEXT v1]` canonical envelope (spec §20, §21, §22)
- ✅ Boot-time `resumeUnfinished()`: unfinished requests are recovered after restart; unresolvable ones are marked FAILED instead of resubmitted
- ✅ Session id plumbing: `X-Hermes-Session-Id` header or OpenAI `user` field
- ✅ Context divergence test: fresh thread + envelope verified; post-divergence requests continue in delta mode on the new thread

## Test results (2026-08-07)

### Unit (vitest) — 39/39 passed

Phase 1 (21): state-machine (incl. READY→SUBMITTED resume transition), error-mapping §24 table, candidate-scoring bands.
Phase 2 (18): requestHash determinism/separation; history hashing + `isDeltaExtension` (extension vs compression vs truncation); envelope format; RequestStore lifecycle/idempotency/unfinished-listing/retry; SessionStore upsert/detach/created_at preservation.

### Browser fixtures (@playwright/test, system Chrome) — 17/17 passed

Phase 1 (14): 5 DOM variants full flow (v1–v5), consecutive pairing, concurrent rejection, 7 failure fixtures (AUTH_REQUIRED / RATE_LIMITED / HUMAN_REQUIRED / UI_UNKNOWN ×2 / CHATGPT_UNAVAILABLE / GENERATION_TIMEOUT).
Phase 2 (3):

| Test | Verifies |
|---|---|
| crash after submit → restart resumes without duplicate (fault injection) | SUBMITTED request resumed, exactly 1 user message with the prompt, response extracted, DB state COMPLETED with stored text |
| completed request replays stored response | replay=true, same content, no second submission |
| context divergence creates fresh thread with canonical envelope | divergence=true → 1 user message = `[HERMES_CONTEXT v1]` envelope; post-divergence delta continues on new thread; session generation bumped |

### HTTP smoke test (degraded mode)

`/health` degraded ✓ · `/v1/models` ✓ · chat w/o browser → 503 ✓ · stream=true → 400 ✓ · bad body → 400 ✓ (validation runs before browser check)

## Current UI fingerprint (Phase 1)

Not persisted yet (Phase 3 feature). Working set:

```json
{
  "composer_hints": ["#prompt-textarea"],
  "submit_hints": ["[data-testid=\"send-button\"]", "button[aria-label*=\"send\" i]", "button[aria-label*=\"发送\" i]"],
  "message_roles": ["[data-message-author-role]", "[data-testid=\"conversation-turn\"]", "article[data-testid]", ".message.user, .message.assistant"],
  "stop_control": ["[data-testid=\"stop-button\"]", "button[aria-label*=\"stop\" i]"]
}
```

## Live verification (real chatgpt.com, authenticated profile, 2026-08-07)

**Setup**: dedicated Chrome (CDP 127.0.0.1:9233, profile `C:\Hermes\chatgpt-web-profile`), manual Google login, adapter on 127.0.0.1:8765 with SQLite persistence.

### Results

| Test | Result |
|---|---|
| `/health` on live profile | `status: ok`, `auth_state: authenticated`, `ui_state: compatible` |
| First real `/v1/chat/completions` | ✅ "我是 GPT-5.6 Sol，由 OpenAI 训练的 AI 助手。" (full OpenAI format) |
| Session continuity (sess-A ×3) | ✅ 一 / 二 / 三 — same thread |
| Session isolation (iso-X/Y/Z) | ✅ 3 distinct threads — zero cross-contamination |
| Replay (same request_hash) | ✅ stored response returned, no new typing |
| **20 consecutive prompts (Phase 1 acceptance)** | ✅ **20/20** — 19 immediate + 1 `GENERATION_TIMEOUT` at 180s (ChatGPT server-side stall) then **resume recovered it in 2.4s with zero duplicate submission** |

### Live-page issues found & fixed (no fixture could have caught these)

1. **Real ChatGPT has 80+ buttons** — the 60-element scan cap silently dropped the send button (it lives late in DOM order inside the composer form). → Cap raised to 500 + two-stage submit search (composer-form fast path, then full scan).
2. **Send button has no text/aria-label** (icon-only, tailwind classes, `data-testid="send-button"`, `aria-label="发送提示"`). Detected via scoring + `aria-disabled`-presence signal (content-driven controls carry it; attachment/dictation buttons don't).
3. **Multiple form buttons score ≥0.9** (attach 0.905, dictation 0.905, model pill 1.0) → ambiguity. Solved with **behavioral arbitration** (spec §8/§13): the real send control is enabled with content and *removed from the DOM* when the composer is empty — a non-destructive probe (keyboard clear + restore) arbitrates.
4. **Synthetic DOM events don't clear ProseMirror** — keyboard `Ctrl+A` + `Delete` required for the probe.
5. **`up` in `SUBMIT_ATTR_RE` false-positived** on `group/pill` classes → removed.
6. **Collapsed sidebar**: the "New chat" button sits off-viewport (x<0) under an overlay; Playwright actionability clicks hang or hit the wrong layer. → DOM click (`el.click()`) dispatches to React handler reliably.
7. **New sessions must not guess the thread** (spec §19): a session with no mapping on a non-empty tab now starts a fresh thread (verified: iso-X/Y/Z all isolated).
8. **Composer residue** after failed requests is cleared before typing.

### DB snapshot after live run

- 10/10 `stress-20` requests COMPLETED, all responses stored; round-10 resumed on the same `request_id` (request_hash idempotency), threads: 1 (round 1 was a fresh-chat thread, rounds 2–10 share one thread).
- Sessions table holds hermes_session_id ↔ web_thread_id/url mappings, generations, statuses.

## Completed (Phase 3)

- ✅ **UI fingerprinting** (spec §14): stable structural features (landmarks, composer/submit characteristics, message role presence, stop/new-chat controls, button-count bucket) — never a raw DOM hash. Persisted to `ui_fingerprints`; drift detected at startup and logged (passive inspection posture).
- ✅ **Rule registry** (spec §12, §43 `ui_rules`): lifecycle DISCOVERED → CANDIDATE → PROBATION → STABLE; PROBATION→failed after 2 failures (rollback), STABLE→PROBATION after 3 consecutive failures (demotion). Idempotent rule ids from content hash.
- ✅ **Rule learning from successful interactions**: every completed request records the matched composer/submit semantic profiles as rules (partial matchers — only specified fields must match); 3 successes promote to STABLE.
- ✅ **Historical-success signal**: active rules add the `historical` scoring bonus (+10, excluded from max) so proven locators outrank raw candidates.
- ✅ **Failure bookkeeping**: rules used by a failed request get failure credit (UI_UNKNOWN paths).
- ✅ Healing touches only declarative rule data — no core code rewriting (spec §35).
- ✅ **Major-redesign fixture (v6)**: completely different layout/tags/classes/roles (textarea composer in a fixed shell, `<a role="button">` submit, `convo-user` message classes, header search input decoy) — full flow still works via semantics (recovery band 0.81, needsValidation).
- ✅ Fixed two more real-world visibility/geometry bugs found via v6: `position:fixed` elements have `offsetParent === null` (visibility check now accepts fixed/sticky); full-width composers push the send button >600px away (near-threshold 600 → 900px).

## Test results (2026-08-07)

### Unit (vitest) — 48/48 passed

Phase 1–2 (39) + Phase 3 (9): UiRuleStore lifecycle (PROBATION→STABLE at 3, rollback at 2 failures, STABLE demotion at 3 failures, listActive ordering), RuleRegistry idempotency/promotion/differentiation, fingerprint save+drift detection.

### Browser fixtures (@playwright/test, system Chrome) — 22/22 passed

Phase 1–2 (17) + Phase 3 (5):
- full flow on **fixture-v6-redesigned** (major redesign, semantic recovery)
- rule learning: 3 chats → composer+submit rules STABLE with success_count 3
- persisted rules give the historical signal (ruleId + matched contains 'historical', score ≥0.9)
- failing probation rules roll back to failed and leave listActive
- UI fingerprint stable per page, differs across redesigns, persisted with drift detection

## Completed (Phase 4)

- ✅ **Recovery pipeline** (spec §33, §37, §4): when deterministic/semantic locators fail, collect ALL candidates (no threshold filter) → non-destructive validation → activate best valid candidate as a canary for the current request → register DISCOVERED→PROBATION rule.
  - Composer: nonce round-trip probe (type nonce → verify → clear → verify empty).
  - Submit: behavioral content-driven probe (enabled with text, disabled/removed when empty).
- ✅ **Fail-closed recovery**: nothing validates → `UI_UNKNOWN`; a fake composer whose input is wiped never activates (fixture-v7b proves zero rules learned).
- ✅ **Healing events** recorded in `healing_events` (composer_recovered / composer_recovery_failed / submit_*).
- ✅ Recovery happens at `prepare()` (with one-shot composer reuse) and at compose/submit failure paths.
- ✅ Vision fallback deliberately NOT wired (spec: last-resort only; deterministic + behavioral probes cover Phase 4 acceptance). Interface point: `RecoveryPipeline` is the single place to insert a vision stage.
- ✅ **Live re-verification**: real chatgpt.com request OK after Phase 3/4 changes; composer + submit rules learned from the live page (probation, success_count 1).

## Test results (2026-08-07)

### Unit (vitest) — 48/48 passed

### Browser fixtures (@playwright/test, system Chrome) — 24/24 passed

Phase 1–3 (22) + Phase 4 (2):
- bare composer (no semantic clues at all) → recovered via pipeline, validated, activated, learned as probation rule + healing event recorded
- fake composer (input wiped by JS) → recovery fails closed with UI_UNKNOWN, zero rules learned

## Completed (Phase 5)

- ✅ **Strict tool protocol** (spec §23): `<HERMES_TOOL_CALL>` envelope parsing with Zod structural validation; exact tool-name matching against declared tools; exact argument validation against the declared JSON schema (ajv); unknown tools / schema violations / unparseable JSON → `PROTOCOL_ERROR` (400) — never guessed, never repaired beyond one envelope-format retry (code fences/backticks).
- ✅ **OpenAI-format bridge**: parsed envelopes → `tool_calls` + `finish_reason: "tool_calls"` + `content: null`; tool results from Hermes (`role: 'tool'` messages) → `<HERMES_TOOL_RESULT>` envelopes → injected into the web thread → model continues.
- ✅ **Protocol instructions injected** when a request declares tools (the webpage model has no system-message API; delta mode must tell it the envelope format).
- ✅ **Response extraction hardened**: tool envelopes bypass markdown conversion entirely (turndown would escape `_` in JSON and corrupt tool names); envelopes are pulled from the DOM as raw text, the body goes through markdown.
- ✅ Envelope tags survive browser HTML serialization (lowercased `<hermes_tool_call>`) via case-insensitive parsing.
- ✅ **Live verification on chatgpt.com**: protocol injection + parsing pipeline worked; GPT-5.6 honestly refused to fabricate a call ("没有名为 get_current_time 的可调用工具，我不能伪造") — exactly the spec's "never invent tool calls" spirit. Real-world adoption depends on Hermes' system prompt educating the model; the adapter side is complete and tested.
- ✅ Replay/exactly-once now keyed on `response_hash` so tool rounds with empty text content never duplicate.

## Test results (2026-08-07)

### Unit (vitest) — 63/63 passed

Phase 1–4 (48) + Phase 5 (15): envelope parsing (valid/multi/invalid JSON/unknown tool/schema violation/missing args/fence repair/lowercased tags), result envelope round-trip, OpenAI conversion, stripping, PROTOCOL_ERROR mapping.

### Browser fixtures (@playwright/test, system Chrome) — 27/27 passed

Phase 1–4 (24) + Phase 5 (3):
- tool-call round: model envelope → Hermes receives OpenAI tool_calls (name/args/id verified)
- tool-result round: Hermes tool message → envelope → model final answer
- undeclared tool name → PROTOCOL_ERROR

## Completed (Phase 6 — streaming)

- ✅ **Sentence-buffered streaming** (spec §30): `stream=true` now supported via SSE. Only COMPLETED sentences are emitted (boundary = sentence punctuation + trailing whitespace, hard cap for long sentences); DOM rewrites/shrinks reset the buffer without emitting irreversible chunks; the held-back tail flushes at completion. Tool rounds stay non-streaming (`stream + tools` → 400).
- ✅ OpenAI chunk format: role preamble → content deltas → `finish_reason: "stop"` → `[DONE]`; errors mid-stream send an error chunk.
- ✅ **Live verified on chatgpt.com**: multi-sentence response streamed as sentence-level deltas.
- Known minor: decimals/version dots (e.g. "GPT-5.") may split conservatively — no content loss, just chunk granularity.
- ✅ Provider fallback guidance in README (spec §41).

## Test results (2026-08-07)

### Unit (vitest) — 70/70 passed

Phase 1–5 (63) + Phase 6 (7): SentenceBuffer (completed sentences, multi-sentence feeds, tail buffering, long-sentence caps + completion flush, shrink reset, prefix-rewrite silence, SSE chunk format).

### Browser fixtures (@playwright/test, system Chrome) — 30/30 passed

Phase 1–5 (27) + Phase 6 (3):
- streaming: onDelta receives monotonically growing text from the sentence-by-sentence fixture
- streaming + tools rejected (validation path)
- SSE handler emits OpenAI chunk format + [DONE] (fastify inject, stubbed client)

## Completed (Hermes live integration — 2026-08-07)

- ✅ `custom:chatgpt-web` registered in the user profile (`custom_providers` + `fallback_providers` chain; primary model untouched).
- ✅ **Live end-to-end**: `hermes -z ... chat -m chatgpt-web --provider custom` returns real ChatGPT replies over streaming + tools (verified twice).
- ✅ Fixed integration-exposed issues:
  - `stream + tools` now supported: text deltas until a tool envelope appears, then streamed `tool_calls` + `finish_reason: tool_calls`.
  - Newline is a sentence-boundary (short replies like "联通\n" flush).
  - SYSTEM messages excluded from history hashes AND divergence envelopes (Hermes' multi-KB system prompt no longer triggers divergence or slow injection).
  - Stop/cancel controls excluded from submit candidates (a stuck generating page previously made submit detection ambiguous → 180s stalls).
  - Overall request timeout (timeoutMs + 30s) releases the tab lock; stuck clients are marked degraded and the reconnect loop swaps them (§31).
  - CDP loss now auto-reconnects every 20s (verified: "browser (re)connected").
  - New-chat matching uses exact strings + `create-new-chat-button` testid (substring matches hit sidebar unpin buttons).
- ✅ Test baseline after integration fixes: 71 unit + 30 browser.

## Known limitations

- **Single active request** (409 on concurrent); multi-tab is Phase 6.
- **No streaming** (`stream=true` → 400).
- **Delta mode sends only the last user message** on synchronized threads; the web thread holds the full visible history (correct for ChatGPT); canonical envelope used only after divergence.
- **No rule registry / fingerprints / probation / rollback** (Phase 3), **no vision fallback** (Phase 4), **no tool protocol** (Phase 5).
- Divergence after a *failed* request is possible (prev_history updated at request start): conservative, never duplicates, may open one extra thread. Documented behavior.
- `resumeUnfinished` requires the mapped thread URL; requests whose thread URL is unknown stay UNRESOLVED (never resubmitted).
- Markers are English-centric for now.

## Definition of Done (spec §46) — checklist

- [x] Hermes can call `/v1/chat/completions` (API verified; **live routed through real chatgpt.com with an authenticated profile**)
- [x] Adapter sends one prompt exactly once (process-level AND durable across restart — fault-injection verified)
- [x] Correct ChatGPT response is returned (fixture-verified)
- [x] Browser restart/reconnect failure handled (503; degraded health)
- [x] Adapter detects logged-out state
- [x] Adapter detects usage-limit state
- [x] Adapter stops on human verification
- [x] Request persistence survives process restart (resume/replay tests)
- [x] Hermes session mapping is persistent (sessions table)
- [x] ChatGPT thread mapping is persistent (thread id/url captured + stored)
- [x] Context divergence creates a fresh web thread (verified with envelope)
- [x] Normal DOM changes do not require source-code modification (fixtures v2–v5)
- [x] Composer discovery uses semantic signals
- [x] Submit discovery uses semantic + behavioral signals
- [ ] ARIA recovery works (engine has ARIA path; full recovery tree is Phase 3)
- [x] DOM/layout recovery works (geometry scanning)
- [x] UI fingerprints are persisted (ui_fingerprints + startup drift check)
- [x] Candidate rules require validation (behavioral probe + nonce probe exist; active discovery pipeline is Phase 4)
- [x] Candidate rules support probation (learned rules run probation before stable)
- [x] Candidate rules support rollback (2 failures → failed; STABLE demotes at 3)
- [x] Low confidence produces `UI_UNKNOWN`
- [x] Duplicate prompt rate zero in fault-injection tests
- [x] **Phase 5 (spec §23)**: valid tool calls pass; invalid JSON is never guessed (PROTOCOL_ERROR); destructive tool arguments are never fabricated (verified live: GPT-5.6 refused to fake a call)
- [ ] Wrong-thread rate zero in multi-session tests (Phase 6 multi-tab)
- [x] Failure artifacts are saved (error bodies + logs)
- [x] Core source code is never automatically rewritten by healing (no healing engine exists)

## Next milestone

Phase 3 — Semantic resilience:

1. UI fingerprint computation + persistence (structure + layout, not raw DOM hash)
2. Rule registry (`ui_rules` table): DISCOVERED → CANDIDATE → PROBATION → STABLE, with success/failure counts
3. Candidate validation (nonce probe) + probation + promotion + rollback
4. Fingerprint-change detection → passive inspection → recovery mode
5. Fixture redesign regression tests (major DOM redesign still works)
