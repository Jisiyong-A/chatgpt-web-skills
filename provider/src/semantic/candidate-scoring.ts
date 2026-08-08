/**
 * Candidate scoring model (spec §7).
 * Configurable weight-based scoring; a candidate is only accepted above a
 * confidence threshold. Weights are tuned so that a realistic ChatGPT-like
 * composer (contenteditable div in the lower main region with placeholder)
 * scores >= 0.90, while nav/random elements score far below.
 *
 * Contextual bonuses (nearSubmit, historical) are EXCLUDED from the
 * denominator so a valid element can never be penalized for their absence.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  bottom: number;
}

export interface ElementProfile {
  tag: string;
  role: string | null;
  contenteditable: boolean;
  placeholder: string | null;
  ariaLabel: string | null;
  id: string;
  classes: string[];
  visible: boolean;
  rect: Rect | null;
  insideMain: boolean;
  lowerViewport: boolean;
  /** A button-like control exists near this element (spec §7 near-submit signal). */
  nearSubmit: boolean;
  text: string;
  dataTestId: string | null;
  disabled: boolean;
  /** The element carries an aria-disabled attribute (content-driven control). */
  hasAriaDisabled: boolean;
  isButtonLike: boolean;
}

export const SAFE_THRESHOLD = 0.9;
export const RECOVERY_THRESHOLD = 0.75;
/** If the top two candidates are within this margin, treat UI as ambiguous. */
export const AMBIGUITY_MARGIN = 0.05;

export const COMPOSER_WEIGHTS = {
  multiline: 40, // contenteditable OR textarea — core editable-ness
  roleTextbox: 15, // ARIA role=textbox
  visible: 15,
  insideMain: 10,
  lowerViewport: 10,
  nearSubmit: 10, // contextual bonus (excluded from max)
  historicalSuccess: 10, // registry bonus, Phase 3 (excluded from max)
  knownSemanticAttrs: 15, // placeholder / aria-label / id / class hints
} as const;
export const COMPOSER_MAX = 105; // sum of non-bonus weights

export const SUBMIT_WEIGHTS = {
  buttonLike: 35,
  nearComposer: 25,
  conditionalEnablement: 15, // behavioral bonus (excluded from max)
  visible: 10,
  insideMain: 10,
  reasonableGeometry: 15,
  knownSemanticAttrs: 10,
  historicalSuccess: 10, // registry bonus, Phase 3 (excluded from max)
} as const;
export const SUBMIT_MAX = 105; // sum of non-bonus weights

const COMPOSER_ATTR_RE = /prompt|message|composer|chat\s?input|输入|提问|发送|ask|write/i;
// NOTE: no bare "up" — it false-positives on classes like "group/pill".
const SUBMIT_ATTR_RE = /send|submit|发送|deliver|prompt|arrow|↑|ask/i;

export interface ComposerContext {
  nearSubmit: boolean;
  historical: boolean;
}

export interface SubmitContext {
  nearComposer: boolean;
  /** +15 if the control's enabled state tracks composer content (behavioral) or it is explicitly content-driven (aria-disabled present). */
  conditionalEnablement: boolean;
  /** +10 if a persisted rule matched this element (historical success). */
  historical?: boolean;
}

export interface ScoreResult {
  raw: number;
  normalized: number; // 0..1
  matched: string[];
}

function normalize(raw: number, max: number): number {
  return Math.min(1, Math.max(0, raw / max));
}

export function scoreComposer(p: ElementProfile, ctx: ComposerContext): ScoreResult {
  const matched: string[] = [];
  let raw = 0;

  const multiline = p.contenteditable || p.tag === 'textarea';
  if (multiline) { raw += COMPOSER_WEIGHTS.multiline; matched.push('multiline-editable'); }
  if (p.role === 'textbox') { raw += COMPOSER_WEIGHTS.roleTextbox; matched.push('role=textbox'); }
  if (p.visible) { raw += COMPOSER_WEIGHTS.visible; matched.push('visible'); }
  if (p.insideMain) { raw += COMPOSER_WEIGHTS.insideMain; matched.push('inside-main'); }
  if (p.lowerViewport) { raw += COMPOSER_WEIGHTS.lowerViewport; matched.push('lower-viewport'); }
  if (ctx.nearSubmit) { raw += COMPOSER_WEIGHTS.nearSubmit; matched.push('near-submit'); }
  if (ctx.historical) { raw += COMPOSER_WEIGHTS.historicalSuccess; matched.push('historical'); }

  const attrs = [p.id, p.placeholder ?? '', p.ariaLabel ?? '', p.classes.join(' ')].join(' ').trim();
  if (attrs && COMPOSER_ATTR_RE.test(attrs)) { raw += COMPOSER_WEIGHTS.knownSemanticAttrs; matched.push('semantic-attrs'); }

  return { raw, normalized: normalize(raw, COMPOSER_MAX), matched };
}

export function scoreSubmit(p: ElementProfile, ctx: SubmitContext): ScoreResult {
  const matched: string[] = [];
  let raw = 0;

  if (p.isButtonLike) { raw += SUBMIT_WEIGHTS.buttonLike; matched.push('button-like'); }
  if (ctx.nearComposer) { raw += SUBMIT_WEIGHTS.nearComposer; matched.push('near-composer'); }
  if (ctx.conditionalEnablement) { raw += SUBMIT_WEIGHTS.conditionalEnablement; matched.push('conditional-enablement'); }
  if (p.visible) { raw += SUBMIT_WEIGHTS.visible; matched.push('visible'); }
  if (p.insideMain) { raw += SUBMIT_WEIGHTS.insideMain; matched.push('inside-main'); }
  if (p.rect && p.rect.width >= 40 && p.rect.width <= 800 && p.rect.height >= 24 && p.rect.height <= 160) {
    raw += SUBMIT_WEIGHTS.reasonableGeometry; matched.push('reasonable-geometry');
  }
  if (ctx.historical) { raw += SUBMIT_WEIGHTS.historicalSuccess; matched.push('historical'); }
  const attrs = [p.id, p.ariaLabel ?? '', p.dataTestId ?? '', p.classes.join(' ')].join(' ').trim();
  if (attrs && SUBMIT_ATTR_RE.test(attrs)) { raw += SUBMIT_WEIGHTS.knownSemanticAttrs; matched.push('semantic-attrs'); }

  return { raw, normalized: normalize(raw, SUBMIT_MAX), matched };
}
