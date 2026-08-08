/**
 * Explicit browser state machine (spec §6).
 * Every transition is validated, observable and logged.
 * A state is never inferred from a single brittle selector — the
 * transitions here are driven by multi-signal detectors.
 */

export const State = {
  BOOT: 'BOOT',
  AUTH_CHECK: 'AUTH_CHECK',
  READY: 'READY',
  COMPOSING: 'COMPOSING',
  SUBMITTED: 'SUBMITTED',
  GENERATING: 'GENERATING',
  COMPLETED: 'COMPLETED',

  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  GENERATION_ERROR: 'GENERATION_ERROR',
  UI_UNKNOWN: 'UI_UNKNOWN',
  HUMAN_REQUIRED: 'HUMAN_REQUIRED',
  BROWSER_UNAVAILABLE: 'BROWSER_UNAVAILABLE',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
} as const;

export type State = (typeof State)[keyof typeof State];

const ERROR_STATES: State[] = [
  State.AUTH_REQUIRED,
  State.RATE_LIMITED,
  State.MODEL_UNAVAILABLE,
  State.NETWORK_ERROR,
  State.GENERATION_ERROR,
  State.UI_UNKNOWN,
  State.HUMAN_REQUIRED,
  State.BROWSER_UNAVAILABLE,
  State.GENERATION_TIMEOUT,
];

const ALLOWED: Record<State, State[]> = {
  [State.BOOT]: [State.AUTH_CHECK, State.BROWSER_UNAVAILABLE, State.NETWORK_ERROR, State.UI_UNKNOWN],
  [State.AUTH_CHECK]: [State.READY, State.AUTH_REQUIRED, State.HUMAN_REQUIRED, State.RATE_LIMITED, State.UI_UNKNOWN, State.NETWORK_ERROR],
  [State.READY]: [State.COMPOSING, State.SUBMITTED, State.AUTH_REQUIRED, State.RATE_LIMITED, State.HUMAN_REQUIRED, State.UI_UNKNOWN, State.NETWORK_ERROR],
  [State.COMPOSING]: [State.SUBMITTED, State.READY, State.UI_UNKNOWN, State.NETWORK_ERROR],
  [State.SUBMITTED]: [State.GENERATING, State.COMPLETED, State.GENERATION_ERROR, State.UI_UNKNOWN, State.AUTH_REQUIRED, State.RATE_LIMITED, State.HUMAN_REQUIRED],
  [State.GENERATING]: [State.COMPLETED, State.GENERATION_ERROR, State.GENERATION_TIMEOUT, State.AUTH_REQUIRED, State.HUMAN_REQUIRED, State.RATE_LIMITED, State.UI_UNKNOWN, State.NETWORK_ERROR],
  [State.COMPLETED]: [State.READY, State.UI_UNKNOWN],
  [State.AUTH_REQUIRED]: [State.READY, State.BOOT],
  [State.RATE_LIMITED]: [State.READY, State.BOOT],
  [State.MODEL_UNAVAILABLE]: [State.READY, State.BOOT],
  [State.NETWORK_ERROR]: [State.READY, State.BOOT],
  [State.GENERATION_ERROR]: [State.READY, State.BOOT],
  [State.UI_UNKNOWN]: [State.READY, State.BOOT],
  [State.HUMAN_REQUIRED]: [State.READY, State.BOOT],
  [State.BROWSER_UNAVAILABLE]: [State.READY, State.BOOT],
  [State.GENERATION_TIMEOUT]: [State.READY, State.BOOT],
};

export interface StateTransition {
  from: State;
  to: State;
  at: number;
  reason?: string;
}

export class StateMachine {
  private _state: State = State.BOOT;
  private transitions: StateTransition[] = [];
  private onChange: ((from: State, to: State, reason?: string) => void) | undefined;

  constructor(onChange?: (from: State, to: State, reason?: string) => void) {
    this.onChange = onChange;
  }

  get state(): State {
    return this._state;
  }

  get history(): StateTransition[] {
    return this.transitions;
  }

  reset(reason = 'machine reset'): void {
    this.transitions.push({ from: this._state, to: State.BOOT, at: Date.now(), reason });
    this._state = State.BOOT;
  }

  transition(to: State, reason?: string): State {
    const from = this._state;
    const allowed = ALLOWED[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid state transition ${from} -> ${to}`);
    }
    this.transitions.push({ from, to, at: Date.now(), reason });
    this._state = to;
    this.onChange?.(from, to, reason);
    return to;
  }

  /** Transition to an error state (validated like any other transition). */
  fail(code: State, reason?: string): State {
    if (!ERROR_STATES.includes(code)) {
      throw new Error(`fail() requires an error state, got ${code}`);
    }
    return this.transition(code, reason);
  }

  isErrorState(s: State = this._state): boolean {
    return ERROR_STATES.includes(s);
  }

  trace(): string[] {
    return this.transitions.map(
      (t) => `${new Date(t.at).toISOString()} ${t.from}->${t.to}${t.reason ? ` (${t.reason})` : ''}`,
    );
  }
}
