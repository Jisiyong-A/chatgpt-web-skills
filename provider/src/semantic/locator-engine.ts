/**
 * Semantic Locator Engine (spec §7, §8, §10, §33).
 *
 * Deterministic normal path: hints (never the ONLY strategy) → ARIA roles →
 * DOM/geometry scan. Multi-signal scoring; nothing is ever clicked below the
 * safe threshold. Ambiguity yields UI_UNKNOWN, never a guess.
 */

import type { Locator, Page } from 'playwright';
import {
  AMBIGUITY_MARGIN,
  RECOVERY_THRESHOLD,
  SAFE_THRESHOLD,
  scoreComposer,
  scoreSubmit,
  type ElementProfile,
  type Rect,
} from './candidate-scoring.js';
import { composerText, typeIntoComposer } from '../chatgpt/composer.js';
import type { RuleRegistry } from '../healing/registry.js';

export type { ElementProfile };

export interface CandidateView {
  locator: Locator;
  score: number;
  matched: string[];
  ruleId?: string;
  profile: { tag: string; contenteditable: boolean; role: string | null; placeholder: string | null; ariaLabel: string | null; testid: string | null };
}

export function isStopButton(p: ElementProfile): boolean {
  if (p.dataTestId === 'stop-button') return true;
  const aria = p.ariaLabel?.toLowerCase() ?? '';
  const cls = (p.classes ?? []).join(' ').toLowerCase();
  const text = p.text?.toLowerCase() ?? '';
  return (
    aria.includes('stop') ||
    aria.includes('停止') ||
    text === 'stop' ||
    cls.includes('stop-button') ||
    cls.includes('generating')
  );
}

export interface LocatorResult {
  capability: 'composer' | 'submit_control';
  locator: Locator;
  index: number;
  score: number;
  matched: string[];
  /** Score was in the recovery band (0.75–0.90): validation required before use. */
  needsValidation: boolean;
  /** Persisted rule that matched this element (for success/failure bookkeeping). */
  ruleId?: string;
  /** Simplified semantic profile of the matched element (for rule learning). */
  profile: { tag: string; contenteditable: boolean; role: string | null; placeholder: string | null; ariaLabel: string | null; testid: string | null };
}

interface RankedCandidate {
  locator: Locator;
  profile: ElementProfile;
  score: number;
  matched: string[];
  ruleId?: string;
}

export interface EngineConfig {
  /** Hint selectors per capability. Hints are used first but never alone. */
  hints: Record<string, string[]>;
  safeThreshold?: number;
  recoveryThreshold?: number;
  /** Optional rule registry: persisted rules add the historical-success signal. */
  registry?: RuleRegistry;
}

const COMPOSER_FALLBACK_SELECTORS = [
  '[contenteditable="true"]',
  'div[contenteditable]',
  'textarea',
  'input[type="text"]',
  'input[type="search"]',
  '[role="textbox"]',
];

const SUBMIT_FALLBACK_SELECTORS = ['button', '[role="button"]', 'input[type="submit"]'];

// Real ChatGPT pages carry 80+ buttons; a low cap silently drops the send
// button (it lives late in DOM order, inside the composer form).
const MAX_SEARCH_ELEMENTS = 500;

interface CollectedElement {
  profile: ElementProfile;
}

function dedupeKey(p: ElementProfile): string {
  const r = p.rect;
  return [p.tag, p.id, p.classes.join('.'), r ? `${r.x}|${r.y}|${r.width}|${r.height}` : 'norect'].join('#');
}

