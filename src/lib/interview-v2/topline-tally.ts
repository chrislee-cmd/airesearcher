// 인터뷰 탑라인 — **결정적 집계(tally) 레이어**.
//
// 왜 (카드 603): 예전엔 reduce(Opus)가 map 추출 텍스트에서 "N명 중 M명"을
// **눈대중으로** 세어 표가 희소하고 "다수/대다수" 류 모호 표현이 남았다. 손제작
// 보고서 38표는 파이썬 count 에서 나왔다. 이 모듈은 그 파이썬 역할을 코드로
// 옮긴다 — map 이 뽑은 **구조화 추출**(응답자 속성 + 닫힌 문항 코딩)을 받아
// **코드가 카운트**해 표 친화 구조로 산출하고, reduce 는 이 사전집계를 **그대로
// 인용**(재계산·추정 금지)한다. 수치의 SSOT 는 이 모듈이며, 순수 함수라 테스트로
// 재현 가능하다(tests/topline-tally.test.ts).
//
// 집계 무결성 규칙(SSOT = report skill methodology.md):
//   · §1-3  비보조 인지 vs 보조 인지는 다른 문항 — 절대 뭉치지 말고 라벨 분리.
//   · §1-6  소그룹(n<12)은 "방향 참고"만, 15%p 이상·0%/100%만 해석 권고.
//   · §1-10 판정 분모(n) 항상 표기.
//   · §1-11 단일선택 vs 복수귀속 기준을 캡션에 기록(복수는 합계 100% 초과).
//
// 제약(스펙): 스크리너 CSV 미투입 — 속성은 코퍼스(파일명/발화)에서만. 속성 없는
// 응답자는 크로스탭에서 제외하되 **전체 집계 분모 N 엔 포함**(커버리지 정직).

import type { DocExtractWithMeta } from '@/lib/interview-v2/topline-map';

// 소그룹 임계 — 셀/그룹 n 이 이 값 미만이면 "방향 참고"(해석 유보). methodology §1-6.
export const SMALL_GROUP_N = 12;

// 해석적 무게를 갖는 그룹 간 격차(%p). 이 미만은 노이즈로 본다. methodology §1-6.
export const MEANINGFUL_DIFF_PP = 15;

// 한 문항을 집계 표로 낼 최소 응답자 수 — 이 미만이면 singleton 잡음이라 생략
// (닫힌 문항 코딩이 우연히 1~2명만 겹친 경우). 표를 "지어내지 않는다" 원칙과 정합.
export const MIN_QUESTION_RESPONDENTS = 3;

// 사전집계 표로 낼 최대 문항 수(reduce 입력 팽창 방지). 응답자 커버리지 desc 로
// 정렬해 상위만. 잘린 문항 수는 formatTallyForReduce 가 캡션에 정직 표기.
export const MAX_TALLY_QUESTIONS = 30;

// 세그먼트 크로스탭 축.
export type SegmentDimension = 'race' | 'age' | 'gender';

const SEGMENT_LABEL: Record<SegmentDimension, string> = {
  race: '인종',
  age: '연령',
  gender: '성별',
};

// ── 정규화 헬퍼 ────────────────────────────────────────────────────────

// 문항 키/답변 라벨 정규화 — 응답자마다 표기가 미세하게 달라도 같은 카테고리면
// 같은 버킷으로 묶기 위한 매칭 키. 표시용 라벨은 별도로 최빈 원문을 쓴다.
export function normLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["'`.,·:;!?()[\]{}/\\-]/g, '')
    .trim();
}

// 연령 버킷 — 명시 정수 나이를 methodology 버킷(18-24/25-34/35-44/45+)으로.
// 나이가 없고 age_group 라벨만 있으면 그 라벨을 그대로 그룹으로 쓴다(정규화만).
export function ageBucket(age: number | null, ageGroup: string | null): string | null {
  if (age != null && Number.isFinite(age)) {
    if (age < 18) return null; // 성인 대상 조사 가정 밖 — 미분류.
    if (age <= 24) return '18-24';
    if (age <= 34) return '25-34';
    if (age <= 44) return '35-44';
    return '45+';
  }
  const g = ageGroup?.trim();
  return g ? g : null;
}

