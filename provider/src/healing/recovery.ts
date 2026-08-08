/**
 * Self-healing recovery pipeline (spec §33, §37, §4).
 *
 * When the deterministic/semantic locator fails, the pipeline:
 *   1. collects ALL candidates (no threshold filter)
 *   2. non-destructively validates the best ones (composer: nonce round-trip;
 *      submit: behavioral content-driven probe)
 *   3. activates the first valid candidate for THIS request (canary use)
 *   4. registers it as a rule (DISCOVERED → PROBATION) so it learns from
 *      subsequent successes/failures
 *
 * If nothing validates → null → caller reports UI_UNKNOWN (fail closed).
 * Healing only writes declarative rule data, never core code (spec §35).
 */

import type { Page } from 'playwright';
import type { Logger } from 'pino';
import type { LocatorEngine, LocatorResult } from '../semantic/locator-engine.js';
import { validateComposerCandidate } from '../chatgpt/composer.js';
import type { RuleRegistry, UiRule } from './registry.js';
import type { Persistence } from '../persistence/sqlite.js';

const MIN_CANDIDATE_SCORE = 0.4; // below this the candidate is hopeless

export class RecoveryPipeline {
  constructor(
    private readonly engine: LocatorEngine,
    private readonly registry: RuleRegistry | null,
    private readonly persistence: Persistence | null,
    private readonly log: Logger,
  ) {}

  private recordEvent(kind: string, payload: Record<string, unknown>): void {
    if (!this.persistence) return;
    try {
      this.persistence.db
        .prepare('INSERT INTO healing_events (kind, payload_json, created_at) VALUES (?, ?, ?)')
        .run(kind, JSON.stringify(payload), Date.now());
    } catch {
      // event recording must never break the recovery path
    }
  }

  private registerRule(capability: 'composer' | 'submit_control', view: LocatorResult['profile']): string | null {
    if (!this.registry) return null;
    const rule: UiRule = {
      version: 1,
      selectors: [],
      profile: {
        tag: view.tag,
        contenteditable: view.contenteditable,
        role: view.role,
        placeholder: view.placeholder,
        ariaLabel: view.ariaLabel,
        testid: view.testid,
      },
    };
    const rec = this.registry.discover(capability, rule, '', 0.8);
    this.registry.promoteToProbation(rec.rule_id);
    return rec.rule_id;
  }

  /**
   * Find a composer when the normal path failed. Validates candidates with a
   * nonce round-trip (type nonce → verify → clear → verify empty).
   */
  async recoverComposer(page: Page, maxCandidates = 3): Promise<LocatorResult | null> {
    const candidates = await this.engine.findComposerCandidates(page);
    for (const c of candidates.slice(0, maxCandidates)) {
      if (c.score < MIN_CANDIDATE_SCORE) break;
      const probe = await validateComposerCandidate(page, c.locator);
      if (!probe.valid) continue;
      const ruleId = this.registerRule('composer', c.profile);
      this.log.warn(
        { score: c.score, reason: probe.reason, ruleId: ruleId ?? null },
        'recovery: composer candidate validated and activated (canary)',
      );
      this.recordEvent('composer_recovered', { score: c.score, reason: probe.reason, ruleId });
      return {
        capability: 'composer',
        locator: c.locator,
        index: 0,
        score: c.score,
        matched: [...c.matched, 'recovered'],
        needsValidation: true,
        ruleId: ruleId ?? c.ruleId,
        profile: c.profile,
      };
    }
    this.recordEvent('composer_recovery_failed', { candidates: candidates.length });
    return null;
  }

  /**
   * Find a submit control when the normal path failed. Validates candidates
   * with the behavioral content-driven probe (enabled with text, disabled or
   * removed when empty).
   */
  async recoverSubmit(
    page: Page,
    composerResult: LocatorResult,
    opts: { composerEmpty?: boolean; maxCandidates?: number } = {},
  ): Promise<LocatorResult | null> {
    const candidates = await this.engine.findSubmitCandidates(page, composerResult, {
      composerEmpty: opts.composerEmpty,
    });
    for (const c of candidates.slice(0, opts.maxCandidates ?? 3)) {
      if (c.score < MIN_CANDIDATE_SCORE) break;
      const valid = await this.engine.validateSubmitCandidate(page, c.locator, composerResult.locator);
      if (!valid) continue;
      const ruleId = this.registerRule('submit_control', c.profile);
      this.log.warn(
        { score: c.score, ruleId: ruleId ?? null },
        'recovery: submit candidate validated and activated (canary)',
      );
      this.recordEvent('submit_recovered', { score: c.score, ruleId });
      return {
        capability: 'submit_control',
        locator: c.locator,
        index: 0,
        score: c.score,
        matched: [...c.matched, 'recovered'],
        needsValidation: true,
        ruleId: ruleId ?? c.ruleId,
        profile: c.profile,
      };
    }
    this.recordEvent('submit_recovery_failed', { candidates: candidates.length });
    return null;
  }
}
