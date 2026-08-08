/**
 * Self-healing rule registry (spec §12, §13).
 * Rule lifecycle: DISCOVERED → CANDIDATE → PROBATION → STABLE.
 * Failure path: PROBATION → FAILED (rollback). Healing only touches
 * declarative rule data — never core source code.
 */

import type { Persistence } from '../persistence/sqlite.js';
import { UiRuleStore, type UiRuleRecord } from '../persistence/ui-rules.js';
import { shortHash } from '../hermes/request-hash.js';

export interface UiRule {
  version: 1;
  /** Hint selectors that led to this element (may be empty for semantic finds). */
  selectors: string[];
  /** Stable semantic profile of the matched element. */
  profile: {
    tag: string | null;
    contenteditable?: boolean;
    role?: string | null;
    placeholder?: string | null;
    ariaLabel?: string | null;
    testid?: string | null;
  };
}

export class RuleRegistry {
  private readonly store: UiRuleStore;

  constructor(persistence: Persistence) {
    this.store = new UiRuleStore(persistence);
  }

  listActive(capability: string): UiRuleRecord[] {
    return this.store.listActive(capability);
  }

  /** Build a deterministic rule id from capability + rule content. */
  ruleIdFor(capability: string, rule: UiRule): string {
    return `${capability}-${shortHash(JSON.stringify(rule))}`;
  }

  /** DISCOVERED (idempotent — same rule content returns the existing record). */
  discover(capability: string, rule: UiRule, fingerprint: string, confidence: number): UiRuleRecord {
    const ruleId = this.ruleIdFor(capability, rule);
    const existing = this.store.get(ruleId);
    if (existing) return existing;
    return this.store.upsert({
      rule_id: ruleId,
      capability,
      rule_json: JSON.stringify(rule),
      confidence,
      status: 'discovered',
      success_count: 0,
      failure_count: 0,
      ui_fingerprint: fingerprint,
    });
  }

  /** DISCOVERED → CANDIDATE (validation starts here in Phase 4). */
  markCandidate(ruleId: string): UiRuleRecord | null {
    const rec = this.store.get(ruleId);
    if (!rec) return null;
    return this.store.upsert({ ...rec, status: 'candidate' });
  }

  /** CANDIDATE/PROBATION → PROBATION after successful validation. */
  promoteToProbation(ruleId: string): UiRuleRecord | null {
    const rec = this.store.get(ruleId);
    if (!rec) return null;
    return this.store.upsert({ ...rec, status: 'probation' });
  }

  /** Interaction succeeded. */
  recordSuccess(ruleId: string): UiRuleRecord | null {
    return this.store.recordSuccess(ruleId);
  }

  /** Interaction failed. Probation rules roll back to failed quickly. */
  recordFailure(ruleId: string): UiRuleRecord | null {
    return this.store.recordFailure(ruleId);
  }
}
