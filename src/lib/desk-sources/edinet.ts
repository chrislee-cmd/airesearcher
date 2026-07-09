// EDINET (일본 전자공시 api.edinet-fss.go.jp v2) — 일본 상장사 재무 공시(XBRL).
// **DART 소스 모듈(`dart.ts`)의 일본 등가**. market mode 의 회사 축(companies)이 일본
// 회사명이면 EDINETコード로 특정하고, 최근 공시 창 인덱스에서 최신 정기報告書 docID 를
// 얻어 CSV(XBRL_TO_CSV)로 재무(매출·영업이익·순이익·자산·부채·자본 3개년 + YOY,
// JPY 원값 + USD 근사)를 뽑는다. JP 전용. 실패 시 조용한 0 대신 사유 article 을 흘려
// 보고서 LLM 이 임의 수치를 지어내지 않게 한다(DART/SEC 와 동일 정책).
//
// ⚠️ 보수적 설계(§PR): EDINET v2 는 회사-인덱스 조회가 없어 warm-up 이 최근 공시 창을
// 스윕해 EDINETコード→docID 인덱스를 만든다. 그 창 밖에 최신 보고서가 있는 회사는
// 재무 대신 공시 링크로 degrade(사유 병기). EDINET_API_KEY 미설정 시에도 사유 노출.

import { env } from '@/env';
import { cleanApiKey } from './helpers';
import type { DeskArticle, DeskSourceDefinition } from './types';
import {
  edinetRosterSize,
  resolveEdinetCorp,
  resolveEdinetDoc,
  type EdinetCorp,
} from './edinet-corp';
import {
  edinetYoyPct,
  fetchEdinetFinancials,
  formatEdinetAmount,
  type EdinetFinancialsFailReason,
  type EdinetMetric,
} from './edinet-financials';

const FAIL_KO: Record<EdinetFinancialsFailReason, string> = {
  timeout: '조회 시간 초과',
  no_report: '공시 없음',
  api_error: 'API 오류',
};

function tierKo(tier: EdinetMetric['tier']): string {
  return tier === 1 ? 'XBRL 요소ID' : '라벨 매칭';
}

// 3개년 시계열 → 보고서 LLM 이 그대로 옮길 문자열. 연도별 JPY(+USD 근사) + 코드 계산
// YOY(▲/▼). 결측 연도는 "데이터 확보 실패", 계산 불가 YOY 는 "—"(#457 미러).
function formatMetricSeries(m: EdinetMetric): string {
  return m.periods
    .map((p, i) => {
      if (p.amount === null) return `${p.year}년 데이터 확보 실패`;
      const prev = m.periods[i + 1];
      const yoy = prev ? edinetYoyPct(p, prev) : null;
      const yoyStr =
        yoy === null ? ' (YoY —)' : ` (YoY ${yoy >= 0 ? '▲' : '▼'}${Math.abs(yoy).toFixed(1)}%)`;
      return `${p.year}년 ${formatEdinetAmount(p.amount)}${yoyStr}`;
    })
    .join(' · ');
}

// EDINET 문서 뷰어(신 EDINET 문서 경로) — 사용자가 원문 XBRL/PDF 를 직접 검증.
function documentUrl(docID: string): string {
  return `https://disclosure2.edinet-fss.go.jp/document/${docID}`;
}
// 회사 공시 검색 진입(문서 링크가 없을 때 degrade 대상).
function searchUrl(corp: EdinetCorp): string {
  const q = corp.secCode ? corp.secCode.replace(/0$/, '') : corp.name;
  return `https://disclosure2.edinet-fss.go.jp/?q=${encodeURIComponent(q)}`;
}

