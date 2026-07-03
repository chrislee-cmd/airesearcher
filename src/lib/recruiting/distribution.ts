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
function normalizeGender(raw: string): string | null {
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
function toAgeBucket(raw: string, nowYear: number): string | null {
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
