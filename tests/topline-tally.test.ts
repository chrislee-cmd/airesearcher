// ─────────────────────────────────────────────────────────────────────────
// 탑라인 결정적 집계(tally) 레이어 테스트 (카드 603)
//
// tally 는 수치의 SSOT 다 — reduce(Opus)가 이 표를 그대로 인용하므로, 카운트가
// 재현 가능(순수 함수)하고 methodology 규칙(분모 N·비보조/보조·단일/복수·소그룹
// n<12)을 정확히 지키는지 이 테스트가 불변식으로 강제한다.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToplineTally,
  formatTallyForReduce,
  normLabel,
  ageBucket,
  SMALL_GROUP_N,
} from '../src/lib/interview-v2/topline-tally.ts';
import type {
  DocExtractWithMeta,
  RespondentAttributes,
  CodedAnswer,
} from '../src/lib/interview-v2/topline-map.ts';

// ── 픽스처 헬퍼 ──
const NO_ATTR: RespondentAttributes = { race: null, gender: null, age: null, age_group: null };

function doc(
  id: string,
  coded: CodedAnswer[],
  attributes: Partial<RespondentAttributes> = {},
): DocExtractWithMeta {
  return {
    themes: [],
    quotes: [],
    attributes: { ...NO_ATTR, ...attributes },
    coded,
    document_id: id,
    filename: `${id}.txt`,
  };
}

function ans(question: string, answer: string, extra: Partial<CodedAnswer> = {}): CodedAnswer {
  return { question, answer, aided: false, multi: false, chunk_ids: [], ...extra };
}

// 표 찾기 헬퍼.
function findTable(tally: ReturnType<typeof buildToplineTally>, id: string) {
  return tally.tables.find((t) => t.id === id);
}

describe('normLabel — 카테고리 매칭 키', () => {
  it('대소문자·공백·문장부호를 무시해 같은 카테고리를 병합한다', () => {
    assert.equal(normLabel('주 구매 채널'), normLabel(' 주  구매 채널.'));
    assert.equal(normLabel('Online'), normLabel('online!'));
  });
  it('다른 카테고리는 다른 키', () => {
    assert.notEqual(normLabel('온라인'), normLabel('오프라인'));
  });
});

describe('ageBucket — 연령 버킷', () => {
  it('정수 나이를 methodology 버킷으로', () => {
    assert.equal(ageBucket(19, null), '18-24');
    assert.equal(ageBucket(30, null), '25-34');
    assert.equal(ageBucket(40, null), '35-44');
    assert.equal(ageBucket(55, null), '45+');
  });
  it('나이 없이 age_group 라벨만 있으면 그대로', () => {
    assert.equal(ageBucket(null, '20대'), '20대');
  });
  it('둘 다 없으면 null(미상)', () => {
    assert.equal(ageBucket(null, null), null);
  });
  it('18세 미만은 미분류(null)', () => {
    assert.equal(ageBucket(15, null), null);
  });
});