// 응답자의 세그먼트 축 값(정규화된 그룹 라벨). 없으면 null(=속성 미상 → 크로스탭 제외).
function segmentValue(e: DocExtractWithMeta, dim: SegmentDimension): string | null {
  const a = e.attributes;
  if (!a) return null;
  if (dim === 'race') return a.race?.trim() || null;
  if (dim === 'gender') return normGender(a.gender);
  return ageBucket(a.age, a.age_group);
}

// 성별 라벨 정규화 — 흔한 원문 표기를 여/남으로. 그 외는 원문 유지(지어내지 않음).
function normGender(g: string | null): string | null {
  const v = g?.trim().toLowerCase();
  if (!v) return null;
  if (/^(f|female|여|여성|여자|woman|women)$/.test(v)) return '여성';
  if (/^(m|male|남|남성|남자|man|men)$/.test(v)) return '남성';
  return g!.trim();
}

// ── 집계 결과 타입 ──────────────────────────────────────────────────────

// 표 친화 산출 — reduce 가 headers/rows 를 그대로 인용한다. 수치는 이미 %/n 문자열.
export type TallyTable = {
  // 안정 식별자(문항 정규화 키 기반) — reduce 참조·중복 방지용.
  id: string;
  title: string;
  // overall = 전체 분모 N 기준 문항 집계. crosstab = 세그먼트 축 교차.
  kind: 'overall' | 'crosstab';
  dimension?: SegmentDimension;
  aided: boolean;
  multi: boolean;
  // 분모 N — overall 은 전체 응답자 수, crosstab 은 전체 열 기준 N.
  denominator: number;
  headers: string[];
  rows: string[][];
  caption: string;
  // 이 표에 n<12 셀/그룹이 있는지(방향only 경고 트리거).
  smallGroup: boolean;
};

export type SegmentSummary = {
  dimension: SegmentDimension;
  // 이 축 속성이 있는 응답자 수(커버리지).
  attributed: number;
  groups: { label: string; n: number; small: boolean }[];
};

export type ToplineTally = {
  // 전체 응답자 수(분모 N) — 속성 미상 포함.
  respondentCount: number;
  // 닫힌 문항 코딩을 하나라도 가진 응답자 수(집계 커버리지 정직 표기).
  codedRespondents: number;
  segments: SegmentSummary[];
  tables: TallyTable[];
  // MAX_TALLY_QUESTIONS 로 생략된 문항 수(정직 표기).
  omittedQuestions: number;
};

// ── 내부 집계 구조 ──────────────────────────────────────────────────────

type QuestionAgg = {
  normKey: string;
  // 표시용 문항 라벨(최빈 원문).
  displayLabel: string;
  aided: boolean;
  multi: boolean;
  // answer normKey → { displayLabel, respondents: Set<docId> }
  answers: Map<string, { displayLabel: string; respondents: Set<string> }>;
  // 이 문항에 응답한 응답자 집합(분자 커버리지 확인용).
  respondents: Set<string>;
};

// 최빈 원문 라벨 선택 — 정규화 키가 같은 여러 원문 중 가장 자주 쓰인 표기.
function pickDisplay(counter: Map<string, number>): string {
  let best = '';
  let bestN = -1;
  for (const [label, n] of counter) {
    if (n > bestN) {
      bestN = n;
      best = label;
    }
  }
  return best;
}

/**
 * map 추출 전수(성공분 + 실패분)를 받아 결정적 집계를 만든다. 순수 함수 —
 * LLM/DB 접근 없음. 같은 입력이면 항상 같은 표(재현 가능).
 */
