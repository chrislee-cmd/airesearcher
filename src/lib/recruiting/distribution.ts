import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// Cross-tab distribution for the recruiting fullview 분포 위젯.
//
// There is no `form_responses` table in this repo — recruiting responses
// live in Google Forms and are read through getFormResponses() as
// { columns, rows } where each answer is free text keyed by questionId
// (the axis is identified by the column *title*, mirroring recruiting-pii /
// contact-filter). So the pivot is computed here in-app over the same rows
// the spreadsheet renders, not in SQL. The default axes are 성별 (x, rows)
// × 연령대 (y, columns); age is bucketed from the standard 출생년도 (birth
// year) or a raw age number into decades.
//
// Only aggregate counts leave the server — no individual respondent value —
// so this is not a PII surface even though the age source column is otherwise
// masked in the row spreadsheet. The consent gate still applies upstream
// (the route feeds us consented rows only).

export type DistributionTable = {
  xLabels: string[]; // 성별 buckets, rows — e.g. ['여성', '남성']
  yLabels: string[]; // 연령대 buckets, columns — e.g. ['20s', '30s']
  cells: number[][]; // cells[xIndex][yIndex]
  xTotal: number[]; // row totals, one per xLabel
  yTotal: number[]; // column totals, one per yLabel
  grandTotal: number;
  xTitle: string; // source column title for the x axis
  yTitle: string; // source column title for the y axis
};

// Title-substring detection, lower-cased — matches whatever the recruiter or
// the LLM wrote as the question title. First matching column wins.
const GENDER_TITLE_RE = /성별|gender/i;
const AGE_TITLE_RE = /출생|생년|나이|연령|age|birth/i;

export function findGenderColumn(columns: FormColumn[]): FormColumn | null {
  return columns.find((c) => GENDER_TITLE_RE.test(c.title)) ?? null;
}

export function findAgeColumn(columns: FormColumn[]): FormColumn | null {
  return columns.find((c) => AGE_TITLE_RE.test(c.title)) ?? null;
}

// '여성'/'남성' normalised from any variant; a non-empty answer that is
// neither (e.g. '응답하지 않음') keeps its raw value as its own bucket. Empty
// answers return null so the row is dropped from the cross-tab.
// Exported so the spreadsheet can re-derive a row's bucket when matching a
// clicked distribution cell (same normalisation → the crossfilter lines up).
export function normalizeGender(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes('여')) return '여성';
  if (s.includes('남')) return '남성';
  return s;
}

// Decade bucket ('20s', '30s', …) from a birth year (1900..nowYear), a raw
// age (1..119), or a Korean '20대' range. Anything unparseable returns null
// (dropped) so the basic table stays clean, matching a SQL GROUP BY that
// would produce a NULL bucket.
// Exported for the crossfilter (see normalizeGender above).
export function toAgeBucket(raw: string, nowYear: number): string | null {
  const s = raw.trim();
  if (!s) return null;

  const daeMatch = s.match(/(\d{1,2})\s*대/);
  if (daeMatch) {
    const d = Number.parseInt(daeMatch[1], 10);
    if (d >= 10 && d <= 90) return `${d}s`;
  }

  const numMatch = s.match(/\d{1,4}/);
  if (!numMatch) return null;
  const n = Number.parseInt(numMatch[0], 10);

  let age: number | null = null;
  if (n >= 1900 && n <= nowYear) age = nowYear - n; // birth year
  else if (n >= 1 && n < 120) age = n; // raw age
  if (age === null || age < 0) return null;

  const decade = Math.floor(age / 10) * 10;
  const capped = decade < 10 ? 10 : decade > 90 ? 90 : decade;
  return `${capped}s`;
}

export type BuildDistributionOpts = {
  nowYear: number;
  // Optional questionId overrides for which column is the gender / age axis;
  // the (later) crossfilter spec can point these at other columns. When
  // omitted the axes are auto-detected by title.
  xQuestionId?: string;
  yQuestionId?: string;
};

