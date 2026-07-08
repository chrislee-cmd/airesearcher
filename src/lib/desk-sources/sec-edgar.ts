// SEC EDGAR — 미국 상장사 재무 공시(XBRL). **DART 소스 모듈(`dart.ts`)의 미국 등가**.
// market mode 의 회사 축(companies)이 미국 회사명이면 CIK 로 특정해 companyfacts
// XBRL 재무(매출·영업이익·순이익·자산·부채·자본 3개년 + YOY)를 안정적으로 가져온다.
// US 전용, 키 없음(SEC fair-use — User-Agent 헤더만 필수). 실패 시 조용한 0 대신
// 사유를 담은 진단 article 을 흘려 보고서 LLM 이 임의 수치를 지어내지 않게 한다.

import type { DeskArticle, DeskSourceDefinition } from './types';
import { resolveSecCik, secRosterSize } from './sec-edgar-corp';
import {
  fetchSecFinancials,
  formatSecAmount,
  secYoyPct,
  type SecFinancialsFailReason,
  type SecMetric,
} from './sec-edgar-financials';

// 재무 조회 실패 사유 → 보고서 병기용 한국어 라벨 (DART REVENUE_FAIL_KO 미러 —
// "확보 실패" 단독 금지).
const SEC_FAIL_KO: Record<SecFinancialsFailReason, string> = {
  timeout: '조회 시간 초과',
  no_report: '공시 없음',
  api_error: 'API 오류',
};

// tier(어느 정규화 층) → 스니펫 병기용 라벨.
function tierKo(tier: SecMetric['tier']): string {
  return tier === 1 ? 'XBRL 표준태그' : tier === 2 ? '라벨 매칭' : 'LLM 태그 선택';
}

// 3개년(최신/전기/전전기) 시계열 → 보고서 LLM 이 그대로 옮길 문자열. 연도별 USD +
// **코드 계산 YOY**(▲/▼). 결측 연도는 "데이터 확보 실패", 계산 불가 YOY 는 "—".
// periods 는 내림차순이라 각 항목 YOY 는 자기 다음(더 과거) 기간과의 비교(#457 미러).
function formatMetricSeries(m: SecMetric): string {
  return m.periods
    .map((p, i) => {
      if (p.amount === null) return `FY${p.year} 데이터 확보 실패`;
      const prev = m.periods[i + 1];
      const yoy = prev ? secYoyPct(p, prev) : null;
      const yoyStr =
        yoy === null ? ' (YoY —)' : ` (YoY ${yoy >= 0 ? '▲' : '▼'}${Math.abs(yoy).toFixed(1)}%)`;
      return `FY${p.year} ${formatSecAmount(p.amount)}${yoyStr}`;
    })
    .join(' · ');
}

