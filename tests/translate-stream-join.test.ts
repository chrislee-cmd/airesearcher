import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseBoundaryFffd,
  isHangulFusionBoundary,
  joinDelta,
  reSpaceKoreanLine,
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

describe('joinDelta — Korean polite-ending sentence boundary', () => {
  it('splits a 요-ending running into a new clause ("잡티예요" + "이제")', () => {
    // The user-reported headline case. 이제 opens with 이 (also the subject
    // particle) but nothing attaches to a polite verb ending, so it splits.
    assert.equal(joinDelta('잡티예요', '이제'), '잡티예요 이제');
  });

  it('splits a 요-ending into a connective adverb ("됐거든요" + "게다가")', () => {
    assert.equal(joinDelta('됐거든요', '게다가'), '됐거든요 게다가');
  });

  it('splits a 죠-ending into a new clause', () => {
    assert.equal(joinDelta('그렇죠', '그런데'), '그렇죠 그런데');
  });

  it('does NOT shatter a word where 요 is noun-internal but the tail is an ending syllable ("하네" + "요")', () => {
    // 하네|요 must stay 하네요 — the head 요 is itself an ending syllable,
    // signalling a mid-word split rather than a fresh sentence.
    assert.equal(joinDelta('하네', '요'), '하네요');
  });

  it('does NOT space a 요-ending before a grammatical-particle head', () => {
    // Defensive: even after 요 we suppress a leading particle syllable.
    assert.equal(joinDelta('해요', '는'), '해요는');
  });

  it('leaves 다/네/까 endings to Layer D (not a stream-time trigger)', () => {
    // 한다|는 (connective) and 기다|리고 (mid-word) would false-split if 다
    // triggered, so 다 is intentionally excluded here.
    assert.equal(joinDelta('한다', '는'), '한다는');
    assert.equal(joinDelta('기다', '리고'), '기다리고');
  });

  it('preserves the general two-noun Hangul fusion behavior (unchanged)', () => {
    // 을 is not a polite ending, so the pre-existing "unrecoverable"
    // contract still holds — no invented space.
    assert.equal(joinDelta('소재들을', '분석하고'), '소재들을분석하고');
  });
});

describe('reSpaceKoreanLine (post-hoc committed-line re-split)', () => {
  it('splits an intra-line fusion joinDelta never saw ("잡티예요이제")', () => {
    assert.equal(reSpaceKoreanLine('잡티예요이제 서른셋이'), '잡티예요 이제 서른셋이');
  });

  it('splits multiple seams in one line', () => {
    assert.equal(
      reSpaceKoreanLine('됐거든요게다가 고르죠그런데'),
      '됐거든요 게다가 고르죠 그런데',
    );
  });

  it('is idempotent — an already-spaced line is unchanged', () => {
    const spaced = '잡티예요 이제 서른셋이';
    assert.equal(reSpaceKoreanLine(spaced), spaced);
  });

  it('does not touch 요 followed by an ending syllable ("하네요")', () => {
    assert.equal(reSpaceKoreanLine('하네요'), '하네요');
  });

  it('leaves non-Korean text untouched', () => {
    assert.equal(reSpaceKoreanLine('main hub the key tool'), 'main hub the key tool');
    assert.equal(reSpaceKoreanLine(''), '');
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