describe('buildToplineTally — 전체(overall) 집계', () => {
  it('분모 N = 전체 응답자(미응답 포함), 표기 라벨 카테고리 병합', () => {
    // 3명이 "주 구매 채널" 응답(온라인 2·오프라인 1), 1명은 미응답 → N=4.
    const extracts = [
      doc('r1', [ans('주 구매 채널', '온라인')]),
      doc('r2', [ans('주 구매 채널', '온라인 ')]), // 표기만 다름 → 병합
      doc('r3', [ans('주 구매 채널', '오프라인')]),
      doc('r4', []), // 미응답
    ];
    const tally = buildToplineTally(extracts);
    assert.equal(tally.respondentCount, 4);
    assert.equal(tally.codedRespondents, 3);
    const t = findTable(tally, `overall:${normLabel('주 구매 채널')}`);
    assert.ok(t, '전체 표가 있어야 함');
    assert.equal(t!.denominator, 4);
    // 온라인 2/4 = 50%, 오프라인 1/4 = 25%.
    const online = t!.rows.find((r) => r[0].includes('온라인'));
    const offline = t!.rows.find((r) => r[0].includes('오프라인'));
    assert.equal(online![1], '2');
    assert.equal(online![2], '50%');
    assert.equal(offline![1], '1');
    assert.equal(offline![2], '25%');
    // 미응답 1명은 캡션에 정직 표기.
    assert.match(t!.caption, /미언급 1명/);
    assert.match(t!.caption, /분모 N=4/);
  });

  it('단일선택 vs 복수귀속 라벨을 캡션에 기록(§1-11)', () => {
    const single = buildToplineTally([
      doc('a', [ans('선호 성분', 'A')]),
      doc('b', [ans('선호 성분', 'B')]),
      doc('c', [ans('선호 성분', 'A')]),
    ]);
    assert.match(findTable(single, `overall:${normLabel('선호 성분')}`)!.caption, /단일선택/);

    const multi = buildToplineTally([
      doc('a', [ans('겪는 불편', 'X', { multi: true }), ans('겪는 불편', 'Y', { multi: true })]),
      doc('b', [ans('겪는 불편', 'X', { multi: true })]),
      doc('c', [ans('겪는 불편', 'Z', { multi: true })]),
    ]);
    assert.match(
      findTable(multi, `overall:${normLabel('겪는 불편')}`)!.caption,
      /복수 귀속.*100% 초과/,
    );
  });

  it('비보조 vs 보조 인지를 라벨로 분리(§1-3)', () => {
    const aided = buildToplineTally([
      doc('a', [ans('브랜드 인지', 'Eucerin', { aided: true })]),
      doc('b', [ans('브랜드 인지', 'Eucerin', { aided: true })]),
      doc('c', [ans('브랜드 인지', 'CeraVe', { aided: true })]),
    ]);
    assert.match(findTable(aided, `overall:${normLabel('브랜드 인지')}`)!.caption, /보조 인지/);
  });

  it('한 응답자가 같은 (문항,답)을 중복 코딩해도 1명으로 센다', () => {
    const tally = buildToplineTally([
      doc('a', [ans('채널', '온라인'), ans('채널', '온라인')]), // 중복
      doc('b', [ans('채널', '온라인')]),
      doc('c', [ans('채널', '오프라인')]),
    ]);
    const t = findTable(tally, `overall:${normLabel('채널')}`);
    assert.equal(t!.rows.find((r) => r[0].includes('온라인'))![1], '2'); // 3 아님
  });

  it('MIN_QUESTION_RESPONDENTS 미만 문항(singleton)은 표로 내지 않는다', () => {
    const tally = buildToplineTally([
      doc('a', [ans('희귀 문항', 'x')]),
      doc('b', [ans('희귀 문항', 'y')]),
    ]);
    assert.equal(findTable(tally, `overall:${normLabel('희귀 문항')}`), undefined);
  });
});

