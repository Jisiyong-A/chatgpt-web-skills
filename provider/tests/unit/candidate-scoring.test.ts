import { describe, expect, it } from 'vitest';
import {
  scoreComposer,
  scoreSubmit,
  SAFE_THRESHOLD,
  RECOVERY_THRESHOLD,
  type ElementProfile,
} from '../../src/semantic/candidate-scoring.js';

function baseProfile(over: Partial<ElementProfile> = {}): ElementProfile {
  return {
    tag: 'div',
    role: null,
    contenteditable: false,
    placeholder: null,
    ariaLabel: null,
    id: '',
    classes: [],
    visible: true,
    rect: { x: 0, y: 0, width: 200, height: 60, top: 700, bottom: 760 },
    insideMain: false,
    lowerViewport: false,
    nearSubmit: false,
    text: '',
    dataTestId: null,
    disabled: false,
    hasAriaDisabled: false,
    isButtonLike: false,
    ...over,
  };
}

describe('scoreComposer', () => {
  it('real ChatGPT-like composer (contenteditable, main, lower, near submit, placeholder) is SAFE', () => {
    const p = baseProfile({
      contenteditable: true,
      placeholder: 'Message ChatGPT',
      insideMain: true,
      lowerViewport: true,
    });
    const r = scoreComposer(p, { nearSubmit: true, historical: false });
    expect(r.normalized).toBeGreaterThanOrEqual(SAFE_THRESHOLD);
    expect(r.matched).toContain('multiline-editable');
    expect(r.matched).toContain('semantic-attrs');
  });

  it('textarea with placeholder in main lower region is SAFE', () => {
    const p = baseProfile({
      tag: 'textarea',
      placeholder: 'Ask anything',
      insideMain: true,
      lowerViewport: true,
    });
    const r = scoreComposer(p, { nearSubmit: true, historical: false });
    expect(r.normalized).toBeGreaterThanOrEqual(SAFE_THRESHOLD);
  });

  it('random nav element scores far below recovery', () => {
    const p = baseProfile({
      tag: 'div',
      classes: ['nav-item'],
      insideMain: false,
      lowerViewport: false,
      rect: { x: 0, y: 0, width: 300, height: 40, top: 0, bottom: 40 },
    });
    const r = scoreComposer(p, { nearSubmit: false, historical: false });
    expect(r.normalized).toBeLessThan(RECOVERY_THRESHOLD);
  });

  it('single-line email input is rejected', () => {
    const p = baseProfile({
      tag: 'input',
      placeholder: 'you@example.com',
      insideMain: true,
      lowerViewport: true,
      rect: { x: 100, y: 600, width: 320, height: 44, top: 600, bottom: 644 },
    });
    const r = scoreComposer(p, { nearSubmit: true, historical: false });
    expect(r.normalized).toBeLessThan(RECOVERY_THRESHOLD);
  });

  it('contenteditable without semantic attrs lands in recovery band (not safe, not rejected)', () => {
    const p = baseProfile({ contenteditable: true, insideMain: true, lowerViewport: true });
    const r = scoreComposer(p, { nearSubmit: true, historical: false });
    expect(r.normalized).toBeGreaterThanOrEqual(RECOVERY_THRESHOLD);
    expect(r.normalized).toBeLessThan(SAFE_THRESHOLD);
  });
});

describe('scoreSubmit', () => {
  it('ChatGPT-like send button (near composer, conditional enablement) is SAFE', () => {
    const p = baseProfile({
      tag: 'button',
      isButtonLike: true,
      dataTestId: 'send-button',
      rect: { x: 500, y: 710, width: 48, height: 48, top: 710, bottom: 758 },
      insideMain: true,
    });
    const r = scoreSubmit(p, { nearComposer: true, conditionalEnablement: true });
    expect(r.normalized).toBeGreaterThanOrEqual(SAFE_THRESHOLD);
  });

  it('icon-only button (aria-label via title) is SAFE', () => {
    const p = baseProfile({
      tag: 'button',
      isButtonLike: true,
      ariaLabel: 'Send prompt',
      rect: { x: 480, y: 700, width: 44, height: 44, top: 700, bottom: 744 },
      insideMain: true,
    });
    const r = scoreSubmit(p, { nearComposer: true, conditionalEnablement: false });
    expect(r.normalized).toBeGreaterThanOrEqual(SAFE_THRESHOLD);
  });

  it('button far from composer never reaches safe', () => {
    const p = baseProfile({
      tag: 'button',
      isButtonLike: true,
      ariaLabel: 'Close',
      rect: { x: 1200, y: 100, width: 60, height: 40, top: 100, bottom: 140 },
      insideMain: false,
    });
    const r = scoreSubmit(p, { nearComposer: false, conditionalEnablement: false });
    expect(r.normalized).toBeLessThan(SAFE_THRESHOLD);
  });

  it('link (not button-like) is rejected', () => {
    const p = baseProfile({
      tag: 'a',
      isButtonLike: false,
      text: 'Send feedback',
      rect: { x: 400, y: 800, width: 120, height: 30, top: 800, bottom: 830 },
    });
    const r = scoreSubmit(p, { nearComposer: true, conditionalEnablement: false });
    expect(r.normalized).toBeLessThan(RECOVERY_THRESHOLD);
  });
});