export function buildToplineTally(extracts: DocExtractWithMeta[]): ToplineTally {
  const respondentCount = extracts.length;

  // ── 세그먼트 요약 (축별 그룹 크기) ──
  const segments: SegmentSummary[] = (['race', 'age', 'gender'] as SegmentDimension[])
    .map((dim) => {
      const groupN = new Map<string, number>();
      let attributed = 0;
      for (const e of extracts) {
        const v = segmentValue(e, dim);
        if (!v) continue;
        attributed += 1;
        groupN.set(v, (groupN.get(v) ?? 0) + 1);
      }
      const groups = [...groupN.entries()]
        .map(([label, n]) => ({ label, n, small: n < SMALL_GROUP_N }))
        .sort((a, b) => b.n - a.n);
      return { dimension: dim, attributed, groups };
    })
    // 그룹이 2개 이상인 축만 크로스탭 의미가 있다.
    .filter((s) => s.groups.length >= 2);

  // ── 문항 집계 ──
  const questions = new Map<string, QuestionAgg>();
  // 문항/답변 표시 라벨 최빈 선택용 카운터.
  const qDisplay = new Map<string, Map<string, number>>();
  const aFlags = new Map<string, { aided: number; multi: number; total: number }>();
  let codedRespondents = 0;

  for (const e of extracts) {
    const coded = e.coded ?? [];
    if (coded.length > 0) codedRespondents += 1;
    // 한 응답자가 같은 (문항,답) 을 여러 번 코딩해도 1명으로 센다(중복 방지).
    const seenPair = new Set<string>();
    for (const c of coded) {
      const qKey = normLabel(c.question);
      const aKey = normLabel(c.answer);
      if (!qKey || !aKey) continue;

      // 표시 라벨 최빈 집계.
      if (!qDisplay.has(qKey)) qDisplay.set(qKey, new Map());
      const qd = qDisplay.get(qKey)!;
      qd.set(c.question.trim(), (qd.get(c.question.trim()) ?? 0) + 1);

      // aided/multi 모드 판정용 카운트(문항 단위 다수결).
      if (!aFlags.has(qKey)) aFlags.set(qKey, { aided: 0, multi: 0, total: 0 });
      const f = aFlags.get(qKey)!;
      f.total += 1;
      if (c.aided) f.aided += 1;
      if (c.multi) f.multi += 1;

      if (!questions.has(qKey)) {
        questions.set(qKey, {
          normKey: qKey,
          displayLabel: c.question.trim(),
          aided: false,
          multi: false,
          answers: new Map(),
          respondents: new Set(),
        });
      }
      const q = questions.get(qKey)!;
      if (!q.answers.has(aKey)) {
        q.answers.set(aKey, { displayLabel: c.answer.trim(), respondents: new Set() });
      }
      const ans = q.answers.get(aKey)!;
      // 답변 표시 라벨도 최빈으로 수렴.
      const aDispKey = `${qKey} ${aKey}`;
      if (!qDisplay.has(aDispKey)) qDisplay.set(aDispKey, new Map());
      const ad = qDisplay.get(aDispKey)!;
      ad.set(c.answer.trim(), (ad.get(c.answer.trim()) ?? 0) + 1);

      const pairKey = `${qKey} ${aKey}`;
      if (!seenPair.has(pairKey)) {
        seenPair.add(pairKey);
        ans.respondents.add(e.document_id);
        q.respondents.add(e.document_id);
      }
    }
  }

  // 표시 라벨·플래그 확정.
  for (const q of questions.values()) {
    q.displayLabel = pickDisplay(qDisplay.get(q.normKey)!) || q.displayLabel;
    const f = aFlags.get(q.normKey)!;
    q.aided = f.aided * 2 > f.total; // 과반 보조 → 보조 문항.
    q.multi = f.multi * 2 > f.total; // 과반 복수 → 복수 문항.
    for (const [aKey, ans] of q.answers) {
      ans.displayLabel = pickDisplay(qDisplay.get(`${q.normKey} ${aKey}`)!) || ans.displayLabel;
    }
  }

  // 응답자 수(커버리지) desc 로 정렬 후 상한 적용.
  const ordered = [...questions.values()].sort(
    (a, b) => b.respondents.size - a.respondents.size,
  );
  const eligible = ordered.filter((q) => q.respondents.size >= MIN_QUESTION_RESPONDENTS);
  const kept = eligible.slice(0, MAX_TALLY_QUESTIONS);
  const omittedQuestions = eligible.length - kept.length;

  const tables: TallyTable[] = [];
  for (const q of kept) {
    tables.push(buildOverallTable(q, respondentCount));
    // 축별 크로스탭 — 이 문항 응답자가 해당 축 속성을 충분히 가질 때만.
    for (const seg of segments) {
      const ct = buildCrosstab(q, seg, extracts, respondentCount);
      if (ct) tables.push(ct);
    }
  }

  return {
    respondentCount,
    codedRespondents,
    segments,
    tables,
    omittedQuestions,
  };
}

