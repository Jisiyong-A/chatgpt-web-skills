/**
 * Durable request lifecycle (spec §17, §43).
 * States: PENDING → SUBMITTED → GENERATING → COMPLETED | FAILED.
 */

import { createHash } from 'node:crypto';
import type { Persistence } from './sqlite.js';

export type RequestState = 'PENDING' | 'SUBMITTED' | 'GENERATING' | 'COMPLETED' | 'FAILED';

export interface RequestRecord {
  request_id: string;
  request_hash: string;
  hermes_session_id: string;
  web_thread_id: string;
  prompt_hash: string;
  prompt_text: string;
  state: RequestState;
  response_hash: string;
  response_text: string;
  created_at: number;
  updated_at: number;
}

const UNFINISHED_STATES: Array<'SUBMITTED' | 'GENERATING'> = ['SUBMITTED', 'GENERATING'];

export class RequestStore {
  constructor(private readonly persistence: Persistence) {}

  private rowToRecord(r: Record<string, unknown>): RequestRecord {
    return {
      request_id: String(r.request_id),
      request_hash: String(r.request_hash),
      hermes_session_id: String(r.hermes_session_id),
      web_thread_id: String(r.web_thread_id),
      prompt_hash: String(r.prompt_hash),
      prompt_text: String(r.prompt_text),
      state: r.state as RequestState,
      response_hash: String(r.response_hash),
      response_text: String(r.response_text),
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
    };
  }

  getByHash(requestHash: string): RequestRecord | null {
    const row = this.persistence.db
      .prepare('SELECT * FROM requests WHERE request_hash = ?')
      .get(requestHash) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  getById(requestId: string): RequestRecord | null {
    const row = this.persistence.db
      .prepare('SELECT * FROM requests WHERE request_id = ?')
      .get(requestId) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  listUnfinished(limit = 10): RequestRecord[] {
    const rows = this.persistence.db
      .prepare(
        `SELECT * FROM requests WHERE state IN (?, ?) ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...UNFINISHED_STATES, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToRecord(r));
  }

  /** Idempotent create: returns the existing record if request_hash exists. */
  createOrGet(rec: Omit<RequestRecord, 'created_at' | 'updated_at'>): RequestRecord {
    const existing = this.getByHash(rec.request_hash);
    if (existing) return existing;
    const now = Date.now();
    this.persistence.db
      .prepare(
        `INSERT INTO requests (request_id, request_hash, hermes_session_id, web_thread_id, prompt_hash, prompt_text, state, response_hash, response_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.request_id,
        rec.request_hash,
        rec.hermes_session_id,
        rec.web_thread_id,
        rec.prompt_hash,
        rec.prompt_text,
        rec.state,
        rec.response_hash,
        rec.response_text,
        now,
        now,
      );
    return this.getByHash(rec.request_hash)!;
  }

  /** Allow a retry after a FAILED attempt with the same request hash. */
  resetToPending(requestId: string): void {
    this.persistence.db
      .prepare('UPDATE requests SET state = ?, updated_at = ? WHERE request_id = ?')
      .run('PENDING', Date.now(), requestId);
  }

  updateState(
    requestId: string,
    state: RequestState,
    extra: Partial<Pick<RequestRecord, 'web_thread_id' | 'response_hash'>> = {},
  ): void {
    this.persistence.db
      .prepare(
        `UPDATE requests
         SET state = ?, web_thread_id = COALESCE(?, web_thread_id), response_hash = COALESCE(?, response_hash), updated_at = ?
         WHERE request_id = ?`,
      )
      .run(state, extra.web_thread_id ?? null, extra.response_hash ?? null, Date.now(), requestId);
  }

  completeWithResponse(requestId: string, responseText: string): void {
    const hash = createHash('sha256').update(responseText).digest('hex').slice(0, 16);
    this.persistence.db
      .prepare(
        `UPDATE requests SET state = ?, response_text = ?, response_hash = ?, updated_at = ? WHERE request_id = ?`,
      )
      .run('COMPLETED', responseText.slice(0, 1_000_000), hash, Date.now(), requestId);
  }

  markFailed(requestId: string, reason: string): void {
    this.persistence.db
      .prepare('UPDATE requests SET state = ?, updated_at = ? WHERE request_id = ?')
      .run(`FAILED`, Date.now(), requestId);
  }
}
