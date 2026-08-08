/**
 * ChatGPTClient — deterministic orchestration of one request through the
 * ChatGPT web UI (spec §6, §17–§22).
 *
 * State flow: BOOT → AUTH_CHECK → READY → COMPOSING → SUBMITTED → GENERATING
 * → COMPLETED → READY.
 *
 * Correctness guarantees (Phase 2):
 * - Durable exactly-once: request states in SQLite; a request that was
 *   already submitted is resumed, never re-typed.
 * - Session ↔ thread mapping with history hashing; context divergence
 *   (compression/rewind/branch) detaches the old thread and starts a fresh
 *   one with the canonical context envelope.
 * - Boot-time resume of unfinished requests (spec §17: DO NOT SEND AGAIN).
 */

import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { StateMachine, State } from './state-machine.js';
import { AdapterError } from './errors.js';
import { typeIntoComposer, clearComposer, composerText, type ComposerInputResult } from './composer.js';
import { confirmAndClickSubmit, clickAndConfirmSubmit, type SubmitOutcome } from './submit.js';
import {
  snapshotConversation,
  waitForNewUserMessage,
  findUserMessageIndex,
  snapshotUpTo,
  MESSAGE_SELECTORS,
  type ConversationSnapshot,
} from './conversation.js';
import { waitForResponse, type ResponseOutcome } from './response.js';
import { startFreshThread } from './new-chat.js';
import type { LocatorEngine, LocatorResult } from '../semantic/locator-engine.js';
import type { Persistence } from '../persistence/sqlite.js';
import { RequestStore, type RequestRecord } from '../persistence/requests.js';
import { SessionStore, type SessionRecord } from '../persistence/sessions.js';
import { RuleRegistry, type UiRule } from '../healing/registry.js';
import { RecoveryPipeline } from '../healing/recovery.js';
import {
  requestHash,
  promptHash,
  normalizeHistory,
  isDeltaExtension,
} from '../hermes/request-hash.js';
import { canonicalPrompt } from '../hermes/messages.js';
import {
  parseToolCalls,
  toOpenAIToolCalls,
  buildToolResultEnvelope,
  buildToolProtocolInstructions,
  stripToolEnvelopes,
  type ToolDefinition,
  type OpenAIToolCall,
} from '../hermes/tools.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ChatResult {
  content: string;
  id: string;
  created: number;
  model: string;
  latencyMs: number;
  states: string[];
  composerRuleScore: number | null;
  submitRuleScore: number | null;
  signals: string[];
  resumed?: boolean;
  replay?: boolean;
  divergence?: boolean;
  webThreadId?: string;
  webThreadUrl?: string;
  /** Phase 5: parsed tool calls from the web model (OpenAI format). */
  toolCalls?: OpenAIToolCall[];
  toolRepairs?: string[];
}

export interface ChatOptions {
  /** Hermes session id. Without persistence it is only used for logging. */
  hermesSessionId?: string;
  /** Declared tools (OpenAI format) for strict name/argument validation. */
  tools?: ToolDefinition[];
  /** Progress callback with the full current text (streaming support). */
  onDelta?: (text: string) => void;
}

export interface ClientOptions {
  allowNonChatGPT?: boolean;
  timeoutMs?: number;
  responseStableMs?: number;
  authMarkers?: string[];
  humanMarkers?: string[];
  rateLimitMarkers?: string[];
  chatgptBaseUrl?: string;
  logger?: Logger;
  persistence?: Persistence;
}

export interface AuthStateResult {
  auth: 'authenticated' | 'auth_required' | 'unknown';
  reason: string;
}

const URL_AUTH_RE = /\/auth\/(login|signup|sign-in)/i;

const DEFAULT_AUTH_MARKERS = [
  'log in',
  'sign up',
  'welcome back',
  'auth/login',
  'continue with google',
];
const DEFAULT_HUMAN_MARKERS = [
  'verify you are human',
  'security check',
  'unusual activity',
  'captcha',
  'cloudflare',
  'one more step',
];
const DEFAULT_RATE_LIMIT_MARKERS = [
  'usage limit',
  'reached the limit',
  'temporarily limited',
  'rate limit',
  'you\u2019ve reached your',
  'you have reached your',
];

