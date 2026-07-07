import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkMarkdown,
  CHUNK_VERSION,
} from '../src/lib/interview-chunking.ts';

describe('chunkMarkdown — Q&A pair mode', () => {
  const qaDoc = [
    'Q: 광고를 접한 경험이 있나요?',
    'A: 네. TV에서 자주 봤어요. 특히 저녁 시간대에요.',
    '',
    'Q: 그 광고가 기억에 남는 이유는?',
    'A: 아니요. 딱히 없어요.',
    '',
    'Q: 마지막으로 하고 싶은 말은?',
    '응답자: 없습니다.',
  ].join('\n');

  it('pairs each question with its answer in ONE chunk', () => {
    const chunks = chunkMarkdown(qaDoc, { filename: 'iv.md' });
    // three questions → three pair chunks
    const pairs = chunks.filter((c) => c.metadata.is_qa_pair);
    assert.equal(pairs.length, 3);
    // first chunk holds both the question and the answer
    assert.match(pairs[0].content, /광고를 접한 경험/);
    assert.match(pairs[0].content, /TV에서 자주 봤어요/);
    assert.equal(pairs[0].metadata.question, '광고를 접한 경험이 있나요?');
  });

  it('does not drop short answers ("아니요"/"없습니다") — absorbed into the pair', () => {
    const chunks = chunkMarkdown(qaDoc, { filename: 'iv.md' });
    const joined = chunks.map((c) => c.content).join('\n');
    assert.match(joined, /아니요/);
    assert.match(joined, /없습니다/);
  });

  it('records respondent_role and chunk_version in metadata', () => {
    const chunks = chunkMarkdown(qaDoc, { filename: 'iv.md', docId: 'doc-1' });
    const pairs = chunks.filter((c) => c.metadata.is_qa_pair);
    assert.equal(pairs[0].metadata.respondent_role, 'A');
    assert.equal(pairs[2].metadata.respondent_role, '응답자');
    assert.equal(pairs[0].metadata.chunk_version, CHUNK_VERSION);
    assert.equal(pairs[0].metadata.doc_id, 'doc-1');
    assert.equal(pairs[0].metadata.is_quote, true);
  });

  it('detects question-style headings as pair boundaries', () => {
    const doc = [
      '## Q1. 첫 인상은?',
      '좋았습니다. 깔끔했어요.',
      '',
      '## Q2. 개선점은?',
      '가격이 비쌉니다.',
    ].join('\n');
    const chunks = chunkMarkdown(doc, { filename: 'h.md' });
    const pairs = chunks.filter((c) => c.metadata.is_qa_pair);
    assert.equal(pairs.length, 2);
    assert.match(pairs[0].content, /첫 인상은/);
    assert.match(pairs[0].content, /좋았습니다/);
  });
});

describe('chunkMarkdown — contextual split of long answers', () => {
  it('prepends the question to every sub-chunk when the answer is long', () => {
    const longAnswer = Array.from(
      { length: 20 },
      (_, i) => `이것은 답변의 ${i + 1}번째 문단입니다. `.repeat(20),
    ).join('\n\n');
    const doc = [
      'Q: 프로젝트 전반에 대해 자세히 설명해 주세요.',
      `A: ${longAnswer}`,
      '',
      'Q: 요약하면?',
      'A: 좋았습니다.',
    ].join('\n');

    const chunks = chunkMarkdown(doc, { filename: 'long.md' });
    const longPairChunks = chunks.filter(
      (c) => c.metadata.is_qa_pair && /자세히 설명/.test(c.metadata.question ?? ''),
    );
    // the long answer must have been split into multiple sub-chunks
    assert.ok(longPairChunks.length > 1, 'expected the long answer to split');
    // every sub-chunk carries the question prefix → self-contained
    for (const c of longPairChunks) {
      assert.match(c.content, /프로젝트 전반에 대해 자세히 설명/);
    }
  });

  it('never emits a chunk over the embedding-safe token budget', () => {
    const longAnswer = '가나다라마바사아자차카타파하 '.repeat(2000);
    const doc = ['Q: 설명?', `A: ${longAnswer}`, '', 'Q: 또?', 'A: 네.'].join(
      '\n',
    );
    const chunks = chunkMarkdown(doc, { filename: 'huge.md' });
    for (const c of chunks) {
      // MAX_CHARS is 1800; a small prefix overhead is allowed.
      assert.ok(
        c.content.length <= 1800 + 450,
        `chunk too long: ${c.content.length}`,
      );
      assert.ok(c.metadata.token_estimate < 8191);
    }
  });
});

describe('chunkMarkdown — non-Q&A documents (no regression)', () => {
  const narrative = [
    '# 배경',
    '',
    '이 전사본은 자유 서술형입니다. '.repeat(30),
    '',
    '참여자들은 다양한 의견을 냈습니다. '.repeat(30),
  ].join('\n');

  it('falls back to legacy paragraph chunking with is_qa_pair=false', () => {
    const chunks = chunkMarkdown(narrative, { filename: 'n.md' });
    assert.ok(chunks.length > 0);
    for (const c of chunks) {
      assert.equal(c.metadata.is_qa_pair, false);
      assert.equal(c.metadata.question, null);
    }
  });

  it('a lone stray answer label does not flip a narrative into pair mode', () => {
    const doc = ['자유 서술 내용입니다. '.repeat(20), '', 'A: 단발성 라벨'].join(
      '\n',
    );
    const chunks = chunkMarkdown(doc, { filename: 's.md' });
    assert.ok(chunks.every((c) => c.metadata.is_qa_pair === false));
  });

  it('empty input yields no chunks', () => {
    assert.deepEqual(chunkMarkdown('', { filename: 'e.md' }), []);
    assert.deepEqual(chunkMarkdown('   \n  ', { filename: 'e.md' }), []);
  });
});
