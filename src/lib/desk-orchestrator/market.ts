// Market mode — 시장조사. 통계·공시를 위주로 시장 규모(TAM/SAM) "참고 데이터
// 세트"를 수집한다. 이 mode 의 핵심(사용자 확정): TAM/SAM 수치를 LLM 이 자동
// 계산하지 않고, 출처가 명확한 근거 데이터만 표+citation 으로 모아 사용자가
// 직접 판단하게 한다. 판단 근거(소스 선정 / 회사 축 / 제외 사유)는 AI 판단
// 로그 이벤트로 push 되어 보고서 상단 AiJudgmentLog 에 노출된다.
//
// 소스별 검색어 재작성(2026-07-06): 유저의 무분별한 자연어를 parseDeskQuery 가
// 한 번의 LLM 호출로 {phrases(뉴스형) / statTerms(통계 명사) / companies(사명)}
// 로 컴파일한다. 소스 클래스마다 알아듣는 형태가 달라서 — 한 키워드 세트를 전
// 소스에 던진 게 KOSIS 전멸의 구조 원인이었다.

import {
  DESK_SOURCE_REGISTRY,
  KR_ONLY_GROUPS,
  getEnabledSources,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';
import { warmDartCorps } from '@/lib/desk-sources/dart-corp';
import { warmDartFinancials } from '@/lib/desk-sources/dart-financials';
import { resolveSecCik, warmSecCorps } from '@/lib/desk-sources/sec-edgar-corp';
import { warmSecFinancials } from '@/lib/desk-sources/sec-edgar-financials';
import { parseDeskQuery } from '@/lib/desk-query-parse';
import {
  MACRO_ANCHORS,
  GLOBAL_MACRO_ANCHORS,
  OECD_ANCHORS,
  firstNounToken,
} from '@/lib/desk-source-classes';
import {
  MARKET_REPORT_SYSTEM,
  buildMarketReportUserMsg,
} from '@/lib/desk-market-prompt';
import {
  REGION_AWARE_SOURCES,
  type CrawlTask,
  type OrchestratorInput,
  type OrchestratorPlan,
  type ReportContext,
} from './types';

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCE_REGISTRY[id]?.label ?? id;
}

// 시장조사 소스 세트 — 통계(KOSIS/ECOS) · 공시(DART) · 학술(Semantic Scholar/
// KCI) · 뉴스(구글/네이버). YouTube · 산하 연구소 RSS · 커뮤니티는 트렌드 위주
// 라 제외한다. route.ts 는 market 소스를 pre-resolve 하지 않으므로(plan 에
// usableSources=[] 로 들어온다) 이 목록이 소스 SSOT 이고, env 가용성/region
// 필터도 여기서 직접 건다.
const MARKET_SOURCE_IDS: DeskSourceId[] = [
  'kosis',
  'atfis',
  'boj_ecos',
  'world_bank',
  'oecd',
  'dart',
  'sec_edgar',
  'semantic_scholar',
  'kci',
  'google_news',
  'naver_news',
];

const KOSIS: DeskSourceId = 'kosis';
const ATFIS: DeskSourceId = 'atfis';
const DART: DeskSourceId = 'dart';
const SEC_EDGAR: DeskSourceId = 'sec_edgar';
const ECOS: DeskSourceId = 'boj_ecos';
const WORLD_BANK: DeskSourceId = 'world_bank';
const OECD: DeskSourceId = 'oecd';