describe('buildToplineTally — 세그먼트 크로스탭', () => {
  // 여성 3 · 남성 3, 각각 채널 응답.
  const extracts = [
    doc('f1', [ans('채널', '온라인')], { gender: 'female' }),
    doc('f2', [ans('채널', '온라인')], { gender: '여' }),
    doc('f3', [ans('채널', '오프라인')], { gender: 'female' }),
    doc('m1', [ans('채널', '오프라인')], { gender: 'male' }),
    doc('m2', [ans('채널', '오프라인')], { gender: '남' }),
    doc('m3', [ans('채널', '온라인')], { gender: 'male' }),
  ];

  it('성별 크로스탭에 그룹 n·전체·차이(%p)를 낸다', () => {
    const tally = buildToplineTally(extracts);
    const ct = findTable(tally, `crosstab:gender:${normLabel('채널')}`);
    assert.ok(ct, '성별 크로스탭 존재');
    // 헤더: 보기 / 전체(N=6) / 여성(n=3) / 남성(n=3) / 차이(%p)
    assert.match(ct!.headers[1], /전체.*N=6/);
    assert.ok(ct!.headers.some((h) => /여성.*n=3/.test(h)));
    assert.ok(ct!.headers.some((h) => /남성.*n=3/.test(h)));
    assert.equal(ct!.headers[ct!.headers.length - 1], '차이(%p)');
    // 온라인: 전체 3/6=50%, 여성 2/3≈66.7%, 남성 1/3≈33.3%, 차이≈33.3%p.
    const online = ct!.rows.find((r) => r[0].includes('온라인'))!;
    assert.equal(online[1], '50%');
    assert.match(online[online.length - 1], /33\.3%p/);
  });

  it('속성 미상 응답자는 크로스탭에서 제외하되 전체 분모 N 엔 포함(정직)', () => {
    const withUnknown = [...extracts, doc('u1', [ans('채널', '온라인')])]; // 성별 미상
    const tally = buildToplineTally(withUnknown);
    assert.equal(tally.respondentCount, 7); // 전체 분모엔 포함
    const overall = findTable(tally, `overall:${normLabel('채널')}`)!;
    assert.equal(overall.denominator, 7);
    const ct = findTable(tally, `crosstab:gender:${normLabel('채널')}`)!;
    // 크로스탭 그룹 n 은 여전히 3·3(미상 제외).
    assert.ok(ct.headers.some((h) => /여성.*n=3/.test(h)));
    assert.match(ct.caption, /속성 미상.*제외/);
  });

  it('소그룹(n<12)은 방향 참고 캡션 + * 마킹', () => {
    const tally = buildToplineTally(extracts); // 그룹 n=3 < 12
    const ct = findTable(tally, `crosstab:gender:${normLabel('채널')}`)!;
    assert.equal(ct.smallGroup, true);
    assert.ok(ct.headers.some((h) => h.includes('*')), '소그룹 헤더에 * 표기');
    assert.match(ct.caption, /n<12.*방향 참고/);
    assert.match(ct.caption, /15%p 이상/);
  });

  it('그룹이 1개뿐인 축은 크로스탭을 만들지 않는다', () => {
    const oneGroup = [
      doc('f1', [ans('채널', '온라인')], { gender: 'female' }),
      doc('f2', [ans('채널', '오프라인')], { gender: 'female' }),
      doc('f3', [ans('채널', '온라인')], { gender: 'female' }),
    ];
    const tally = buildToplineTally(oneGroup);
    assert.equal(findTable(tally, `crosstab:gender:${normLabel('채널')}`), undefined);
    assert.equal(tally.segments.length, 0); // 축 자체가 없음
  });
});

describe('formatTallyForReduce — reduce 주입 렌더', () => {
  it('표가 없으면(닫힌 문항 근거 부족) 정직하게 알리고 지어내기를 막는다', () => {
    const tally = buildToplineTally([doc('a', []), doc('b', []), doc('c', [])]);
    const out = formatTallyForReduce(tally);
    assert.match(out, /사전집계 표가 없습니다/);
    assert.match(out, /지어내지 말고/);
    assert.equal(tally.tables.length, 0);
  });

  it('분모 N·세그먼트 커버리지를 헤더로 정직 표기', () => {
    const tally = buildToplineTally([
      doc('f1', [ans('채널', '온라인')], { gender: 'female' }),
      doc('f2', [ans('채널', '온라인')], { gender: 'female' }),
      doc('m1', [ans('채널', '오프라인')], { gender: 'male' }),
      doc('m2', [ans('채널', '오프라인')], { gender: 'male' }),
    ]);
    const out = formatTallyForReduce(tally);
    assert.match(out, /전체 응답자 N=4/);
    assert.match(out, /성별\(속성 보유 4\/4\)/);
    assert.match(out, /\| 보기\(답변\) \|/); // markdown 표
  });

  it('같은 입력이면 같은 출력(재현 가능)', () => {
    const mk = () => [
      doc('a', [ans('채널', '온라인')]),
      doc('b', [ans('채널', '오프라인')]),
      doc('c', [ans('채널', '온라인')]),
    ];
    assert.equal(
      formatTallyForReduce(buildToplineTally(mk())),
      formatTallyForReduce(buildToplineTally(mk())),
    );
  });
});

describe('SMALL_GROUP_N 상수', () => {
  it('methodology §1-6 소그룹 임계 = 12', () => {
    assert.equal(SMALL_GROUP_N, 12);
  });
});