/** Browser-side profile extractor. Runs inside the page. */
function profileExtractor(): (el: Element) => ElementProfile {
  return (el: Element) => {
    const n = el as HTMLElement;
    const r = n.getBoundingClientRect();
    const cs = window.getComputedStyle(n);
    // fixed/sticky elements have offsetParent === null but ARE visible.
    const pos = cs.position;
    const visible =
      r.width > 0 &&
      r.height > 0 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      (n.offsetParent !== null || n === document.body || pos === 'fixed' || pos === 'sticky') &&
      Number.parseFloat(cs.opacity || '1') > 0;
    const main = n.closest('main, [role="main"], [data-testid="conversation-turn"], section');
    const tag = n.tagName.toLowerCase();
    const isButtonLike =
      tag === 'button' ||
      n.getAttribute('role') === 'button' ||
      (tag === 'input' && (n.getAttribute('type') ?? 'text') === 'submit');
    // Near-submit signal: any button-like control within a reasonable distance
    // (spec §7). Geometry is one signal among many — never trusted alone.
    // dx is generous (full-width composers push the send button far right).
    let nearSubmit = false;
    if (r.width > 0) {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
      for (const b of buttons) {
        if (b === n) continue;
        const br = (b as HTMLElement).getBoundingClientRect();
        if (br.width === 0 || br.height === 0) continue;
        const dx = Math.abs(r.x + r.width / 2 - (br.x + br.width / 2));
        const dy = Math.abs(br.top - r.bottom);
        if (dx <= 900 && dy <= 350) {
          nearSubmit = true;
          break;
        }
      }
    }
    return {
      tag,
      role: n.getAttribute('role'),
      contenteditable: n.isContentEditable,
      placeholder: n.getAttribute('placeholder') ?? n.getAttribute('data-placeholder'),
      ariaLabel: n.getAttribute('aria-label') ?? n.getAttribute('title'),
      id: n.id || '',
      classes: Array.from(n.classList),
      visible,
      rect: r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom } : null,
      insideMain: !!main,
      lowerViewport: r.height > 0 ? r.top > window.innerHeight * 0.45 : false,
      nearSubmit,
      text: (n.textContent ?? '').trim().slice(0, 200),
      dataTestId: n.getAttribute('data-testid'),
      disabled: n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true',
      hasAriaDisabled: n.hasAttribute('aria-disabled'),
      isButtonLike,
    };
  };
}

export class LocatorEngine {
  private readonly hints: Record<string, string[]>;
  private readonly safeThreshold: number;
  private readonly recoveryThreshold: number;
  private readonly registry: RuleRegistry | null;

  constructor(config: EngineConfig) {
    this.hints = config.hints;
    this.safeThreshold = config.safeThreshold ?? SAFE_THRESHOLD;
    this.recoveryThreshold = config.recoveryThreshold ?? RECOVERY_THRESHOLD;
    this.registry = config.registry ?? null;
  }

  /**
   * Parse active persisted rules into partial matchers: only fields the rule
   * specifies must match (learned rules are deliberately partial).
   */
  private async ruleMatchers(
    capability: 'composer' | 'submit_control',
  ): Promise<Array<{ ruleId: string; profile: { tag?: string | null; contenteditable?: boolean; role?: string | null; placeholder?: string | null; ariaLabel?: string | null; testid?: string | null } }>> {
    const out: Array<{ ruleId: string; profile: { tag?: string | null; contenteditable?: boolean; role?: string | null; placeholder?: string | null; ariaLabel?: string | null; testid?: string | null } }> = [];
    if (!this.registry) return out;
    for (const rec of this.registry.listActive(capability)) {
      try {
        const rule = JSON.parse(rec.rule_json) as { profile?: { tag?: string | null; contenteditable?: boolean; role?: string | null; placeholder?: string | null; ariaLabel?: string | null; testid?: string | null } };
        const p = rule.profile;
        if (!p) continue;
        const hasConstraint =
          p.tag !== undefined || p.contenteditable !== undefined || p.role !== undefined ||
          p.placeholder !== undefined || p.ariaLabel !== undefined || p.testid !== undefined;
        if (!hasConstraint) continue; // empty profiles would match everything
        out.push({ ruleId: rec.rule_id, profile: p });
      } catch {
        // malformed rule — ignore, never crash the locator path
      }
    }
    return out;
  }

  private static matchRule(
    profile: ElementProfile,
    m: { profile: { tag?: string | null; contenteditable?: boolean; role?: string | null; placeholder?: string | null; ariaLabel?: string | null; testid?: string | null } },
  ): boolean {
    const p = m.profile;
    if (p.tag !== undefined && p.tag !== null && p.tag !== profile.tag) return false;
    if (p.contenteditable !== undefined && p.contenteditable !== profile.contenteditable) return false;
    if (p.role !== undefined && p.role !== null && p.role !== profile.role) return false;
    if (p.placeholder !== undefined && p.placeholder !== null && p.placeholder !== profile.placeholder) return false;
    if (p.ariaLabel !== undefined && p.ariaLabel !== null && p.ariaLabel !== profile.ariaLabel) return false;
    if (p.testid !== undefined && p.testid !== null && p.testid !== profile.dataTestId) return false;
    return true;
  }