function threadFromUrl(url: string): { id: string; url: string } | null {
  const m = /\/c\/([0-9a-f-]{8,})/i.exec(url);
  if (!m) return null;
  return { id: m[1]!, url };
}

export class ChatGPTClient {
  readonly sm: StateMachine;
  private readonly page: Page;
  private readonly engine: LocatorEngine;
  private readonly opts: Required<Pick<ClientOptions, 'timeoutMs' | 'responseStableMs'>> &
    ClientOptions;
  private readonly log: Logger;
  private readonly persistence: Persistence | null;
  private readonly registry: RuleRegistry | null;
  private readonly recovery: RecoveryPipeline;
  private inFlight: Promise<ChatResult> | null = null;
  private prepared = false;
  /** Set when a request hit the overall timeout with the page stuck. */
  private degraded = false;
  /** Composer activated by the recovery pipeline during prepare (one-shot). */
  private recoveredComposer: LocatorResult | null = null;

  constructor(page: Page, engine: LocatorEngine, opts: ClientOptions = {}) {
    this.page = page;
    this.engine = engine;
    this.persistence = opts.persistence ?? null;
    this.registry = opts.persistence ? new RuleRegistry(opts.persistence) : null;
    this.log = opts.logger ?? (console as unknown as Logger);
    this.recovery = new RecoveryPipeline(engine, this.registry, this.persistence, this.log);
    this.opts = {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 180_000,
      responseStableMs: opts.responseStableMs ?? 2000,
      authMarkers: opts.authMarkers ?? DEFAULT_AUTH_MARKERS,
      humanMarkers: opts.humanMarkers ?? DEFAULT_HUMAN_MARKERS,
      rateLimitMarkers: opts.rateLimitMarkers ?? DEFAULT_RATE_LIMIT_MARKERS,
    };
    this.sm = new StateMachine((from, to, reason) => {
      this.log.info({ request: this.currentRequestId ?? undefined, state_transition: `${from}->${to}`, reason }, 'state');
    });
  }

  private currentRequestId: string | null = null;

  /** Marker scan — multi-keyword, never a single selector. */
  async scanPageMarkers(): Promise<{ human: string | null; rateLimit: string | null; auth: string | null }> {
    const body = await this.page
      .evaluate(() => (document.body ? document.body.innerText.slice(0, 200_000) : ''))
      .catch(() => '');
    const lower = body.toLowerCase();
    const hit = (markers: string[]): string | null => {
      for (const m of markers) {
        if (lower.includes(m.toLowerCase())) return m;
      }
      return null;
    };
    return {
      human: hit(this.opts.humanMarkers ?? []),
      rateLimit: hit(this.opts.rateLimitMarkers ?? []),
      auth: hit(this.opts.authMarkers ?? []),
    };
  }

  async detectAuthState(): Promise<AuthStateResult> {
    const url = this.page.url();
    if (URL_AUTH_RE.test(url)) return { auth: 'auth_required', reason: `url=${url}` };
    if (!url.includes('chatgpt.com') && !this.opts.allowNonChatGPT) {
      return { auth: 'unknown', reason: `not on chatgpt.com (${url})` };
    }
    const markers = await this.scanPageMarkers();
    if (markers.human) return { auth: 'unknown', reason: `human marker: ${markers.human}` };
    if (markers.rateLimit) return { auth: 'unknown', reason: `rate-limit marker: ${markers.rateLimit}` };
    if (markers.auth) {
      const composer = await this.engine.findComposer(this.page);
      if (!composer) return { auth: 'auth_required', reason: `auth marker + no composer: ${markers.auth}` };
    }
    const composer2 = await this.engine.findComposer(this.page);
    if (composer2) return { auth: 'authenticated', reason: 'composer found' };
    if (URL_AUTH_RE.test(url)) return { auth: 'auth_required', reason: `url=${url}` };
    return { auth: 'unknown', reason: 'no composer found, no auth markers' };
  }

