import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rrfMerge,
  applyCoverageFloor,
  RRF_K,
} from '../src/lib/interview-v2/retrieval.ts';
import {
  tokenizeQuery,
} from '../src/lib/interview-v2/keyword-query.ts';
import {
  parentKey,
  reconstructParent,
  type ParentSibling,
} from '../src/lib/interview-v2/parent-expand.ts';

// Minimal hit shape for the pure fusion/coverage helpers.
type H = { chunk_id: number; document_id: string; score: number };
const hit = (id: number, doc: string, score = 0): H => ({
  chunk_id: id,
  document_id: doc,
  score,
});

describe('rrfMerge', () => {
  it('fuses two ranked lists and rewards agreement', () => {
    // chunk 1 is #1 in vector and #1 in keyword → should top the fused list.
    const vector = [hit(1, 'a'), hit(2, 'a'), hit(3, 'b')];
    const keyword = [hit(1, 'a'), hit(4, 'c'), hit(2, 'a')];
    const merged = rrfMerge([vector, keyword]);
    assert.equal(merged[0].chunk_id, 1);
    // every unique chunk id survives (union, deduped)
    assert.deepEqual(
      new Set(merged.map((m) => m.chunk_id)),
      new Set([1, 2, 3, 4]),
    );
    assert.equal(merged.length, 4);
  });

  it('keeps the first-list copy for a shared chunk id (vector identity wins)', () => {
    const vector = [hit(7, 'a', 0.31)];
    const keyword = [hit(7, 'a', 0.5)]; // keyword "score" is a term ratio
    const merged = rrfMerge([vector, keyword]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].score, 0.31); // vector copy retained
  });

  it('a chunk found by both outranks one found by a single list at rank 0', () => {
    const vector = [hit(1, 'a'), hit(9, 'z')];
    const keyword = [hit(1, 'a')];
    const merged = rrfMerge([vector, keyword]);
    // 1: 1/(k+1) + 1/(k+1); 9: 1/(k+2). Agreement wins.
    assert.equal(merged[0].chunk_id, 1);
    const s1 = 2 / (RRF_K + 1);
    const s9 = 1 / (RRF_K + 2);
    assert.ok(s1 > s9);
  });

  it('breaks ties by chunk_id ascending', () => {
    const a = [hit(5, 'a')];
    const b = [hit(2, 'b')];
    // both at rank 0 in their own single-element list → equal score
    const merged = rrfMerge([a, b]);
    assert.deepEqual(merged.map((m) => m.chunk_id), [2, 5]);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(rrfMerge([]), []);
    assert.deepEqual(rrfMerge([[], []]), []);
  });
});

describe('applyCoverageFloor', () => {
  it('guarantees at least one chunk per document before hoarding', () => {
    // doc a monopolizes the top of the ranking; floor must let b and c in.
    const ranked = [
      hit(1, 'a'),
      hit(2, 'a'),
      hit(3, 'a'),
      hit(4, 'b'),
      hit(5, 'c'),
    ];
    const out = applyCoverageFloor(ranked, { topK: 3, perDocFloor: 1 });
    const docs = new Set(out.map((h) => h.document_id));
    assert.deepEqual(docs, new Set(['a', 'b', 'c']));
    assert.equal(out.length, 3);
  });

  it('respects perDocCap', () => {
    const ranked = [
      hit(1, 'a'),
      hit(2, 'a'),
      hit(3, 'a'),
      hit(4, 'b'),
    ];
    const out = applyCoverageFloor(ranked, {
      topK: 4,
      perDocFloor: 1,
      perDocCap: 2,
    });
    const fromA = out.filter((h) => h.document_id === 'a');
    assert.equal(fromA.length, 2); // capped at 2 despite 3 candidates
  });

  it('preserves global rank order in the output', () => {
    const ranked = [hit(1, 'a'), hit(2, 'b'), hit(3, 'a'), hit(4, 'c')];
    const out = applyCoverageFloor(ranked, { topK: 4, perDocFloor: 1 });
    const ids = out.map((h) => h.chunk_id);
    // output ids appear in the same relative order as the input ranking
    const asInput = [...ids].sort(
      (x, y) => ranked.findIndex((h) => h.chunk_id === x) - ranked.findIndex((h) => h.chunk_id === y),
    );
    assert.deepEqual(ids, asInput);
  });

  it('single doc just returns the top-K of that doc', () => {
    const ranked = [hit(1, 'a'), hit(2, 'a'), hit(3, 'a')];
    const out = applyCoverageFloor(ranked, { topK: 2, perDocFloor: 1 });
    assert.deepEqual(out.map((h) => h.chunk_id), [1, 2]);
  });

  it('never emits a duplicate chunk', () => {
    const ranked = [hit(1, 'a'), hit(1, 'a'), hit(2, 'b')];
    const out = applyCoverageFloor(ranked, { topK: 5, perDocFloor: 1 });
    assert.equal(new Set(out.map((h) => h.chunk_id)).size, out.length);
  });
});