function pct(numer: number, denom: number): string {
  if (denom <= 0) return '—';
  return `${Math.round((numer / denom) * 1000) / 10}%`;
}

// 전체 분모 N 기준 문항 집계 표. 행 = 답변 라벨, 열 = [답변, 응답자 수(n), 비율(%)].
function buildOverallTable(q: QuestionAgg, N: number): TallyTable {
  const answerRows = [...q.answers.values()].sort(
    (a, b) => b.respondents.size - a.respondents.size,
  );
  const rows = answerRows.map((a) => [
    a.displayLabel,
    String(a.respondents.size),
    pct(a.respondents.size, N),
  ]);
  const kind = q.aided ? '보조 인지' : '비보조';
  const sel = q.multi ? '복수 귀속(합계 100% 초과 가능)' : '단일선택';
  const answered = q.respondents.size;
  const caption =
    `문항 유형: ${kind} · ${sel}. 분모 N=${N}(전체 응답자). ` +
    `이 문항 응답 ${answered}명(미언급 ${N - answered}명은 %에 미포함).` +
    (answered < SMALL_GROUP_N ? ' ⚠️ 응답 n<12 — 방향 참고만.' : '');
  return {
    id: `overall:${q.normKey}`,
    title: q.displayLabel,
    kind: 'overall',
    aided: q.aided,
    multi: q.multi,
    denominator: N,
    headers: ['보기(답변)', '응답자 수(n)', '비율(%)'],
    rows,
    caption,
    smallGroup: answered < SMALL_GROUP_N,
  };
}

// 세그먼트 크로스탭 — 행 = 답변, 열 = [답변, 전체(%), 그룹1(n)(%), … , 차이(%p)?].
// 그룹 % 분모 = 그 그룹 크기. 그룹이 정확히 2개면 차이(%p) 열 추가. 반환 null =
// 이 문항엔 크로스탭 의미 없음(속성 보유 응답자 부족).
function buildCrosstab(
  q: QuestionAgg,
  seg: SegmentSummary,
  extracts: DocExtractWithMeta[],
  N: number,
): TallyTable | null {
  // docId → 이 축 그룹 라벨.
  const groupByDoc = new Map<string, string>();
  for (const e of extracts) {
    const v = segmentValue(e, seg.dimension);
    if (v) groupByDoc.set(e.document_id, v);
  }
  // 이 문항에 응답하면서 이 축 속성을 가진 응답자만 크로스탭 대상.
  const groupsInPlay = seg.groups.filter((g) =>
    [...q.respondents].some((docId) => groupByDoc.get(docId) === g.label),
  );
  if (groupsInPlay.length < 2) return null; // 대조할 그룹 부족.

  const answerRows = [...q.answers.values()].sort(
    (a, b) => b.respondents.size - a.respondents.size,
  );

  const headers = ['보기(답변)', `전체(N=${N})`];
  for (const g of groupsInPlay) {
    headers.push(`${g.label}(n=${g.n})${g.small ? '*' : ''}`);
  }
  const twoGroup = groupsInPlay.length === 2;
  if (twoGroup) headers.push('차이(%p)');

  const rows = answerRows.map((a) => {
    const row = [a.displayLabel, pct(a.respondents.size, N)];
    const groupPcts: number[] = [];
    for (const g of groupsInPlay) {
      const inGroup = [...a.respondents].filter(
        (docId) => groupByDoc.get(docId) === g.label,
      ).length;
      row.push(pct(inGroup, g.n));
      groupPcts.push(g.n > 0 ? (inGroup / g.n) * 100 : 0);
    }
    if (twoGroup) {
      const diff = Math.abs(groupPcts[0] - groupPcts[1]);
      row.push(`${Math.round(diff * 10) / 10}%p`);
    }
    return row;
  });

  const anySmall = groupsInPlay.some((g) => g.small);
  const sel = q.multi ? '복수 귀속' : '단일선택';
  const kind = q.aided ? '보조 인지' : '비보조';
  const caption =
    `${SEGMENT_LABEL[seg.dimension]} 크로스탭 · ${kind} · ${sel}. 각 열 분모 = 그룹 n(헤더 표기). ` +
    `해석: 5%p 내외는 노이즈, 15%p 이상·0%/100%만 해석. ` +
    (anySmall ? '⚠️ n<12 그룹(*)은 방향 참고만 — 단정 금지. ' : '') +
    '속성 미상 응답자는 이 표에서 제외(전체 분모 N 엔 포함).';

  return {
    id: `crosstab:${seg.dimension}:${q.normKey}`,
    title: `${q.displayLabel} — ${SEGMENT_LABEL[seg.dimension]}별`,
    kind: 'crosstab',
    dimension: seg.dimension,
    aided: q.aided,
    multi: q.multi,
    denominator: N,
    headers,
    rows,
    caption,
    smallGroup: anySmall,
  };
}