export async function runMarket(
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  const { keywords, regions, locale } = input;
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';

  // env 키가 갖춰진 소스만. KR 미포함 지역 조합이면 KR 전용 소스(통계·공시·
  // 국내 학술·네이버)는 결과가 0 이라 제외 (trend 의 effectiveSources 와 동일
  // 규칙, 단 pre-resolve 가 없어 env 필터를 여기서 함께 건다).
  const enabled = new Set(getEnabledSources());
  const effectiveSources = MARKET_SOURCE_IDS.filter((id) => {
    if (!enabled.has(id)) return false;
    const def = DESK_SOURCE_REGISTRY[id];
    // regionOnly 소스는 대상 region 과 교집합이 있을 때만 (SEC=US 전용, DART=KR
    // 전용 등). KR_ONLY_GROUPS 와 중복 커버되지만, US 전용 SEC 처럼 KR 축이 아닌
    // region-gated 소스를 일반적으로 걸러낸다.
    if (def?.regionOnly && !def.regionOnly.some((r) => regions.includes(r))) return false;
    if (regions.includes('KR')) return true;
    return !def?.group || !KR_ONLY_GROUPS.includes(def.group);
  });

  const hasKosis = effectiveSources.includes(KOSIS);
  const hasAtfis = effectiveSources.includes(ATFIS);
  const hasDart = effectiveSources.includes(DART);
  // SEC EDGAR = DART 의 미국 등가. effectiveSources 가 이미 US region 을 강제하므로
  // (regionOnly:['US']) 여기 포함되면 US 축이 확정된 것 — 별도 region gate 불필요.
  const hasSecEdgar = effectiveSources.includes(SEC_EDGAR);
  const hasEcos = effectiveSources.includes(ECOS);
  const hasWorldBank = effectiveSources.includes(WORLD_BANK);
  const hasOecd = effectiveSources.includes(OECD);
  // 뉴스형 phrase 로 검색하는 소스(학술·뉴스)만 (원+phrase) 키워드로 crawl.
  // KOSIS·aTFIS(통계 명사) · DART(회사명) · ECOS(거시 anchor) · World Bank/OECD
  // (글로벌 매크로 지표 앵커)는 아래에서 전용 검색어로 따로 건다 — 소스 클래스별
  // 검색어 분리가 이 mode 재작성의 핵심.
  const feedSources = effectiveSources.filter(
    (id) =>
      id !== KOSIS &&
      id !== ATFIS &&
      id !== DART &&
      id !== SEC_EDGAR &&
      id !== ECOS &&
      id !== WORLD_BANK &&
      id !== OECD,
  );

  // 자연어 → 소스별 검색어 컴파일(한 번의 LLM 호출) + DART 상장사 명부 warm-up
  // — 서로 독립이라 병렬.
  //
  // warm-up 이 필요한 이유: corpCode.xml(3.5MB)은 crawl task 의 15s 벽 안에서
  // 원거리 리전(iad1)이 받을 수 없다 (2026-07-06 market DART 전건 0건 회귀의
  // root cause — task 가 이 다운로드를 기다리다 잘렸고, 캐시도 영영 안 쌓였다).
  // task cap 이 없는 여기서 미리 받아 Supabase 캐시에 실으면, 각 DART task 는
  // 캐시 히트(~0.3s)로 즉시 회사를 특정한다. 실패해도 plan 은 계속 — 판단
  // 로그에 명부 준비 실패를 명시한다.
  // SEC EDGAR 명부(company_tickers.json) warm-up 도 DART 와 같은 이유로 병렬 —
  // companyfacts 는 payload 가 커 crawl task 15s 벽 안엔 timeout 위험이 크다.
  const [parsed, dartCorpCount, secCorpCount] = await Promise.all([
    parseDeskQuery(keywords, locale),
    hasDart ? warmDartCorps() : Promise.resolve(0),
    hasSecEdgar ? warmSecCorps() : Promise.resolve(0),
  ]);
  const { statTerms, companies, intent } = parsed;

  // 재무제표 warm-up — 회사 축이 정해진 뒤(명부 준비 후) 각 상장사의 재무제표를
  // orchestrator 단계(task cap 밖)에서 미리 받아 Supabase 캐시에 실는다. 이유:
  // fnlttSinglAcntAll 은 payload 가 커(~106KB) iad1→FSS 원거리에서 crawl task 15s
  // 벽 안엔 timeout 위험이 크다 — 여기서 넉넉한 timeout 으로 받아 캐시에 실으면 각
  // DART task 는 캐시 히트(~0.3s)로 즉시 매출·영업이익 등을 확보한다(2026-07-08
  // 진단: 농심·삼양 매출이 리포트에 '—' 로 뜬 건 데이터가 없어서가 아니라 무거운
  // 조회가 task 벽 안에서 실패해서였다). 명부 미준비면 skip — crawl 이 라이브 재시도.
  if (hasDart && companies.length && dartCorpCount > 0) {
    await warmDartFinancials(companies).catch(() => 0);
  }

  // SEC 재무 warm-up — 회사명을 CIK 로 해석한 뒤(명부 준비 후) companyfacts 를
  // orchestrator 단계(task cap 밖)에서 미리 받아 캐시에 실는다. resolveSecCik 은
  // warmSecCorps 가 채운 캐시/메모를 히트하므로 추가 다운로드가 없다. rate limit
  // (~10/s)은 warmSecFinancials 내부 동시성 제한(secThrottledAll)이 지킨다.
  if (hasSecEdgar && companies.length && secCorpCount > 0) {
    const secCorps = (
      await Promise.all(companies.map((name) => resolveSecCik(name).catch(() => null)))
    ).filter((c): c is NonNullable<typeof c> => c !== null);
    if (secCorps.length) {
      await warmSecFinancials(secCorps).catch(() => 0);
    }
  }

  // KOSIS 검색어 = stat_terms + 결정론 fallback 토큰(첫 명사). stat_terms 가
  // 비어도(파싱 실패/불명확) 최소한 fallback 으로 1회는 시도한다 (spec C —
  // "전부 0건 → 첫 명사 토큰 1회"를 upfront 결정론 포함으로 실현: KOSIS crawl 은
  // 값싸서 조건부 재시도 라운드 대신 항상 얹는 편이 recall·단순성에 유리).
  const fallbackTok = firstNounToken(keywords[0] ?? '');
  const kosisQueries = Array.from(
    new Set([...statTerms, fallbackTok].filter(Boolean)),
  );

  return {
    mode: 'market',
    parsed,
    buildJudgmentEvents: ({ similar }) => {
      const sourceList = effectiveSources.map(sourceLabelKo).join(' · ');
      const events: string[] = [
        `🎯 시장조사 mode — 통계·공시 위주로 시장 규모(TAM/SAM) 참고 데이터를 수집합니다. 수치는 확정값이 아닌 근거 데이터로만 제공합니다.`,
        `🔍 원 키워드: ${keywords.map((k) => `‘${k}’`).join(', ')}${intent ? ` (의도: ${intent})` : ''}`,
      ];
      // 소스별 검색어 재작성 내역을 항상 노출한다 — 유저가 "무슨 말로 검색됐는지"
      // 를 인지하고, 0건이어도 시도어를 병기해 정직하게 보이게 한다.
      if (hasKosis || hasAtfis || hasEcos) {
        events.push(
          kosisQueries.length
            ? `🧠 통계 검색용 변환 = ${kosisQueries.map((k) => `‘${k}’`).join(' · ')} — KOSIS·aTFIS 통계 카탈로그는 조사·수식어를 뗀 짧은 산업 명사로 검색합니다 (뉴스형 문장으로는 0건).`
            : `🧠 통계 검색용 명사를 뽑지 못했어요 — 통계 소스는 원 키워드로만 시도합니다.`,
        );
      }
      if (hasAtfis) {
        events.push(
          `🧠 aTFIS 식품산업통계 = 가공식품 세분시장 시장보고서(라면·음료·커피 등)를 세분시장 명칭으로 매칭해 소비재 TAM 근거로 씁니다 — KOSIS 정형 통계에 없는 식품 시장 규모의 1차 출처입니다.`,
        );
      }
      if (hasWorldBank || hasOecd) {
        const macroSrc = [hasWorldBank ? 'World Bank' : null, hasOecd ? 'OECD' : null]
          .filter(Boolean)
          .join(' · ');
        events.push(
          `🌐 글로벌 매크로 대비 기준선 = ${macroSrc} — 한국(기준축) + G7(미국·일본·독일·영국·프랑스·이탈리아·캐나다)의 GDP·산업 부가가치·인구를 명목 USD·동일 연도 기준으로 정규화해 "국내 vs G7 대비" 섹션·차트(한국 강조)를 만듭니다. 개별 시장(TAM) 수치가 아니라 국가 규모 컨텍스트이며, 모든 값은 소스 제공값 그대로(환산·정렬만 코드, 추정 없음)입니다.`,
        );
      }
      // 뉴스·학술 확장 축 = route 가 넘긴 similar (parsed.phrases, 파싱 실패 시
      // 일반 확장 fallback). 통계·회사 축과 별개 소스 클래스라 따로 노출한다.
      if (similar.length) {
        events.push(
          `🧠 뉴스·학술 확장 축 (broader/narrower/lateral) = ${similar.map((k) => `‘${k}’`).join(', ')} — 산업/회사/전망 각도로 함께 검색합니다.`,
        );
      }
      events.push(
        companies.length
          ? `🧠 회사 축 = DART 조회 대상 상장사 ${companies.join(' · ')} — SAM(유효 시장) 근거로 공시 매출을 찾습니다.`
          : `🧠 회사 축 = 대표 상장사 추출 실패 — 통계·뉴스 근거만으로 SAM 을 정리합니다 (임의 회사 생성 안 함).`,
      );
      if (hasDart) {
        events.push(
          !companies.length
            ? `🚫 DART = 조회할 상장사가 없어 이번엔 공시 수집을 건너뜁니다 (일반 키워드 공시 피드는 구조적으로 0건이라 시간을 낭비하지 않습니다).`
            : dartCorpCount > 0
              ? `🧠 DART 상장사 명부 ${dartCorpCount.toLocaleString()}건 준비 완료 — 회사별 사업보고서 매출을 직접 조회합니다.`
              : `🚫 DART 상장사 명부 준비 실패 — 회사별 매출 조회 정확도가 낮아질 수 있습니다.`,
        );
      }
      if (hasSecEdgar) {
        events.push(
          !companies.length
            ? `🚫 SEC EDGAR = 조회할 미국 상장사가 없어 이번엔 재무 공시 수집을 건너뜁니다 (회사명 없이는 CIK 를 해석할 수 없습니다).`
            : secCorpCount > 0
              ? `🧠 SEC EDGAR 상장사 명부 ${secCorpCount.toLocaleString()}건 준비 완료 — 회사명→CIK→companyfacts XBRL 로 매출·영업이익·순이익 3개년(USD)을 직접 조회합니다 (DART 의 미국 등가).`
              : `🚫 SEC EDGAR 명부 준비 실패 — 미국 회사 재무 조회 정확도가 낮아질 수 있습니다.`,
        );
      }
      events.push(
        `📰 소스 선정 = ${sourceList || '(가용 소스 없음)'} — TAM=KOSIS·aTFIS·ECOS+뉴스 시장규모 / SAM=DART / 이론=학술 / 보조=뉴스.`,
        `🚫 제외 = YouTube · 산하 연구소 RSS · 커뮤니티 (트렌드 위주 — 시장 규모 산정 관련성 낮음).`,
        `🧠 TAM/SAM 수치는 자동 계산하지 않습니다 — 모든 수치에 출처(발간처·URL·발간일)를 강제하고, 근거 없는 항목은 “데이터 확보 실패”로 표기합니다.`,
      );
      return events;
    },
    buildCrawlTasks: ({ similar }) => {
      const tasks: CrawlTask[] = [];

      // 뉴스·학술 = (원 + 뉴스형 phrase) 키워드. similar = route 가 넘긴
      // parsed.phrases(파싱 실패 시 일반 확장 fallback). region-aware 소스(구글
      // 뉴스)만 region 마다 별도 crawl, 나머지는 대표 region 한 번.
      const feedKeywords = [...keywords, ...similar];
      const targets: { src: DeskSourceId; region: DeskRegion }[] = [];
      for (const src of feedSources) {
        if (REGION_AWARE_SOURCES.has(src)) {
          for (const r of regions) targets.push({ src, region: r });
        } else {
          targets.push({ src, region: primaryRegion });
        }
      }
      for (const kw of feedKeywords) {
        for (const { src, region } of targets) {
          tasks.push({ source: src, keyword: kw, region });
        }
      }

      // KOSIS = 통계 카탈로그. 짧은 산업 명사(stat_terms + fallback 토큰)로만
      // 검색한다 — 뉴스형 phrase 는 전멸이라 전달하지 않는다. KR 전용.
      if (hasKosis) {
        for (const q of kosisQueries) {
          tasks.push({ source: KOSIS, keyword: q, region: 'KR' });
        }
      }

      // aTFIS = 가공식품 세분시장 시장보고서 카탈로그. KOSIS 와 같은 짧은 산업
      // 명사 축으로 조회한다 — 소스가 세분시장 명칭(라면↔면류)으로 게이트하므로
      // 문장형 phrase 는 불필요. 소비재 식품 TAM 은 KOSIS 에 없고 여기가 1차
      // 출처라 통계 bucket 을 보강한다. KR 전용. (검색 파라미터가 무력이라 소스
      // 내부에서 목록을 캐시해 kosisQueries 여러 건이어도 실제 네트워크는 1회.)
      if (hasAtfis) {
        for (const q of kosisQueries) {
          tasks.push({ source: ATFIS, keyword: q, region: 'KR' });
        }
      }

      // DART = 공시는 회사명 검색이 정확하므로 회사 축을 검색어로 쓴다. 회사가
      // 없으면 DART 자체를 건너뛴다 — 일반 키워드 공시 피드 필터는 구조적으로
      // 0건이라(전문검색 없음) 원 키워드 fallback 을 강등/제거한다(spec 결정 2).
      // DART 는 KR 전용이라 region 고정.
      if (hasDart && companies.length) {
        for (const q of companies) {
          tasks.push({ source: DART, keyword: q, region: 'KR' });
        }
      }

      // SEC EDGAR = 미국 상장사 공시. DART 와 동일하게 회사 축을 검색어로 쓰되
      // region 은 US 고정(regionOnly:['US']). 회사가 없으면 건너뛴다 — 회사명
      // 없이 SEC 를 조회할 방법이 없다(CIK 해석 불가).
      if (hasSecEdgar && companies.length) {
        for (const q of companies) {
          tasks.push({ source: SEC_EDGAR, keyword: q, region: 'US' });
        }
      }

      // ECOS = 거시 경제통계라 시장 키워드로는 매칭 0. 고정 거시 anchor(환율/
      // GDP/물가)로 조회해 글로벌 환산·경제지표 근거를 확보한다. KR 전용.
      if (hasEcos) {
        for (const anchor of MACRO_ANCHORS) {
          tasks.push({ source: ECOS, keyword: anchor, region: 'KR' });
        }
      }

      // World Bank/OECD = 초국가 글로벌 매크로. 시장 키워드가 아니라 국가 규모·
      // 산업 대분류 지표 앵커(gdp/industry/population)로 G7 전체를 한 번에 받아
      // "대비 기준선"을 만든다. region 무관(소스가 자체적으로 G7 을 조회)이라 대표
      // region 으로 고정 — 한 앵커당 1 task(멀티국가 응답)라 task cap 안전.
      if (hasWorldBank) {
        for (const anchor of GLOBAL_MACRO_ANCHORS) {
          tasks.push({ source: WORLD_BANK, keyword: anchor, region: primaryRegion });
        }
      }
      if (hasOecd) {
        for (const anchor of OECD_ANCHORS) {
          tasks.push({ source: OECD, keyword: anchor, region: primaryRegion });
        }
      }
      return tasks;
    },
    reportSystem: MARKET_REPORT_SYSTEM,
    buildReportUserMsg: (ctx: ReportContext) =>
      buildMarketReportUserMsg(ctx, companies),
  };
}