  /** BOOT → AUTH_CHECK → READY. Fail-closed on login/limit/human/UI states. */
  async prepare(): Promise<void> {
    this.sm.transition(State.AUTH_CHECK);
    const auth = await this.detectAuthState();
    const markers = await this.scanPageMarkers();

    if (auth.auth === 'auth_required' || markers.auth) {
      this.sm.fail(State.AUTH_REQUIRED, `detectAuthState=${auth.auth} (${auth.reason})`);
      throw AdapterError.authRequired(auth.reason);
    }
    if (markers.human) {
      this.sm.fail(State.HUMAN_REQUIRED, markers.human);
      throw AdapterError.humanRequired(`marker "${markers.human}"`);
    }
    if (markers.rateLimit) {
      this.sm.fail(State.RATE_LIMITED, markers.rateLimit);
      throw AdapterError.rateLimited(`marker "${markers.rateLimit}"`);
    }

    const composer = await this.engine.findComposer(this.page);
    if (!composer) {
      // Phase 4: recovery pipeline may activate a validated candidate.
      const recovered = await this.recovery.recoverComposer(this.page);
      if (recovered) {
        this.recoveredComposer = recovered;
        this.log.warn({ score: recovered.score }, 'prepare: composer recovered via self-healing');
      } else {
        this.sm.fail(State.UI_UNKNOWN, 'no safe composer candidate');
        throw AdapterError.uiUnknown('no safe composer candidate on page');
      }
    } else if (composer.needsValidation) {
      this.log.warn({ score: composer.score }, 'composer in recovery band; proceeding with caution');
    }
    this.sm.transition(State.READY);
    this.prepared = true;
  }

