// Recruiting roster export 렌더러 등록 — csv.
//
// 이동(move): CSV 직렬화(responsesToCsv)와 응답 정제(visibleFormResponses)는
// 이미 위젯(recruiting-card)·응답 라우트와 공유하는 단일 소스다. 단일 export
// 진입점은 form_id 로 서버에서 응답을 끌어와 같은 함수들에 통과시킨다 — 위젯의
// "CSV 다운로드" 와 동일 파이프라인(동의 게이트 + PII 컬럼 제외 + BOM/CRLF).

import { registerRenderer } from '@/lib/artifacts/export-registry';
import { getFormResponses } from '@/lib/google-forms';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { visibleFormResponses } from '@/lib/recruiting/form-responses';
import { csvFilename, responsesToCsv } from '@/lib/recruiting/responses-csv';

registerRenderer('recruiting', 'csv', async (row, ctx) => {
  // recruiting 스코프 컬럼 = user_id → ctx.scopeValue 가 소유자 검증에 필요한
  // user id. form_id = ctx.id.
  const access = await resolveFormAccess(ctx.id, ctx.scopeValue);
  if (!access.ok) {
    // 응답을 못 가져오면(구글 토큰 만료 등) export 불가 — 보수적으로 409.
    return { gate: 'not_ready' };
  }
  let visible;
  try {
    const result = await getFormResponses(access.accessToken, ctx.id);
    visible = visibleFormResponses(result);
  } catch {
    return { gate: 'not_ready' };
  }
  const csv = responsesToCsv(visible.columns, visible.rows);
  // 위젯과 동일: 폼 제목 + 오늘 날짜 스탬프. 제목은 라우트가 이미 조회한
  // 가벼운 행(recruiting_forms.title)에서 재사용.
  const title = typeof row.title === 'string' ? row.title : null;
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    body: csv,
    mime: 'text/csv; charset=utf-8',
    filename: csvFilename(title, stamp),
  };
});