// Returns null when the form has no gender/age column at all (the caller
// renders a "문항 없음" empty state). Returns a table with grandTotal 0 when
// the columns exist but no row has both axis values yet.
export function buildDistributionTable(
  columns: FormColumn[],
  rows: FormResponseRow[],
  opts: BuildDistributionOpts,
): DistributionTable | null {
  const genderCol = opts.xQuestionId
    ? columns.find((c) => c.questionId === opts.xQuestionId) ?? null
    : findGenderColumn(columns);
  const ageCol = opts.yQuestionId
    ? columns.find((c) => c.questionId === opts.yQuestionId) ?? null
    : findAgeColumn(columns);
  if (!genderCol || !ageCol) return null;

  const pairs: Array<[string, string]> = [];
  for (const r of rows) {
    const gx = normalizeGender(r.answers[genderCol.questionId] ?? '');
    const ay = toAgeBucket(r.answers[ageCol.questionId] ?? '', opts.nowYear);
    if (gx === null || ay === null) continue;
    pairs.push([gx, ay]);
  }

  // x order: 여성 → 남성 → any other value (alphabetical). y order: decade asc.
  const xSeen = new Set(pairs.map((p) => p[0]));
  const preferredX = ['여성', '남성'].filter((l) => xSeen.has(l));
  const otherX = [...xSeen]
    .filter((l) => l !== '여성' && l !== '남성')
    .sort((a, b) => a.localeCompare(b));
  const xLabels = [...preferredX, ...otherX];

  const yLabels = [...new Set(pairs.map((p) => p[1]))].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );

  const xIndex = new Map(xLabels.map((l, i) => [l, i]));
  const yIndex = new Map(yLabels.map((l, i) => [l, i]));

  const cells = xLabels.map(() => yLabels.map(() => 0));
  for (const [gx, ay] of pairs) {
    cells[xIndex.get(gx)!][yIndex.get(ay)!] += 1;
  }

  const xTotal = cells.map((row) => row.reduce((a, b) => a + b, 0));
  const yTotal = yLabels.map((_, j) =>
    xLabels.reduce((a, _l, i) => a + cells[i][j], 0),
  );
  const grandTotal = xTotal.reduce((a, b) => a + b, 0);

  return {
    xLabels,
    yLabels,
    cells,
    xTotal,
    yTotal,
    grandTotal,
    xTitle: genderCol.title,
    yTitle: ageCol.title,
  };
}

// ── Crossfilter (분포 셀 다중선택 · 질문 필터 multi-select) ─────────────
//
// Multi-select filter (2026-07-04): the fullview holds a *set* of selected
// distribution cells AND a set of per-question selected answers. Semantics:
//   • cells     — OR across selected cells (여러 셀 중 하나라도 매치)
//   • questions — OR within one question's answers, AND between questions
//     즉 (질문 A 답변군 중 하나) ∧ (질문 B 답변군 중 하나) …
// Held in the fullview host as session-level state (no URL) and applied to
// BOTH the response spreadsheet rows AND the 분포 crosstab — so filtering
// re-computes the distribution too. This is the fix for the old bug where the
// crosstab was built from the unfiltered server aggregate and ignored the
// active filter entirely (분포 수치가 필터에 반응하지 않던 P0).

export type RecruitingCellFilter = { gender: string; ageBucket: string };
export type RecruitingQuestionFilter = { field: string; answers: string[] };

export type RecruitingFilter = {
  cells: RecruitingCellFilter[];
  questions: RecruitingQuestionFilter[];
};

// Shared empty value for initial state / resets. Never mutated — every update
// below returns a fresh object, so sharing this reference is safe.
export const EMPTY_FILTER: RecruitingFilter = { cells: [], questions: [] };

export function hasActiveFilter(filter: RecruitingFilter): boolean {
  return (
    filter.cells.length > 0 ||
    filter.questions.some((q) => q.answers.length > 0)
  );
}

// A choice question the 질문 필터 dropdown can offer, with its answer options.
export type FilterableQuestion = {
  field: string; // questionId
  title: string;
  answers: string[];
};

// 객관식 = choice question (RADIO / CHECKBOX / DROP_DOWN). 주관식(text) and
// scale are excluded per spec.
export function isObjectiveColumn(c: FormColumn): boolean {
  return (
    c.kind === 'single_choice' ||
    c.kind === 'multi_choice' ||
    c.kind === 'dropdown'
  );
}

