import type { FormColumn, FormResponseRow, FormResponses } from '@/lib/google-forms';
import { filterConsentedRows, findConsentColumn } from '@/lib/recruiting/contact-filter';
import { maskPiiAnswers, piiQuestionIds } from '@/lib/recruiting-pii';

// 리크루팅 폼 응답의 "표시용" 투영 — 단일 소스.
//
// 원래 이 로직은 `GET /api/recruiting/google/forms/[formId]/responses` 라우트에
// 인라인돼 있었다. Export 레지스트리 도입으로, 위젯이 CSV 를 만들 때 쓰는
// 응답 라우트와 서버측 CSV 렌더러(신규 단일 export 진입점)가 **동일한** 정제
// 결과를 보도록 여기로 추출했다(두 경로 divergence 방지 = 출력 diff 0).
//
// 규칙(뷰·CSV 공통):
//  1) 미동의 응답 행 제거(consent 컬럼 없으면 legacy 폼이라 전체 통과).
//  2) consent 컬럼 자체는 숨김(모든 가시 행이 "동의합니다" 라 신호 0).
//  3) PII 컬럼(이름/전화/이메일 …)은 컬럼은 남기되 **값을 blank** — 실값은
//     크레딧 게이트 unlock 라우트로만 유출. (CSV 렌더러는 여기서 이미 blank 된
//     값 위에서 다시 컬럼째 제외하므로 파일에 PII placeholder 조차 안 남는다.)

export type VisibleFormResponses = {
  columns: FormColumn[];
  rows: FormResponseRow[];
  piiQuestionIds: string[];
  total: number;
  consented: number;
};

export function visibleFormResponses(result: FormResponses): VisibleFormResponses {
  const consentColumn = findConsentColumn(result.columns);
  const consentedRows = filterConsentedRows(result.rows, consentColumn);
  const visibleColumns = consentColumn
    ? result.columns.filter((c) => c.questionId !== consentColumn.questionId)
    : result.columns;
  const piiQids = new Set(piiQuestionIds(visibleColumns));
  const consentQid = consentColumn?.questionId;
  const masked = maskPiiAnswers(consentedRows, piiQids).map((r) => {
    if (!consentQid) return r;
    const answers = { ...r.answers };
    delete answers[consentQid];
    return { ...r, answers };
  });
  return {
    columns: visibleColumns,
    rows: masked,
    piiQuestionIds: [...piiQids],
    total: result.rows.length,
    consented: consentedRows.length,
  };
}