// ── reduce 주입용 렌더 ──────────────────────────────────────────────────

function renderTable(t: TallyTable): string {
  const head = `| ${t.headers.join(' | ')} |`;
  const sep = `| ${t.headers.map(() => '---').join(' | ')} |`;
  const body = t.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  const tag = t.kind === 'crosstab' ? '[크로스탭]' : '[전체]';
  return `#### ${tag} ${t.title}\n${head}\n${sep}\n${body}\n> ${t.caption}`;
}

/**
 * 사전집계를 reduce system prompt 에 주입할 텍스트로 렌더. 표 수치는 이미
 * 확정(코드 산출)이라 reduce 는 이를 **그대로 인용**만 한다(재계산·추정 금지 —
 * 주입 지시는 topline.ts 가 함께 붙임). 표가 하나도 없으면(닫힌 문항 근거 없는
 * 코퍼스) 그 사실을 정직하게 알려 reduce 가 표를 지어내지 않게 한다.
 */
export function formatTallyForReduce(tally: ToplineTally): string {
  const N = tally.respondentCount;
  const lines: string[] = [];

  // 커버리지 헤더 — 분모/속성 커버리지 정직 표기.
  lines.push(`전체 응답자 N=${N}. 닫힌 문항 코딩 보유 응답자=${tally.codedRespondents}명.`);
  if (tally.segments.length > 0) {
    const segBits = tally.segments.map((s) => {
      const groups = s.groups
        .map((g) => `${g.label} n=${g.n}${g.small ? '(소그룹)' : ''}`)
        .join(', ');
      return `${SEGMENT_LABEL[s.dimension]}(속성 보유 ${s.attributed}/${N}): ${groups}`;
    });
    lines.push(`세그먼트 커버리지 — ${segBits.join(' / ')}.`);
  } else {
    lines.push('세그먼트 속성(인종/연령/성별) 근거가 부족해 크로스탭 축이 없습니다(전체 집계만).');
  }

  if (tally.tables.length === 0) {
    lines.push(
      '',
      '⚠️ 코퍼스에서 결정적으로 집계 가능한 닫힌(객관식) 문항 근거가 부족해 사전집계 표가 없습니다. ' +
        '이 경우 표를 지어내지 말고, 주제·인용 추출과 문서 간 대조 위주로 서술하세요.',
    );
    return lines.join('\n');
  }

  lines.push('', ...tally.tables.map(renderTable));

  if (tally.omittedQuestions > 0) {
    lines.push(
      '',
      `(응답자 커버리지 하위 ${tally.omittedQuestions}개 문항은 지면상 생략 — 필요하면 위 추출에서 직접 확인.)`,
    );
  }
  return lines.join('\n');
}