describe('tokenizeQuery', () => {
  it('keeps alphanumeric tokens glued (SPF50, FSA)', () => {
    const terms = tokenizeQuery('SPF50 자외선 차단제 FSA 로 결제');
    assert.ok(terms.includes('spf50'));
    assert.ok(terms.includes('fsa'));
    assert.ok(terms.includes('자외선'));
  });

  it('drops single-character noise and dedupes', () => {
    const terms = tokenizeQuery('아 그 광고 광고 를');
    // single chars '아' '그' '를' dropped, '광고' deduped to one
    assert.deepEqual(terms, ['광고']);
  });

  it('returns [] for punctuation-only input', () => {
    assert.deepEqual(tokenizeQuery('!!! ??? ...'), []);
  });

  it('caps the term count', () => {
    const many = Array.from({ length: 40 }, (_, i) => `term${i}`).join(' ');
    assert.ok(tokenizeQuery(many).length <= 16);
  });
});

describe('parentKey', () => {
  it('groups Q&A sub-chunks by document + char_start', () => {
    const meta = { is_qa_pair: true, char_start: 120, question: 'Q?' };
    assert.equal(parentKey('doc1', meta), 'qa:doc1:120');
    // same pair start ⇒ same key
    assert.equal(
      parentKey('doc1', { ...meta, question: 'Q?' }),
      parentKey('doc1', { ...meta, paragraph_index: 3 }),
    );
  });

  it('returns null for non-Q&A chunks (own parent)', () => {
    assert.equal(parentKey('doc1', { is_qa_pair: false, char_start: 5 }), null);
    assert.equal(parentKey('doc1', null), null);
    assert.equal(parentKey('doc1', { is_qa_pair: true }), null); // no char_start
  });
});

describe('reconstructParent', () => {
  it('round-trips a single-chunk pair unchanged', () => {
    const sib: ParentSibling = {
      chunk_id: 1,
      content: '광고 경험이 있나요?\n네, TV에서 봤어요.',
      metadata: { is_qa_pair: true, char_start: 0, question: '광고 경험이 있나요?', paragraph_index: 0 },
    };
    assert.equal(reconstructParent([sib]), sib.content);
  });

  it('merges split sub-chunks: strips repeated question, dedupes overlap', () => {
    const question = '가장 불편했던 점은 무엇인가요?';
    const a1 = '앱이 느립니다. 특히 로그인이 오래 걸려요.';
    const a2 = '오래 걸려요. 그리고 알림이 너무 많아요.'; // overlaps a1 tail
    const siblings: ParentSibling[] = [
      {
        chunk_id: 2,
        content: `${question}\n${a1}`,
        metadata: { is_qa_pair: true, char_start: 50, question, paragraph_index: 0 },
      },
      {
        chunk_id: 3,
        content: `${question}\n${a2}`,
        metadata: { is_qa_pair: true, char_start: 50, question, paragraph_index: 1 },
      },
    ];
    const parent = reconstructParent(siblings);
    // question appears exactly once
    assert.equal(parent.split(question).length - 1, 1);
    // both answer halves present
    assert.match(parent, /앱이 느립니다/);
    assert.match(parent, /알림이 너무 많아요/);
    // overlap phrase '오래 걸려요.' not duplicated back-to-back
    assert.equal(parent.split('오래 걸려요.').length - 1, 1);
  });

  it('orders siblings by paragraph_index regardless of input order', () => {
    const question = 'Q?';
    const siblings: ParentSibling[] = [
      {
        chunk_id: 9,
        content: `${question}\nsecond part unique_b`,
        metadata: { is_qa_pair: true, char_start: 0, question, paragraph_index: 1 },
      },
      {
        chunk_id: 8,
        content: `${question}\nfirst part unique_a`,
        metadata: { is_qa_pair: true, char_start: 0, question, paragraph_index: 0 },
      },
    ];
    const parent = reconstructParent(siblings);
    assert.ok(parent.indexOf('unique_a') < parent.indexOf('unique_b'));
  });
});
