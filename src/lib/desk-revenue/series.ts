// "주요 기업 매출" 차트 빌더 — **코드 정규화, LLM 파싱 없음** (#461).
//
// 입력 = 수집된 DeskArticle 풀. DART 매출 headline article 이 article.financials
// 에 실어 보낸 구조화 매출 시계열(당기/전기/전전기 원값)만 골라, 회사별 3개년
// 추이 + YoY 를 클라이언트 차트가 렌더만 하면 되도록 미리 포맷·계산해 넘긴다.
// 값은 공시 원값 그대로 — 조/억 축약 표기(formatKrwAmount)와 YoY(yoyPct)만 코드가
// 하고 수치는 절대 만들지 않는다(정책: 추정 X, 표와 항상 일치).
//
// #461 설계: comparison.ts(국내 vs G7 대비 차트)와 동일한 "구조화 값 → 코드 차트"
// 패턴. 반환값은 route 가 job.analytics.revenueSeries 로 실어 desk-report-view 가
// "주요 기업 매출" 섹션 상단에 grouped bar 로 렌더한다.
//
// graceful degrade: DART 매출 구조화 값이 없거나(비-market / DART 미수집) 모든
// 기간이 결측인 회사만 있으면 빈 배열 — 차트 없이 wide 테이블만 정상 렌더된다.

import type { DeskArticle } from '@/lib/desk-sources/types';
import {
  formatKrwAmount,
  yoyPct,
  type DartPeriodValue,
} from '@/lib/desk-sources/dart-financials';
import type { DeskRevenueSeries } from '@/components/desk-job-provider';

// 회사당 하나의 매출 시계열로 접는다. 같은 회사가 여러 DART article 로 들어오면
// 첫 매출 headline(financials 실린 것)만 쓴다. 모든 기간이 결측인 회사는 차트에서
// 제외하고(테이블이 "데이터 확보 실패"로 정직 표기) 값이 하나라도 있는 회사만 그린다.
export function buildRevenueSeries(articles: DeskArticle[]): DeskRevenueSeries[] {
  const seen = new Set<string>();
  const out: DeskRevenueSeries[] = [];

  for (const a of articles) {
    const fin = a.financials;
    if (!fin) continue;
    if (seen.has(fin.company)) continue;
    seen.add(fin.company);

    // 연도 오름차순(과거→최신)으로 정렬 — bar 가 좌→우로 추이를 이루게 한다.
    const asc = [...fin.periods].sort((p, q) => p.year - q.year);
    const periods = asc.map((p, i) => {
      const prev = i > 0 ? asc[i - 1] : null;
      // YoY = 직전(더 과거) 기간 대비. dart-financials 의 정책(누적기준 불일치·
      // 전기 ≤ 0·결측이면 null)을 그대로 재사용해 표의 YoY 와 완전히 동일하게 한다.
      const yoy =
        prev !== null
          ? yoyPct(
              toPeriodValue(p),
              toPeriodValue(prev),
            )
          : null;
      return {
        year: p.year,
        amount: p.amount,
        display: p.amount !== null ? formatKrwAmount(p.amount) : null,
        yoyPct: yoy,
      };
    });

    // 값이 하나라도 있어야 그린다(전부 결측이면 제외 — 테이블만 실패 표기).
    if (!periods.some((p) => p.amount !== null)) continue;

    out.push({ company: fin.company, sourceUrl: fin.sourceUrl, periods });
  }

  return out;
}

// DeskRevenueObservation.periods → yoyPct 가 받는 DartPeriodValue 로 어댑트.
// yoyPct 는 amount·cumulative 만 보므로 label 은 표시용 빈 값으로 채운다.
function toPeriodValue(p: {
  year: number;
  amount: number | null;
  cumulative: boolean;
}): DartPeriodValue {
  return { year: p.year, label: '', amount: p.amount, cumulative: p.cumulative };
}
