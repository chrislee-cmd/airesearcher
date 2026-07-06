import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import { isPiiColumn } from '@/lib/recruiting-pii';

// 리크루팅 전체보기 응답을 CSV 로 직렬화한다.
//
// PII 컬럼(이름/전화)은 값 마스킹(••••)이 아니라 **컬럼 자체를 제외**해
// "no PII" 를 보장한다 — 마스킹 placeholder 조차 파일에 남기지 않는다.
// (뷰에서 이미 서버가 값을 blank 처리하지만, 방어적으로 title 기반으로도
// 한 번 더 걸러 스프레드시트 화면과 동일한 판정을 쓴다 — recruiting-pii 의
// isPiiColumn.) 제출시각 컬럼을 맨 앞에 붙여 응답 시점을 함께 내보낸다.
//
// Excel 의 한글 mojibake 방지를 위해 UTF-8 BOM 을 prepend, 줄바꿈은 CRLF —
// scheduler/csv.ts 의 attendeesToCsv 와 동일한 관행.

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function responsesToCsv(
  columns: FormColumn[],
  rows: FormResponseRow[],
): string {
  const cols = columns.filter((c) => !isPiiColumn(c.title));
  const headers = ['제출시각', ...cols.map((c) => c.title)];
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    const cells = [
      r.lastSubmittedTime ?? r.createTime ?? '',
      ...cols.map((c) => r.answers[c.questionId] ?? ''),
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// 다운로드 파일명 슬러그 — 한글은 유지하되 파일시스템 예약 문자만 제거.
export function csvFilename(title: string | null | undefined, stamp: string): string {
  const base = (title ?? '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  return `${base || '리크루팅 응답'}-${stamp}.csv`;
}
