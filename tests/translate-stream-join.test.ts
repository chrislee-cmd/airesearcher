import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseBoundaryFffd,
  isHangulFusionBoundary,
  joinDelta,
} from '../src/lib/translate-stream-join.ts';

const FFFD = '�';

describe('collapseBoundaryFffd (byte-split mojibake)', () => {
  it('collapses a `��` pair straddling the join', () => {
    const r = collapseBoundaryFffd(`있${FFFD}`, `${FFFD}아요`);
    assert.equal(r.prev, '있');
    assert.equal(r.delta, '아요');
    assert.equal(r.dropped, 2);
  });

  it('leaves a lone trailing U+FFFD intact (delta head clean)', () => {
    const r = collapseBoundaryFffd(`있${FFFD}`, '아요');
    assert.equal(r.prev, `있${FFFD}`);
    assert.equal(r.delta, '아요');
    assert.equal(r.dropped, 0);
  });

  it('leaves a lone leading U+FFFD intact (prev tail clean)', () => {
    const r = collapseBoundaryFffd('있', `${FFFD}아요`);
    assert.equal(r.dropped, 0);
  });

  it('is a no-op for clean text', () => {
    const r = collapseBoundaryFffd('있', '아요');
    assert.equal(r.dropped, 0);
    assert.equal(r.prev, '있');
    assert.equal(r.delta, '아요');
  });
});

describe('joinDelta — mojibake collapse', () => {
  it('produces zero visible U+FFFD from a byte-split pair', () => {
    const out = joinDelta(`있${FFFD}`, `${FFFD}아요`);
    assert.equal(out, '있아요');
    assert.ok(!out.includes(FFFD));
  });

  it('keeps a lone U+FFFD (single decode failure stays visible)', () => {
    const out = joinDelta(`어${FFFD}`, '게');
    assert.equal(out, `어${FFFD}게`);
  });

  it('handles prev that is only U+FFFD followed by a clean delta', () => {
    assert.equal(joinDelta(FFFD, `${FFFD}게`), '게');
  });
});

describe('joinDelta — whitespace + boundary preservation (no regression)', () => {
  it('preserves an inter-word space the delta carries (Korean)', () => {
    assert.equal(joinDelta('소재들을', ' 분석하고'), '소재들을 분석하고');
  });

  it('does NOT invent a space between two Hangul tokens (unrecoverable)', () => {
    // The stream-time join can't know a space belongs here; the
    // post-process LLM owns this. Documented expectation, not desired UX.
    assert.equal(joinDelta('소재들을', '분석하고'), '소재들을분석하고');
  });

  it('still patches a Latin lowercase→Uppercase fusion', () => {
    assert.equal(joinDelta('service', 'We'), 'service We');
  });

  it('still patches punctuation→letter', () => {
    assert.equal(joinDelta('person,', 'Yes'), 'person, Yes');
  });

  it('joins a split single word with no space', () => {
    assert.equal(joinDelta('trans', 'lation'), 'translation');
  });
});

describe('isHangulFusionBoundary (diagnostic predicate)', () => {
  it('is true when two Hangul tokens meet with no space', () => {
    assert.equal(isHangulFusionBoundary('소재들을', '분석하고'), true);
  });

  it('is false when the delta leads with a space', () => {
    assert.equal(isHangulFusionBoundary('소재들을', ' 분석하고'), false);
  });

  it('is false at a Latin boundary', () => {
    assert.equal(isHangulFusionBoundary('service', 'We'), false);
  });

  it('is false for empty sides', () => {
    assert.equal(isHangulFusionBoundary('', '분석'), false);
    assert.equal(isHangulFusionBoundary('소재', ''), false);
  });
});