export const edinet: DeskSourceDefinition = {
  id: 'edinet',
  category: 'stats',
  group: 'edinet',
  label: 'EDINET 공시',
  labelEn: 'EDINET (Japan Filings)',
  hint: '일본 상장사 재무(XBRL) — DART 의 일본 등가',
  regionOnly: ['JP'],
  // EDINET v2 는 subscription key 필수라 envKeys 게이트를 건다 — 미설정 시 소스 자동
  // 비활성(무음 아님: getEnabledSources 가 drop, 배너가 no_key 로 노출).
  envKeys: ['EDINET_API_KEY'],
  async fetch({ keyword }) {
    const key = cleanApiKey(env.EDINET_API_KEY);
    if (!key) return [];

    // market mode 는 EDINET 에 회사명(companies 축)만 보낸다. EDINETコード로 특정하고,
    // 실패해도 조용히 비우지 않고 사유를 남긴다(DART/SEC 와 동일 정책).
    let corp: EdinetCorp | null = null;
    try {
      corp = await resolveEdinetCorp(keyword);
    } catch (err) {
      console.error('[edinet] resolve failed', err);
    }

    if (!corp) {
      const rosterSize = await edinetRosterSize();
      console.info(
        `[desk-debug] edinet — name=${keyword} corp=unresolved roster=${rosterSize}`,
      );
      if (rosterSize <= 0) return []; // 명부 미준비 = root cause 다름(판단 로그가 노출).
      return [
        {
          source: 'edinet',
          title: `${keyword} — EDINET 공시 없음 (일본 미상장 추정)`,
          url: `https://disclosure2.edinet-fss.go.jp/?q=${encodeURIComponent(keyword)}`,
          snippet: `‘${keyword}’ 은 EDINET 제출자 명부(~${rosterSize.toLocaleString()}건)에서 찾지 못했습니다. 일본 미상장·미등록이면 EDINET 공시 대상이 아니라 재무 공시가 없습니다. 수치를 임의로 채우지 말고 “공시 없음(미상장 추정)”으로 표기하세요.`,
          origin: keyword,
          keyword,
        },
      ];
    }

    const codeLabel = corp.secCode ? `${corp.name}(${corp.secCode.replace(/0$/, '')})` : corp.name;

    // 최근 공시 창 인덱스에서 회사의 최신 정기報告書 docID 를 얻는다(캐시 히트).
    const doc = await resolveEdinetDoc(corp.edinetCode);
    if (!doc) {
      console.info(
        `[desk-debug] edinet — name=${keyword} code=${corp.edinetCode} doc=none`,
      );
      return [
        {
          source: 'edinet',
          title: `${codeLabel} — EDINET 최근 공시 창 밖 (링크 확인)`,
          url: searchUrl(corp),
          snippet: `EDINET 제출자 명부 매칭 성공(EDINETコード=${corp.edinetCode}). 다만 최근 공시 스윕 창 안에서 정기報告書를 찾지 못했습니다(제출 시점이 창 밖). 매출 수치를 임의로 채우지 말고 링크에서 최신 有価証券報告書를 확인하세요.`,
          origin: corp.name,
          keyword,
        },
      ];
    }

    const finResult = await fetchEdinetFinancials(doc, corp.edinetCode, key);
    const url = documentUrl(doc.docID);

    if (!finResult.ok) {
      const reasonKo = FAIL_KO[finResult.reason];
      console.warn(
        `[edinet] financials lookup failed — code=${corp.edinetCode} docID=${doc.docID} reason=${finResult.reason}`,
      );
      return [
        {
          source: 'edinet',
          title: `${codeLabel} 매출 — 데이터 확보 실패 (${reasonKo})`,
          url,
          snippet: `EDINET 명부·문서 매칭 성공(docID=${doc.docID}), XBRL 재무 조회 단계에서 실패 — ${reasonKo}. 수치를 임의로 채우지 말고 “데이터 확보 실패 (${reasonKo})”로 표기하세요.`,
          origin: corp.name,
          keyword,
        },
      ];
    }

    const fin = finResult.financials;
    const fsKo = fin.consolidated ? '連結(연결)' : '個別(별도)';
    const out: DeskArticle[] = [];

    // (1) 매출 headline — pin 대상(kind:'metric'). market 샘플링이 뉴스 사이에서
    //     dropout 시키지 않게 한다(DART/SEC 매출 headline 과 동일 정책).
    const revenue = fin.metrics.find((m) => m.key === 'revenue');
    if (revenue) {
      out.push({
        source: 'edinet',
        title: `${codeLabel} ${fin.periodLabel} ${revenue.labelKo} ${formatEdinetAmount(revenue.amount)}`,
        url,
        snippet: `EDINET ${fin.periodLabel} 기준 ${revenue.tag} · ${fsKo} · ${tierKo(revenue.tier)} · 연도별 매출: ${formatMetricSeries(revenue)} (JPY 원값, USD 는 참조환율 근사)`,
        origin: corp.name,
        keyword,
        kind: 'metric',
      });
    } else {
      console.warn(
        `[edinet] revenue unmapped — code=${corp.edinetCode} docID=${doc.docID} fy=${fin.fiscalYear}`,
      );
      out.push({
        source: 'edinet',
        title: `${codeLabel} 매출 — 요소 미매핑 (${fin.periodLabel})`,
        url,
        snippet: `EDINET ${fin.periodLabel} 재무는 확보했으나 매출 요소를 특정하지 못했습니다. 수치를 임의로 채우지 말고 링크의 원문(有価証券報告書)을 확인하세요.`,
        origin: corp.name,
        keyword,
      });
    }

    // (1-b) 나머지 지표 — 지표별 근거 article. 매출만 pin(SAM 앵커 보호가 pin 의 본의).
    for (const m of fin.metrics) {
      if (m.key === 'revenue') continue;
      out.push({
        source: 'edinet',
        title: `${codeLabel} ${fin.periodLabel} ${m.labelKo} ${formatEdinetAmount(m.amount)}`,
        url,
        snippet: `EDINET ${fin.periodLabel} 기준 ${m.tag} · ${fsKo} · ${tierKo(m.tier)} · 연도별: ${formatMetricSeries(m)} (JPY 원값)`,
        origin: corp.name,
        keyword,
      });
    }

    console.info(
      `[desk-debug] edinet — name=${keyword} code=${corp.edinetCode} docID=${doc.docID} articles=${out.length}`,
    );
    return out;
  },
};
