import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCJKSourceLang,
  looksSilenceHallucination,
} from '../src/lib/translate-fidelity.ts';

describe('isCJKSourceLang', () => {
  it('flags ko / ja / zh as CJK sources', () => {
    assert.equal(isCJKSourceLang('ko'), true);
    assert.equal(isCJKSourceLang('ja'), true);
    assert.equal(isCJKSourceLang('zh'), true);
  });

  it('excludes en / es / th (their "Okay" is real speech)', () => {
    assert.equal(isCJKSourceLang('en'), false);
    assert.equal(isCJKSourceLang('es'), false);
    assert.equal(isCJKSourceLang('th'), false);
  });
});

describe('looksSilenceHallucination — drops Whisper silence ghosts (CJK source)', () => {
  // The exact ghost repertoire the Supabase audit surfaced (2026-07-06).
  const GHOSTS = [
    'Goodbye',
    'Hello.',
    'Okay.',
    'Sure.',
    'See.',
    'Thank you.',
    'Bye',
    'Hi',
    'Yeah',
    'Please.',
    'hmm',
    'uh',
  ];

  for (const g of GHOSTS) {
    it(`drops "${g}" in a ja source session`, () => {
      assert.equal(looksSilenceHallucination(g, 'ja'), true);
    });
  }

  it('drops the ghost regardless of trailing punctuation / whitespace', () => {
    assert.equal(looksSilenceHallucination('Okay!!', 'ko'), true);
    assert.equal(looksSilenceHallucination('  Goodbye…  ', 'zh'), true);
  });
});

describe('looksSilenceHallucination — false-positive guards', () => {
  it('gate 0: en / es / th source keeps "Okay" / "Sure" (real speech)', () => {
    assert.equal(looksSilenceHallucination('Okay.', 'en'), false);
    assert.equal(looksSilenceHallucination('Sure.', 'es'), false);
    assert.equal(looksSilenceHallucination('Thank you.', 'th'), false);
  });

  it('gate 1 (script): a fragment with ANY CJK char is real, kept', () => {
    // real ja/ko/zh utterances
    assert.equal(looksSilenceHallucination('ありがとう', 'ja'), false);
    assert.equal(looksSilenceHallucination('안녕하세요', 'ko'), false);
    assert.equal(looksSilenceHallucination('你好', 'zh'), false);
    // mixed script (loanword inside CJK speech) survives on the CJK char
    assert.equal(looksSilenceHallucination('Okay 그래', 'ko'), false);
  });

  it('gate 2 (length): a long Latin run is not the ghost pattern', () => {
    assert.equal(
      looksSilenceHallucination(
        'this is a full english sentence spoken mid meeting',
        'ja',
      ),
      false,
    );
  });

  it('gate 3 (dictionary): code-switch brand / proper nouns pass', () => {
    assert.equal(looksSilenceHallucination('Amazon', 'ja'), false);
    assert.equal(looksSilenceHallucination('Notion', 'ko'), false);
    assert.equal(looksSilenceHallucination('Figma', 'zh'), false);
  });

  it('empty / whitespace-only deltas are not hallucinations', () => {
    assert.equal(looksSilenceHallucination('', 'ja'), false);
    assert.equal(looksSilenceHallucination('   ', 'ko'), false);
  });
});