  /**
   * One request. Exactly-once: an in-flight request rejects with
   * REQUEST_IN_PROGRESS; with persistence, previously submitted requests are
   * resumed instead of re-typed.
   */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (this.inFlight) {
      throw new AdapterError('REQUEST_IN_PROGRESS', 'another request is already using the ChatGPT tab');
    }
    if (this.degraded) {
      // A previous request hit the overall timeout with the page/CDP stuck;
      // the reconnect loop swaps this client. Fail closed until then.
      throw AdapterError.browserUnavailable('adapter degraded after a stuck request; reconnecting');
    }
    const task = this.run(messages, opts);
    this.inFlight = task;
    try {
      // Overall timeout: covers compose/submit phases too, where a stuck
      // CDP session would otherwise hold the lock forever (§31).
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            this.degraded = true;
            reject(
              new AdapterError(
                'GENERATION_TIMEOUT',
                `request exceeded overall timeout (${this.opts.timeoutMs!}ms + buffer)`,
              ),
            );
          }, this.opts.timeoutMs! + 30_000);
        }),
      ]);
    } finally {
      this.inFlight = null;
    }
  }

  private async run(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const requestId = `chatgpt-web-${randomUUID().slice(0, 8)}`;
    this.currentRequestId = requestId;
    const started = Date.now();
    const usedRuleIds: string[] = [];

    try {
      if (!this.prepared) {
        await this.prepare();
      } else if (this.sm.isErrorState()) {
        this.sm.transition(State.READY, 'recovered from error state');
      }

      const sessionId = opts.hermesSessionId ?? 'default';
      const history = normalizeHistory(messages);
      const requests = this.persistence ? new RequestStore(this.persistence) : null;
      const sessions = this.persistence ? new SessionStore(this.persistence) : null;
      let session: SessionRecord | null = null;

      // ---- Context synchronization (spec §20) ----
      let divergence = false;
      if (sessions) {
        session = sessions.get(sessionId);
        const prevHistory = session?.prev_history ?? '';
        divergence = !isDeltaExtension(prevHistory, history);
        if (divergence && session && session.prev_history !== '') {
          this.log.warn({ request: requestId, session: sessionId }, 'context divergence detected; starting fresh thread');
          sessions.detach(sessionId);
          await startFreshThread(this.page, { timeoutMs: 15_000 });
          session = sessions.upsert(sessionId, {
            generation: session.generation + 1,
            status: 'active',
            prev_history: history,
            history_hash: '',
          });
        } else if (!session) {
          // No mapping for this session: NEVER guess the thread from the
          // currently open tab (spec §19). If the tab already holds another
          // conversation, start a fresh thread for this session.
          const hasMessages = await this.page
            .locator(MESSAGE_SELECTORS.join(', '))
            .count()
            .then((n) => n > 0)
            .catch(() => true);
          const currentThread = threadFromUrl(this.page.url());
          if (hasMessages || (currentThread && currentThread.id !== 'new')) {
            this.log.info({ request: requestId, session: sessionId }, 'new session on a non-empty thread; starting fresh thread');
            await startFreshThread(this.page, { timeoutMs: 15_000 });
          }
          session = sessions.upsert(sessionId, { generation: 0, status: 'active', prev_history: history, history_hash: '' });
        } else if (session.web_thread_id && session.web_thread_id !== 'new') {
          // Mapped session: make sure the tab is on ITS thread, not a stray one.
          const currentThread = threadFromUrl(this.page.url());
          if (currentThread && currentThread.id !== session.web_thread_id && session.web_thread_url) {
            await this.page
              .goto(session.web_thread_url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
              .catch(() => undefined);
            await this.page.waitForTimeout(1500);
          }
        }
      }

      // ---- Prompt selection (spec §21, §23) ----
      const lastMsg = messages[messages.length - 1];
      let prompt: string;
      if (lastMsg?.role === 'tool') {
        // Phase 5: Hermes tool results → envelope for the web model.
        const results = messages
          .filter((m) => m.role === 'tool')
          .map((m) => ({ tool_call_id: m.tool_call_id ?? 'tool', content: m.content }));
        prompt = buildToolResultEnvelope(results);
        this.log.info({ request: requestId, toolResults: results.length }, 'tool-result round');
      } else {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUser) {
          throw AdapterError.invalidRequest('messages must contain at least one user message');
        }
        prompt = divergence && session ? canonicalPrompt(messages) : lastUser.content;
        // Phase 5: the web model must know the envelope protocol to use tools.
        if (opts.tools && opts.tools.length > 0) {
          prompt = `${buildToolProtocolInstructions(opts.tools)}\n\n${prompt}`;
        }
      }
      const generation = session?.generation ?? 0;

      if (messages.length > 1 && !divergence) {
        this.log.warn(
          { request: requestId, messageCount: messages.length },
          'multi-message history on a synchronized thread: sending only the last user message (delta mode)',
        );
      }

      // ---- Exactly-once gate (spec §17) ----
      if (requests) {
        const rHash = requestHash(sessionId, generation, prompt);
        const existing = requests.getByHash(rHash);
        if (existing?.state === 'COMPLETED' && existing.response_hash !== '') {
          this.log.info({ request: requestId, replay: true }, 'request already completed; replaying stored response');
          return {
            content: existing.response_text,
            id: requestId,
            created: Math.floor(Date.now() / 1000),
            model: 'chatgpt-web',
            latencyMs: 0,
            states: this.sm.trace(),
            composerRuleScore: null,
            submitRuleScore: null,
            signals: ['replay'],
            replay: true,
            webThreadId: existing.web_thread_id || undefined,
          };
        }
        if (existing?.state === 'COMPLETED') {
          // Completed with an empty stored response (edge): allow retry only
          // if the thread no longer contains the prompt; otherwise resume.
          requests.resetToPending(existing.request_id);
        }
        if (existing && (existing.state === 'SUBMITTED' || existing.state === 'GENERATING')) {
          return this.resumeRequest(existing, prompt, requestId, started);
        }
        if (existing?.state === 'FAILED') {
          requests.resetToPending(existing.request_id);
        }
      }

      // ---- COMPOSING ----
      this.sm.transition(State.COMPOSING);
      let composer = this.recoveredComposer ?? (await this.engine.findComposer(this.page));
      this.recoveredComposer = null;
      if (!composer) {
        // Phase 4: self-healing — discover + non-destructively validate a
        // candidate, then use it as a canary for THIS request.
        this.log.warn({ request: requestId }, 'composer not found; entering recovery pipeline');
        composer = await this.recovery.recoverComposer(this.page);
        if (!composer) {
          this.sm.fail(State.UI_UNKNOWN, 'composer lost between prepare and compose');
          throw AdapterError.uiUnknown('composer not found at compose time (recovery failed)');
        }
      }
      if (composer.ruleId) usedRuleIds.push(composer.ruleId);
      // Clear any residue from a previously failed attempt before typing.
      const existingText = await composerText(composer.locator).catch(() => '');
      if (existingText.trim() !== '') {
        await clearComposer(composer.locator);
      }
      const typed: ComposerInputResult = await typeIntoComposer(this.page, composer.locator, prompt);
      this.log.info({ request: requestId, composer_score: composer.score, verification: typed.verification }, 'composing');
      if (!typed.ok) {
        this.sm.fail(State.UI_UNKNOWN, `composer insertion failed: ${typed.verification}`);
        throw AdapterError.uiUnknown(`could not type into composer (${typed.verification})`);
      }

      // ---- SUBMITTED ----
      const before = await snapshotConversation(this.page);
      let submit: SubmitOutcome;
      try {
        submit = await confirmAndClickSubmit(this.page, this.engine, composer, {
          confirmationTimeoutMs: 6000,
        });
      } catch (err) {
        if (err instanceof AdapterError && err.code === 'UI_UNKNOWN') {
          // Phase 4: recover a submit control behaviorally, then click it.
          const recovered = await this.recovery.recoverSubmit(this.page, composer, { composerEmpty: false });
          if (!recovered) throw err;
          const outcome = await clickAndConfirmSubmit(this.page, recovered.locator, composer, {
            confirmationTimeoutMs: 6000,
            ruleScore: recovered.score,
            ruleId: recovered.ruleId,
            profile: recovered.profile,
          });
          submit = outcome;
        } else {
          throw err;
        }
      }
      if (submit.ruleScore !== null && submit.ruleId) usedRuleIds.push(submit.ruleId);
      this.sm.transition(State.SUBMITTED, `submit_score=${submit.ruleScore ?? 'n/a'}`);
      this.log.info({ request: requestId, confirmation: submit.confirmation, submit_score: submit.ruleScore }, 'submitted');

      const userMsgSeen = await waitForNewUserMessage(this.page, before, 10_000);
      if (!userMsgSeen) {
        this.sm.fail(State.UI_UNKNOWN, 'user message not confirmed after submit');
        throw AdapterError.uiUnknown('user message not confirmed after submit');
      }

      // Persist: the prompt IS in the thread now — never type it again.
      const thread = threadFromUrl(this.page.url());
      if (requests) {
        const rec = requests.createOrGet({
          request_id: requestId,
          request_hash: requestHash(sessionId, generation, prompt),
          hermes_session_id: sessionId,
          web_thread_id: thread?.id ?? 'new',
          prompt_hash: promptHash(prompt),
          prompt_text: prompt,
          state: 'SUBMITTED',
          response_hash: '',
          response_text: '',
        });
        if (rec.state !== 'SUBMITTED') {
          requests.updateState(rec.request_id, 'SUBMITTED', { web_thread_id: thread?.id ?? 'new' });
        }
        sessions?.upsert(sessionId, {
          web_thread_id: thread?.id ?? 'new',
          web_thread_url: thread?.url ?? this.page.url(),
          history_hash: '',
          prev_history: history,
          status: 'active',
        });
      }

      // ---- GENERATING ----
      this.sm.transition(State.GENERATING);
      const outcome: ResponseOutcome = await waitForResponse(this.page, before, {
        timeoutMs: this.opts.timeoutMs!,
        stableMs: this.opts.responseStableMs!,
        onSample: opts.onDelta ? (t) => opts.onDelta!(t) : undefined,
      });
      this.sm.transition(State.COMPLETED);

      // Phase 5: parse tool-call envelopes from the web model's reply.
      const parsed = parseToolCalls(outcome.text, opts.tools);
      if (parsed.errors.length > 0) {
        throw new AdapterError(
          'PROTOCOL_ERROR',
          `tool protocol violation: ${parsed.errors[0]}`,
        );
      }
      const toolCalls = toOpenAIToolCalls(parsed.calls);
      const content = toolCalls.length > 0 ? stripToolEnvelopes(outcome.text) : outcome.text;

      // Persist completion.
      if (requests) {
        const rec = requests.getByHash(requestHash(sessionId, generation, prompt));
        if (rec) {
          requests.completeWithResponse(rec.request_id, content);
          requests.updateState(rec.request_id, 'COMPLETED', {
            web_thread_id: thread?.id ?? rec.web_thread_id,
          });
        }
        const finalThread = threadFromUrl(this.page.url());
        sessions?.upsert(sessionId, {
          web_thread_id: finalThread?.id ?? thread?.id ?? 'new',
          web_thread_url: finalThread?.url ?? this.page.url(),
          history_hash: '',
          prev_history: history,
          status: 'active',
        });
      }

      // Phase 3: learn + reinforce locator rules from this success.
      if (this.registry) {
        this.learnRule('composer', composer);
        this.learnRule('submit_control', submit);
        for (const id of usedRuleIds) {
          this.registry.recordSuccess(id);
        }
      }

      const result: ChatResult = {
        content,
        id: requestId,
        created: Math.floor(Date.now() / 1000),
        model: 'chatgpt-web',
        latencyMs: Date.now() - started,
        states: this.sm.trace(),
        composerRuleScore: composer.score,
        submitRuleScore: submit.ruleScore,
        signals: outcome.signals,
        divergence,
        webThreadId: thread?.id,
        webThreadUrl: thread?.url,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolRepairs: parsed.repairs.length > 0 ? parsed.repairs : undefined,
      };
      this.log.info(
        { request: requestId, latency_ms: result.latencyMs, stability_ms: outcome.stabilityMs, signals: outcome.signals },
        'completed',
      );

      this.sm.transition(State.READY);
      return result;
    } catch (err) {
      if (err instanceof AdapterError && !this.sm.isErrorState()) {
        const map: Record<string, State> = {
          AUTH_REQUIRED: State.AUTH_REQUIRED,
          RATE_LIMITED: State.RATE_LIMITED,
          HUMAN_REQUIRED: State.HUMAN_REQUIRED,
          UI_UNKNOWN: State.UI_UNKNOWN,
          GENERATION_TIMEOUT: State.GENERATION_ERROR,
          GENERATION_ERROR: State.GENERATION_ERROR,
          BROWSER_UNAVAILABLE: State.NETWORK_ERROR,
        };
        const s = map[err.code];
        if (s) this.sm.fail(s, err.message);
      }
      // Phase 3: rules that were used but failed get failure credit; bad
      // probation rules roll back (never touch core code).
      if (this.registry) {
        for (const id of usedRuleIds) {
          this.registry.recordFailure(id);
        }
      }
      throw err;
    } finally {
      this.currentRequestId = null;
    }
  }

  /**
   * Learn a locator rule from a successful interaction (spec §12).
   * Idempotent: identical rules reuse the same rule_id; repeated successes
   * promote PROBATION → STABLE.
   */
  private learnRule(
    capability: 'composer' | 'submit_control',
    source: { profile?: LocatorResult['profile'] },
  ): void {
    if (!this.registry || !source.profile) return;
    const p = source.profile;
    const rule: UiRule = {
      version: 1,
      selectors: [],
      profile: {
        tag: p.tag,
        contenteditable: p.contenteditable,
        role: p.role,
        placeholder: p.placeholder,
        ariaLabel: p.ariaLabel,
        testid: p.testid,
      },
    };
    const rec = this.registry.discover(capability, rule, '', 0.95);
    this.registry.promoteToProbation(rec.rule_id);
    this.registry.recordSuccess(rec.rule_id);
  }

  /**
   * Resume a request that was already submitted (spec §17). The prompt must
   * be found in the thread; if it is not, we fail closed rather than risk a
   * duplicate submission.
   */
  private async resumeRequest(
    rec: RequestRecord,
    prompt: string,
    newRequestId: string,
    started: number,
  ): Promise<ChatResult> {
    this.log.info({ request: newRequestId, original: rec.request_id }, 'resuming previously submitted request');
    const requests = new RequestStore(this.persistence!);
    const sessions = new SessionStore(this.persistence!);
    const session = sessions.get(rec.hermes_session_id);
    const threadUrl = session?.web_thread_url ?? '';

    // Ensure the tab is on the mapped thread when we know it.
    if (rec.web_thread_id && rec.web_thread_id !== 'new' && threadUrl) {
      const cur = threadFromUrl(this.page.url());
      if (!cur || cur.id !== rec.web_thread_id) {
        await this.page.goto(threadUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
      }
    }

    const idx = await findUserMessageIndex(this.page, prompt);
    if (idx === null) {
      requests.markFailed(rec.request_id, 'resume: prompt not found in thread');
      throw new AdapterError(
        'CONTEXT_DIVERGED',
        'unfinished request not found in its thread after restart; refusing to resubmit',
      );
    }

    const before: ConversationSnapshot = await snapshotUpTo(this.page, idx);
    this.sm.transition(State.SUBMITTED, 'resumed');
    this.sm.transition(State.GENERATING, 'resumed');

    const outcome: ResponseOutcome = await waitForResponse(this.page, before, {
      timeoutMs: this.opts.timeoutMs!,
      stableMs: this.opts.responseStableMs!,
    });
    this.sm.transition(State.COMPLETED);
    requests.completeWithResponse(rec.request_id, outcome.text);

    const thread = threadFromUrl(this.page.url());
    this.sm.transition(State.READY);
    return {
      content: outcome.text,
      id: newRequestId,
      created: Math.floor(Date.now() / 1000),
      model: 'chatgpt-web',
      latencyMs: Date.now() - started,
      states: this.sm.trace(),
      composerRuleScore: null,
      submitRuleScore: null,
      signals: [...outcome.signals, 'resumed'],
      resumed: true,
      webThreadId: thread?.id ?? rec.web_thread_id,
      webThreadUrl: thread?.url ?? session?.web_thread_url,
    };
  }

  /** Lightweight liveness probe (spec §31) — used by the reconnect loop. */
  async health(): Promise<boolean> {
    if (this.degraded) return false;
    try {
      await this.page.evaluate(() => 1);
      return true;
    } catch {
      return false;
    }
  }

  /** Boot-time recovery: finish requests that were in-flight at last shutdown. */
  async resumeUnfinished(): Promise<Array<{ request_id: string; status: string; error?: string }>> {
    if (!this.persistence) return [];
    const requests = new RequestStore(this.persistence);
    const unfinished = requests.listUnfinished();
    const reports: Array<{ request_id: string; status: string; error?: string }> = [];

    for (const rec of unfinished) {
      const attemptId = `chatgpt-web-${randomUUID().slice(0, 8)}`;
      try {
        if (!rec.prompt_text) {
          requests.markFailed(rec.request_id, 'no prompt text recorded');
          reports.push({ request_id: rec.request_id, status: 'FAILED', error: 'no prompt text' });
          continue;
        }
        const sessions = new SessionStore(this.persistence);
        const session = sessions.get(rec.hermes_session_id);
        if (!rec.web_thread_id || rec.web_thread_id === 'new' || !session?.web_thread_url) {
          reports.push({ request_id: rec.request_id, status: 'UNRESOLVED', error: 'thread url unknown' });
          continue;
        }
        if (this.sm.state !== State.READY) {
          if (this.prepared) {
            this.sm.transition(State.READY, 'resume cycle');
          } else {
            await this.prepare();
          }
        }
        const result = await this.resumeRequest(rec, rec.prompt_text, attemptId, Date.now());
        reports.push({ request_id: rec.request_id, status: 'COMPLETED' });
        this.log.info({ request: attemptId, resumed: true }, 'resume completed');
        void result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reports.push({ request_id: rec.request_id, status: 'ERROR', error: msg });
        this.log.warn({ request: attemptId, err: msg }, 'resume failed');
      }
    }
    return reports;
  }
}
