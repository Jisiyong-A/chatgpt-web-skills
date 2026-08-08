/**
 * ui_rules persistence (spec §43). Table created by schema.ts.
 */

import type { Persistence } from './sqlite.js';

export type RuleStatus = 'discovered' | 'candidate' | 'probation' | 'stable' | 'failed';

export interface UiRuleRecord {
  rule_id: string;
  capability: string;
  rule_json: string;
  confidence: number;
  status: RuleStatus;
  success_count: number;
  failure_count: number;
  ui_fingerprint: string;
  created_at: number;
  last_seen: number;
}

export class UiRuleStore {
  constructor(private readonly persistence: Persistence) {}

  private rowToRecord(r: Record<string, unknown>): UiRuleRecord {
    return {
      rule_id: String(r.rule_id),
      capability: String(r.capability),
      rule_json: String(r.rule_json),
      confidence: Number(r.confidence),
      status: r.status as RuleStatus,
      success_count: Number(r.success_count),
      failure_count: Number(r.failure_count),
      ui_fingerprint: String(r.ui_fingerprint),
      created_at: Number(r.created_at),
      last_seen: Number(r.last_seen),
    };
  }

  listActive(capability: string): UiRuleRecord[] {
    const rows = this.persistence.db
      .prepare(
        "SELECT * FROM ui_rules WHERE capability = ? AND status IN ('stable', 'probation') ORDER BY confidence DESC, success_count DESC",
      )
      .all(capability) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToRecord(r));
  }

  get(ruleId: string): UiRuleRecord | null {
    const row = this.persistence.db
      .prepare('SELECT * FROM ui_rules WHERE rule_id = ?')
      .get(ruleId) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  upsert(rec: Omit<UiRuleRecord, 'created_at' | 'last_seen'>): UiRuleRecord {
    const now = Date.now();
    this.persistence.db
      .prepare(
        `INSERT INTO ui_rules (rule_id, capability, rule_json, confidence, status, success_count, failure_count, ui_fingerprint, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET
           capability = excluded.capability,
           rule_json = excluded.rule_json,
           confidence = excluded.confidence,
           status = excluded.status,
           success_count = excluded.success_count,
           failure_count = excluded.failure_count,
           ui_fingerprint = excluded.ui_fingerprint,
           last_seen = excluded.last_seen`,
      )
      .run(
        rec.rule_id,
        rec.capability,
        rec.rule_json,
        rec.confidence,
        rec.status,
        rec.success_count,
        rec.failure_count,
        rec.ui_fingerprint,
        now,
        now,
      );
    return this.get(rec.rule_id)!;
  }

  remove(ruleId: string): void {
    this.persistence.db.prepare('DELETE FROM ui_rules WHERE rule_id = ?').run(ruleId);
  }

  /** Record a successful interaction; PROBATION → STABLE after 3 successes. */
  recordSuccess(ruleId: string, promoteAfter = 3): UiRuleRecord | null {
    const rec = this.get(ruleId);
    if (!rec) return null;
    const success_count = rec.success_count + 1;
    const status = rec.status === 'probation' && success_count >= promoteAfter ? 'stable' : rec.status;
    return this.upsert({ ...rec, success_count, status, failure_count: 0 });
  }

  /**
   * Record a failure. PROBATION rules fail fast (≥2 → failed = rollback).
   * STABLE rules demote to PROBATION at ≥3 consecutive failures.
   */
  recordFailure(ruleId: string): UiRuleRecord | null {
    const rec = this.get(ruleId);
    if (!rec) return null;
    const failure_count = rec.failure_count + 1;
    let status: RuleStatus = rec.status;
    if (rec.status === 'probation' && failure_count >= 2) status = 'failed';
    if (rec.status === 'stable' && failure_count >= 3) status = 'probation';
    return this.upsert({ ...rec, failure_count, status });
  }
}