  private async collect(
    page: Page,
    selectors: string[],
  ): Promise<{ locators: Locator[]; profiles: ElementProfile[] }> {
    const unique = Array.from(new Set(selectors.filter((s) => s && s.trim())));
    if (unique.length === 0) return { locators: [], profiles: [] };
    const loc = page.locator(unique.join(', '));
    const count = Math.min(await loc.count(), MAX_SEARCH_ELEMENTS);
    const locators: Locator[] = [];
    const profiles: ElementProfile[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      const profile = (await el.evaluate(profileExtractor()).catch(() => null)) as ElementProfile | null;
      if (!profile) continue;
      const key = dedupeKey(profile);
      if (seen.has(key)) continue;
      seen.add(key);
      locators.push(el);
      profiles.push(profile);
    }
    return { locators, profiles };
  }

  private toResult(capability: 'composer' | 'submit_control', c: RankedCandidate): LocatorResult {
    return {
      capability,
      locator: c.locator,
      index: 0,
      score: c.score,
      matched: c.matched,
      needsValidation: c.score < this.safeThreshold,
      ruleId: c.ruleId,
      profile: {
        tag: c.profile.tag,
        contenteditable: c.profile.contenteditable,
        role: c.profile.role,
        placeholder: c.profile.placeholder,
        ariaLabel: c.profile.ariaLabel,
        testid: c.profile.dataTestId,
      },
    };
  }

  private async pickBest(
    candidates: RankedCandidate[],
    capability: 'composer' | 'submit_control',
    opts?: { resolveAmbiguity?: (ordered: RankedCandidate[]) => Promise<RankedCandidate | null> },
  ): Promise<LocatorResult | null> {
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;
    const second = candidates[1];

    // Ambiguity: two plausible candidates close in score → never guess.
    // An optional behavioral resolver may arbitrate (e.g. submit controls).
    if (
      second &&
      second.score >= this.recoveryThreshold &&
      best.score - second.score <= AMBIGUITY_MARGIN
    ) {
      if (opts?.resolveAmbiguity) {
        const resolved = await opts.resolveAmbiguity(candidates);
        if (resolved) return this.toResult(capability, resolved);
      }
      return null; // caller reports UI_UNKNOWN (ambiguous)
    }
    if (best.score < this.recoveryThreshold) return null;
    return this.toResult(capability, best);
  }

  /**
   * Behavioral arbitration for ambiguous submit candidates (spec §8, §13):
   * a real send control is disabled when the composer is empty and enabled
   * when it holds text. Non-destructive: composer content is restored.
   */
  private ambiguityResolver(
    page: Page,
    composerLocator: Locator | null,
  ): (ordered: RankedCandidate[]) => Promise<RankedCandidate | null> {
    return async (ordered: RankedCandidate[]) => {
      if (!composerLocator) return null;
      for (const cand of ordered.slice(0, 2)) {
        if (await this.behaviorValidateSubmit(page, cand.locator, composerLocator)) {
          return cand;
        }
      }
      return null;
    };
  }

