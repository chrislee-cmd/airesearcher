import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// Adapter (card 588): turn intake `sched_candidates` (uploaded/imported rows
// awaiting selection) into the { columns, rows } shape the recruiting responses
// table already renders, so the ①응답 "업로드 명단" segment reuses that table
// instead of a bespoke one. Pure + presentation-agnostic: the caller passes the
// localized name/email/phone labels so this stays i18n-free.
//
// Column order = 이름 · 이메일 · 연락처, then the UNION of every intake row's
// `fields` keys in first-seen order (a partial re-upload that added a column
// still contributes it). Field question ids are prefixed `f:` so a stray field
// named "name"/"email"/"phone" can't collide with the synthetic contact columns.
//
// Each row's responseId is `cand:<sched_candidates.id>` — the `cand:` prefix
// keeps intake selections in a separate key space from Google Forms responseIds
// (both share the bridge's selection Set), so the bridge can route them to the
// promote endpoint instead of the invitations endpoint.

export type IntakeCandidate = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string> | null;
};

// The `cand:` prefix marking an intake row's responseId in the shared bridge
// selection Set. Exported so the bridge can split mixed selections without
// re-declaring the literal.
export const INTAKE_ID_PREFIX: string = 'cand:';

export type IntakeLabels = {
  name: string;
  email: string;
  phone: string;
};

const COL_NAME = '__name';
const COL_EMAIL = '__email';
const COL_PHONE = '__phone';

export function intakeRowsToTable(
  candidates: IntakeCandidate[],
  labels: IntakeLabels,
): { columns: FormColumn[]; rows: FormResponseRow[] } {
  // First-seen union of field keys across all rows.
  const fieldKeys: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const k of Object.keys(c.fields ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        fieldKeys.push(k);
      }
    }
  }

  const columns: FormColumn[] = [
    { questionId: COL_NAME, itemId: COL_NAME, title: labels.name },
    { questionId: COL_EMAIL, itemId: COL_EMAIL, title: labels.email },
    { questionId: COL_PHONE, itemId: COL_PHONE, title: labels.phone },
    ...fieldKeys.map((k) => ({ questionId: `f:${k}`, itemId: `f:${k}`, title: k })),
  ];

  const rows: FormResponseRow[] = candidates.map((c) => {
    const answers: Record<string, string> = {
      [COL_NAME]: c.name ?? '',
      [COL_EMAIL]: c.email ?? '',
      [COL_PHONE]: c.phone ?? '',
    };
    for (const k of fieldKeys) {
      const v = c.fields?.[k];
      if (v != null && v !== '') answers[`f:${k}`] = v;
    }
    return {
      responseId: `${INTAKE_ID_PREFIX}${c.id}`,
      // Intake rows have no submit time — the responses table skips its time
      // column for this source (showTime=false).
      createTime: '',
      lastSubmittedTime: '',
      answers,
    };
  });

  return { columns, rows };
}

// CSV export for the uploaded-list controls (card 597, CD frame N6 State A "↓ CSV").
// Unlike responsesToCsv (which strips PII for Google Forms responses), the uploaded
// list is the user's OWN plaintext roster — name/phone are intended output, so every
// column is emitted. The caller passes the *already filtered + sorted* rows so the
// file matches exactly what is on screen (spec §6 CSV = 현재 보이는 rows). BOM + CRLF
// for Excel-Korean parity, same convention as responses-csv.ts.
function csvEscapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function uploadedListToCsv(
  columns: FormColumn[],
  rows: FormResponseRow[],
): string {
  const headers = columns.map((c) => c.title);
  const lines = [headers.map(csvEscapeCell).join(',')];
  for (const r of rows) {
    const cells = columns.map((c) => r.answers[c.questionId] ?? '');
    lines.push(cells.map(csvEscapeCell).join(','));
  }
  return '﻿' + lines.join('\r\n');
}