// Split a stored answer string into its individual values. Multi-select
// answers arrive ", "-joined from getFormResponses; single answers pass
// through as one value.
function splitAnswerValues(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build the 질문 필터 option list: each 객관식 column with its answer options.
// Options come from the form schema (choiceQuestion.options); when the schema
// stored none, fall back to the distinct values observed in the responses.
export function buildFilterableQuestions(
  columns: FormColumn[],
  rows: FormResponseRow[],
): FilterableQuestion[] {
  return columns.filter(isObjectiveColumn).map((c) => {
    const schemaOptions = c.options ?? [];
    const answers = schemaOptions.length
      ? schemaOptions
      : uniqueAnswerValues(rows, c.questionId);
    return { field: c.questionId, title: c.title, answers };
  });
}

function uniqueAnswerValues(
  rows: FormResponseRow[],
  questionId: string,
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const raw = r.answers[questionId];
    if (!raw) continue;
    for (const v of splitAnswerValues(raw)) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Does a response row satisfy the active multi-select filter? Used by BOTH the
// spreadsheet (narrow visible rows) and the 분포 panel (re-derive the crosstab
// from the filtered rows) so the two can never diverge.
//
// A cell filter re-derives the row's gender/age bucket with the same
// normalisation the crosstab used, so a clicked "여성 × 20s" cell matches
// exactly the rows that produced it. A missing gender/age column means the
// cell group can't apply — we skip it (pass rows through) rather than silently
// emptying the table.
export function matchesFilter(
  row: FormResponseRow,
  filter: RecruitingFilter,
  columns: FormColumn[],
  nowYear: number,
): boolean {
  // Cell group — OR across selected cells. Skip entirely when none selected.
  if (filter.cells.length > 0) {
    const genderCol = findGenderColumn(columns);
    const ageCol = findAgeColumn(columns);
    // Only apply when both axes exist; otherwise the cell group is inert.
    if (genderCol && ageCol) {
      const g = normalizeGender(row.answers[genderCol.questionId] ?? '');
      const a = toAgeBucket(row.answers[ageCol.questionId] ?? '', nowYear);
      const cellHit = filter.cells.some(
        (c) => c.gender === g && c.ageBucket === a,
      );
      if (!cellHit) return false;
    }
  }

  // Question groups — OR within a question's answers, AND between questions.
  for (const q of filter.questions) {
    if (q.answers.length === 0) continue;
    const raw = row.answers[q.field];
    const values = raw ? splitAnswerValues(raw) : [];
    const hit = q.answers.some((a) => values.includes(a));
    if (!hit) return false;
  }

  return true;
}

// ── Immutable toggle / query helpers for the multi-select filter ──────────
// All return a fresh RecruitingFilter (React state-safe). Toggling an already
// selected cell/answer removes it, so the same call powers both the cell/
// checkbox toggle and the chip "×" removal.

export function isCellActive(
  filter: RecruitingFilter,
  gender: string,
  ageBucket: string,
): boolean {
  return filter.cells.some(
    (c) => c.gender === gender && c.ageBucket === ageBucket,
  );
}

export function toggleCell(
  filter: RecruitingFilter,
  cell: RecruitingCellFilter,
): RecruitingFilter {
  const exists = isCellActive(filter, cell.gender, cell.ageBucket);
  return {
    ...filter,
    cells: exists
      ? filter.cells.filter(
          (c) => !(c.gender === cell.gender && c.ageBucket === cell.ageBucket),
        )
      : [...filter.cells, cell],
  };
}

export function isAnswerActive(
  filter: RecruitingFilter,
  field: string,
  answer: string,
): boolean {
  return (
    filter.questions
      .find((q) => q.field === field)
      ?.answers.includes(answer) ?? false
  );
}

export function toggleAnswer(
  filter: RecruitingFilter,
  field: string,
  answer: string,
): RecruitingFilter {
  const existing = filter.questions.find((q) => q.field === field);
  if (!existing) {
    return {
      ...filter,
      questions: [...filter.questions, { field, answers: [answer] }],
    };
  }
  const nextAnswers = existing.answers.includes(answer)
    ? existing.answers.filter((a) => a !== answer)
    : [...existing.answers, answer];
  // Drop the question entry entirely when its last answer is removed so
  // hasActiveFilter / chip rendering stay clean.
  const questions = nextAnswers.length
    ? filter.questions.map((q) =>
        q.field === field ? { field, answers: nextAnswers } : q,
      )
    : filter.questions.filter((q) => q.field !== field);
  return { ...filter, questions };
}