  private async behaviorValidateSubmit(
    page: Page,
    submitLocator: Locator,
    composerLocator: Locator,
  ): Promise<boolean> {
    try {
      // Record stable identity BEFORE any mutation (dynamic nth locators
      // drift as the DOM changes, so we re-query by attribute afterwards).
      const identity = await submitLocator
        .evaluate((el) => {
          const n = el as HTMLElement;
          return {
            testid: n.getAttribute('data-testid'),
            aria: n.getAttribute('aria-label'),
          };
        })
        .catch(() => ({ testid: null as string | null, aria: null as string | null }));
      const byIdentity = (): Locator | null => {
        const esc = (s: string) => s.replace(/["\\]/g, '\\$&');
        if (identity.testid) return page.locator(`[data-testid="${esc(identity.testid)}"]`);
        if (identity.aria) return page.locator(`[aria-label="${esc(identity.aria)}"]`);
        return null;
      };

      const textBefore = await composerText(composerLocator);
      // The probe needs content: verify "enabled with text" requires text.
      if (textBefore.trim() === '') {
        await typeIntoComposer(page, composerLocator, '__adapter_probe__').catch(() => undefined);
        await page.waitForTimeout(200);
      }
      const probeLoc = byIdentity() ?? submitLocator;
      const disabledWithText = await probeLoc
        .evaluate((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
        .catch(() => false);
      // Real keyboard events: ProseMirror/React ignore synthetic input events.
      await composerLocator.click().catch(() => undefined);
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      const clearDeadline = Date.now() + 1500;
      while (Date.now() < clearDeadline) {
        const t = await composerText(composerLocator).catch(() => 'x');
        if (t.trim() === '') break;
        await page.waitForTimeout(100);
      }
      // Give React a moment to unmount the content-driven control.
      await page.waitForTimeout(500);
      const emptyLoc = byIdentity() ?? submitLocator;
      // NOTE: on the live page the send button is REMOVED from the DOM when
      // the composer is empty — disappearance counts as "disabled when empty".
      const deadline = Date.now() + 1200;
      let disabledWhenEmpty = false;
      while (Date.now() < deadline) {
        const existsWhenEmpty = (await emptyLoc.count().catch(() => 0)) > 0;
        if (!existsWhenEmpty) {
          disabledWhenEmpty = true; // removed → content-driven
          break;
        }
        disabledWhenEmpty = await emptyLoc
          .evaluate((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
          .catch(() => false);
        if (disabledWhenEmpty) break;
        await page.waitForTimeout(120);
      }
      // Restore: original text if there was any, otherwise leave empty.
      if (textBefore.trim() !== '') {
        await typeIntoComposer(page, composerLocator, textBefore).catch(() => undefined);
      }
      return !disabledWithText && disabledWhenEmpty;
    } catch {
      return false;
    }
  }

  /**
   * Find the message composer. Deterministic hints first, then semantic
   * fallbacks (ARIA role + DOM/geometry). Returns null when nothing is safe.
   */
  async findComposer(page: Page): Promise<LocatorResult | null> {
    const selectors = [...(this.hints.composer ?? []), ...COMPOSER_FALLBACK_SELECTORS];
    const { locators, profiles } = await this.collect(page, selectors);
    if (locators.length === 0) return null;

    const ruleSigs = await this.ruleMatchers('composer');
    const candidates: RankedCandidate[] = profiles
      .map((profile, i) => {
        const ruleId = ruleSigs.find((m) => LocatorEngine.matchRule(profile, m))?.ruleId;
        const r = scoreComposer(profile, {
          nearSubmit: profile.nearSubmit,
          historical: !!ruleId,
        });
        return { locator: locators[i]!, profile, score: r.normalized, matched: r.matched, ruleId };
      })
      .filter((c) => c.profile.visible);
    return this.pickBest(candidates, 'composer');
  }

  /**
   * All visible composer candidates, best first — no threshold filtering.
   * Used by the self-healing recovery pipeline (Phase 4).
   */
  async findComposerCandidates(page: Page): Promise<CandidateView[]> {
    const selectors = [...(this.hints.composer ?? []), ...COMPOSER_FALLBACK_SELECTORS];
    const { locators, profiles } = await this.collect(page, selectors);
    const ruleSigs = await this.ruleMatchers('composer');
    const ranked: RankedCandidate[] = profiles
      .map((profile, i) => {
        const ruleId = ruleSigs.find((m) => LocatorEngine.matchRule(profile, m))?.ruleId;
        const r = scoreComposer(profile, { nearSubmit: profile.nearSubmit, historical: !!ruleId });
        return { locator: locators[i]!, profile, score: r.normalized, matched: r.matched, ruleId };
      })
      .filter((c) => c.profile.visible);
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((c) => ({
      locator: c.locator,
      score: c.score,
      matched: c.matched,
      ruleId: c.ruleId,
      profile: {
        tag: c.profile.tag,
        contenteditable: c.profile.contenteditable,
        role: c.profile.role,
        placeholder: c.profile.placeholder,
        ariaLabel: c.profile.ariaLabel,
        testid: c.profile.dataTestId,
      },
    }));
  }

  /**
   * All visible submit candidates (full-page scan), best first — no
   * threshold filtering. Used by the self-healing recovery pipeline.
   */
  async findSubmitCandidates(
    page: Page,
    composerResult: LocatorResult | null,
    opts: { composerEmpty?: boolean } = {},
  ): Promise<CandidateView[]> {
    const selectors = [...(this.hints.submit ?? []), ...SUBMIT_FALLBACK_SELECTORS];
    const { locators, profiles } = await this.collect(page, selectors);
    let composerRect: Rect | null = null;
    if (composerResult) {
      composerRect = (await composerResult.locator.evaluate(profileExtractor()).catch(() => null))?.rect ?? null;
    }
    const ruleSigs = await this.ruleMatchers('submit_control');
    const ranked: RankedCandidate[] = [];
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i]!;
      if (!profile.visible) continue;
      // Never treat the stop/cancel control as a submit candidate (§8).
      if (isStopButton(profile)) continue;
      let nearComposer = false;
      if (composerRect && profile.rect) {
        const cCenterX = composerRect.x + composerRect.width / 2;
        const sCenterX = profile.rect.x + profile.rect.width / 2;
        nearComposer = Math.abs(cCenterX - sCenterX) <= 900 && Math.abs(profile.rect.top - composerRect.bottom) <= 350;
      }
      const conditionalEnablement = composerRect
        ? opts.composerEmpty === profile.disabled || profile.hasAriaDisabled
        : false;
      const ruleId = ruleSigs.find((m) => LocatorEngine.matchRule(profile, m))?.ruleId;
      const r = scoreSubmit(profile, { nearComposer, conditionalEnablement, historical: !!ruleId });
      ranked.push({ locator: locators[i]!, profile, score: r.normalized, matched: r.matched, ruleId });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((c) => ({
      locator: c.locator,
      score: c.score,
      matched: c.matched,
      ruleId: c.ruleId,
      profile: {
        tag: c.profile.tag,
        contenteditable: c.profile.contenteditable,
        role: c.profile.role,
        placeholder: c.profile.placeholder,
        ariaLabel: c.profile.ariaLabel,
        testid: c.profile.dataTestId,
      },
    }));
  }

  /** Public wrapper of the non-destructive behavioral submit validation. */
  async validateSubmitCandidate(
    page: Page,
    submitLocator: Locator,
    composerLocator: Locator,
  ): Promise<boolean> {
    return this.behaviorValidateSubmit(page, submitLocator, composerLocator);
  }

  /**
   * Find the submit control near a composer. Semantic + behavioral signals:
   * button-like, near composer, visible, reasonable geometry, conditional
   * enablement. Two stages: composer-container fast path first, then a full
   * page scan (cap raised for real pages with 80+ buttons).
   */
  async findSubmit(
    page: Page,
    composerResult: LocatorResult | null,
    opts: { composerEmpty?: boolean; composerCenterY?: number },
  ): Promise<LocatorResult | null> {
    let composerRect: Rect | null = null;
    if (composerResult) {
      composerRect = (await composerResult.locator.evaluate(profileExtractor()).catch(() => null))?.rect ?? null;
    }

    const stageCandidates = async (selectors: string[], forceNear: boolean) => {
      const { locators, profiles } = await this.collect(page, selectors);
      if (locators.length === 0) return [];
      const ruleSigs = await this.ruleMatchers('submit_control');
      const out: RankedCandidate[] = [];
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i]!;
        if (!profile.visible) continue;
        // Never treat the stop/cancel control as a submit candidate (§8).
        if (isStopButton(profile)) continue;
        let nearComposer = forceNear;
        if (!forceNear && composerRect && profile.rect) {
          const cCenterX = composerRect.x + composerRect.width / 2;
          const sCenterX = profile.rect.x + profile.rect.width / 2;
          const dx = Math.abs(cCenterX - sCenterX);
          const dy = Math.abs(profile.rect.top - composerRect.bottom);
          nearComposer = dx <= 900 && dy <= 350;
        }
        const conditionalEnablement = composerRect
          ? opts.composerEmpty === profile.disabled || profile.hasAriaDisabled
          : false;
        const ruleId = ruleSigs.find((m) => LocatorEngine.matchRule(profile, m))?.ruleId;
        const r = scoreSubmit(profile, { nearComposer, conditionalEnablement, historical: !!ruleId });
        out.push({ locator: locators[i]!, profile, score: r.normalized, matched: r.matched, ruleId });
      }
      return out;
    };

    // Stage 1: composer container fast path (few elements, high signal).
    const inForm = await composerResult?.locator
      .evaluate((el) => !!(el as HTMLElement).closest('form'))
      .catch(() => false);
    const stage1Selectors: string[] = [];
    if (inForm) stage1Selectors.push('form button', 'form [role="button"]');
    stage1Selectors.push(...(this.hints.submit ?? []));
    const stage1 = await stageCandidates(stage1Selectors, true);
    const resolver = this.ambiguityResolver(page, composerResult?.locator ?? null);
    const best1 = await this.pickBest(stage1, 'submit_control', { resolveAmbiguity: resolver });
    if (best1 && !best1.needsValidation) return best1;

    // Stage 2: full-page scan.
    const stage2Selectors = [...(this.hints.submit ?? []), ...SUBMIT_FALLBACK_SELECTORS];
    const stage2 = await stageCandidates(stage2Selectors, false);
    const best2 = await this.pickBest(stage2, 'submit_control', { resolveAmbiguity: resolver });
    if (!best1) return best2;
    if (!best2) return best1;
    // Prefer whichever candidate is higher confidence.
    return best2.score >= best1.score ? best2 : best1;
  }
}