// EDGAR 회사 10-K 공시 목록 — 사용자가 원값·원문을 직접 검증할 수 있는 링크.
function filingsUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=40`;
}

export const secEdgar: DeskSourceDefinition = {
  id: 'sec_edgar',
  category: 'stats',
  group: 'sec',
  label: 'SEC EDGAR 공시',
  labelEn: 'SEC EDGAR (US Filings)',
  hint: '미국 상장사 재무(XBRL, 키 없이 동작)',
  regionOnly: ['US'],
  async fetch({ keyword }) {
    // market mode 는 SEC 에 회사명(companies 축)만 보낸다 — 이 keyword 는 항상 미국
    // 회사(또는 티커)로 간주된다. CIK 로 특정해 재무를 조회하고, 실패해도 조용히
    // 비우지 않고 사유를 남긴다(무음 0건 금지 — DART 와 동일 정책).
    let corp: Awaited<ReturnType<typeof resolveSecCik>> = null;
    try {
      corp = await resolveSecCik(keyword);
    } catch (err) {
      console.error('[sec-edgar] resolve failed', err);
    }

    // corp 미해석 — 명부 미준비(warm-up/캐시 미스)인지 미등록(비상장·외국)인지 가른다.
    if (!corp) {
      const rosterSize = await secRosterSize();
      console.info(
        `[desk-debug] sec-edgar — name=${keyword} corp=unresolved roster=${rosterSize}`,
      );
      // 명부 미준비면 root cause 가 달라 라벨을 붙이지 않는다(판단 로그가 노출).
      if (rosterSize <= 0) return [];
      // 명부는 준비됐는데 못 찾음 = 미국 상장사가 아님 → 진단 사유 흘려보내기.
      return [
        {
          source: 'sec_edgar',
          title: `${keyword} — SEC EDGAR 공시 없음 (미국 미상장 추정)`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(keyword)}&type=10-K`,
          snippet: `‘${keyword}’ 은 SEC EDGAR 상장사 명부(~${rosterSize.toLocaleString()}건)에서 찾지 못했습니다. 미국 미상장·비상장이면 SEC 공시 대상이 아니라 재무 공시가 없습니다. 수치를 임의로 채우지 말고 “공시 없음(미상장 추정)”으로 표기하세요.`,
          origin: keyword,
          keyword,
        },
      ];
    }

    const finResult = await fetchSecFinancials(corp.cik, corp.title);
    const url = filingsUrl(corp.cik);

    if (!finResult.ok) {
      const reasonKo = SEC_FAIL_KO[finResult.reason];
      console.warn(
        `[sec-edgar] financials lookup failed — cik=${corp.cik} name=${corp.title} reason=${finResult.reason}`,
      );
      return [
        {
          source: 'sec_edgar',
          title: `${corp.title} 매출 — 데이터 확보 실패 (${reasonKo})`,
          url,
          snippet: `SEC EDGAR 명부 매칭 성공(CIK=${corp.cik}), companyfacts 재무 조회 단계에서 실패 — ${reasonKo}. 수치를 임의로 채우지 말고 “데이터 확보 실패 (${reasonKo})”로 표기하세요.`,
          origin: corp.title,
          keyword,
        },
      ];
    }

    const fin = finResult.financials;
    const entity = fin.entityName || corp.title;
    const out: DeskArticle[] = [];

    // (1) 매출 headline — pin 대상(kind:'metric'). market 샘플링이 뉴스 사이에서
    //     dropout 시키지 않게 한다(DART 매출 headline 과 동일 정책).
    const revenue = fin.metrics.find((m) => m.key === 'revenue');
    if (revenue) {
      out.push({
        source: 'sec_edgar',
        title: `${entity} ${fin.periodLabel} ${revenue.labelEn} ${formatSecAmount(revenue.amount)}`,
        url,
        snippet: `SEC EDGAR ${fin.periodLabel} 기준 ${revenue.tag} · ${tierKo(revenue.tier)} · 연도별 매출: ${formatMetricSeries(revenue)} (USD)`,
        origin: entity,
        keyword,
        kind: 'metric',
      });
    } else {
      console.warn(
        `[sec-edgar] revenue unmapped — cik=${corp.cik} name=${entity} fy=${fin.fiscalYear}`,
      );
      out.push({
        source: 'sec_edgar',
        title: `${entity} 매출 — 태그 미매핑 (${fin.periodLabel})`,
        url,
        snippet: `SEC EDGAR ${fin.periodLabel} 재무는 확보했으나 매출 태그를 특정하지 못했습니다. 수치를 임의로 채우지 말고 링크의 원문(10-K)을 확인하세요.`,
        origin: entity,
        keyword,
      });
    }

    // (1-b) 나머지 지표 — 지표별 근거 article. 매출만 pin 대상으로 두고(over-pin
    //       방지 — SAM 앵커 보호가 pin 의 본의) 이들은 일반 근거로 흘린다.
    for (const m of fin.metrics) {
      if (m.key === 'revenue') continue;
      out.push({
        source: 'sec_edgar',
        title: `${entity} ${fin.periodLabel} ${m.labelEn} ${formatSecAmount(m.amount)}`,
        url,
        snippet: `SEC EDGAR ${fin.periodLabel} 기준 ${m.tag} · ${tierKo(m.tier)} · 연도별: ${formatMetricSeries(m)} (USD)`,
        origin: entity,
        keyword,
      });
    }

    console.info(`[desk-debug] sec-edgar — name=${keyword} cik=${corp.cik} articles=${out.length}`);
    return out;
  },
};
