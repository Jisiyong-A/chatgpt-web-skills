import { describe, expect, it } from 'vitest';
import { StateMachine, State } from '../../src/chatgpt/state-machine.js';

describe('StateMachine', () => {
  it('follows the normal happy path', () => {
    const sm = new StateMachine();
    sm.transition(State.AUTH_CHECK);
    sm.transition(State.READY);
    sm.transition(State.COMPOSING);
    sm.transition(State.SUBMITTED);
    sm.transition(State.GENERATING);
    sm.transition(State.COMPLETED);
    sm.transition(State.READY);
    expect(sm.state).toBe(State.READY);
  });

  it('rejects invalid transitions', () => {
    const sm = new StateMachine();
    expect(() => sm.transition(State.GENERATING)).toThrow(/Invalid state transition/);
  });

  it('cannot skip steps: SUBMITTED without COMPOSING is invalid from BOOT', () => {
    const sm = new StateMachine();
    expect(() => sm.transition(State.COMPLETED)).toThrow(/Invalid state transition/);
  });

  it('fail() requires an error state', () => {
    const sm = new StateMachine();
    expect(() => sm.fail(State.READY)).toThrow(/error state/);
  });

  it('transitions to error states and recovers', () => {
    const sm = new StateMachine();
    sm.transition(State.AUTH_CHECK);
    sm.fail(State.AUTH_REQUIRED);
    expect(sm.isErrorState()).toBe(true);
    sm.transition(State.READY);
    expect(sm.isErrorState()).toBe(false);
  });

  it('records every transition with timestamps', () => {
    const sm = new StateMachine();
    sm.transition(State.AUTH_CHECK, 'checking');
    const h = sm.history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from: State.BOOT, to: State.AUTH_CHECK, reason: 'checking' });
    expect(h[0]!.at).toBeGreaterThan(0);
  });

  it('notifies onChange for every transition', () => {
    const seen: Array<[State, State]> = [];
    const sm = new StateMachine((from, to) => seen.push([from, to]));
    sm.transition(State.AUTH_CHECK);
    sm.transition(State.READY);
    expect(seen).toEqual([
      [State.BOOT, State.AUTH_CHECK],
      [State.AUTH_CHECK, State.READY],
    ]);
  });

  it('maps error paths: GENERATING -> GENERATION_TIMEOUT -> READY', () => {
    const sm = new StateMachine();
    sm.transition(State.AUTH_CHECK);
    sm.transition(State.READY);
    sm.transition(State.COMPOSING);
    sm.transition(State.SUBMITTED);
    sm.transition(State.GENERATING);
    sm.fail(State.GENERATION_TIMEOUT);
    expect(sm.state).toBe(State.GENERATION_TIMEOUT);
    sm.transition(State.READY);
    expect(sm.state).toBe(State.READY);
  });

  it('allows READY -> SUBMITTED for crash-resume of a persisted request', () => {
    const sm = new StateMachine();
    sm.transition(State.AUTH_CHECK);
    sm.transition(State.READY);
    sm.transition(State.SUBMITTED, 'resumed');
    expect(sm.state).toBe(State.SUBMITTED);
  });
});
