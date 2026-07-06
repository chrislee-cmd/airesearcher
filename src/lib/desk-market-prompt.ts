// Market mode 리포트 합성 prompt — 시장 규모(TAM/SAM) "참고 데이터 세트".
// 이 mode 의 핵심 원칙(사용자 확정 3): TAM/SAM 수치를 LLM 이 자동 계산·추정하지
// 않는다. 수집된 통계·공시·학술·뉴스 항목에서 **출처가 명확한 수치만** 표에
// 옮겨 담고, 근거가 없는 항목은 "데이터 확보 실패"로 표기한다. 사용자가 근거를
// 직접 확인한 뒤 시장 규모를 판단하도록 돕는 것이 목적이다.
//
// server 전용 — market.ts 만 import 한다. reportSystem(문자열)과 userMsg 빌더를
// 함께 두어 "무엇을 요구했는지(system) vs 무엇을 넣었는지(user)"를 한 파일에서
// 본다.

import { DESK_SOURCE_REGISTRY, type DeskSourceId } from '@/lib/desk-sources';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { ReportContext } from './desk-orchestrator/types';

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCE_REGISTRY[id]?.label ?? id;
}

// 수집 항목을 시장 리서치용 4 bucket 으로 접는다 — registry category(코드 SSOT)
// 에서 파생하며 LLM 이 재추론하지 않는다. TAM 근거(통계) / SAM 근거(공시) /
// 이론(학술) / 보조(뉴스) 로 나눠 리포트 prompt 가 근거 위계를 지키게 한다.
type MarketBucket = 'stats' | 'disclosure' | 'academic' | 'news';

const MARKET_BUCKET_ORDER: MarketBucket[] = [
  'stats',
  'disclosure',
  'academic',
  'news',
];

const MARKET_BUCKET_HEADING: Record<MarketBucket, string> = {
  stats: '📊 산업 통계 (KOSIS · ECOS) — TAM 근거',
  disclosure: '🏢 상장사 공시 (DART) — SAM 근거',
  academic: '🎓 산업 리포트 · 논문 (Semantic Scholar · KCI) — 이론 근거',
  news: '📰 시장 규모 언급 기사 (구글·네이버 뉴스) — 보조 근거',
};

function bucketOf(id: DeskSourceId): MarketBucket {
  if (id === 'dart') return 'disclosure';
  switch (DESK_SOURCE_REGISTRY[id]?.category) {
    case 'stats':
      return 'stats';
    case 'academic':
      return 'academic';
    default:
      return 'news';
  }
}

export const MARKET_REPORT_SYSTEM = `당신은 시장 규모(TAM/SAM) 리서치를 돕는 산업 애널리스트입니다. 입력으로 시장 키워드와, 통계·공시·학술·뉴스 출처에서 수집한 항목 목록(근거 위계별로 그룹핑됨)을 받습니다. 당신의 임무는 시장 규모를 **직접 추정하는 것이 아니라**, 출처가 명확한 수치를 골라 "참고 데이터 세트"로 정리하는 것입니다.

[절대 원칙 — 반드시 준수]
- **수치를 자동 계산·추정하지 않습니다.** "약 XXX로 추정된다", "대략 XXX 규모로 보인다" 같은 서술을 절대 쓰지 않습니다. 오직 수집 항목에 **명시된 수치**만 옮겨 담습니다.
- **모든 수치에는 출처를 강제**합니다. 각 수치 옆에 반드시 \`[발간처/매체명](URL)\` 형식의 inline citation 과, 확인 가능한 경우 발간일(연도·분기)을 함께 적습니다. 출처 없는 수치는 쓰지 않습니다.
- **근거가 없는 항목은 비워두지 말고 "데이터 확보 실패"로 명시**합니다 — 예: "국내 세부 시장 매출: 데이터 확보 실패 (이번 수집에서 근거 통계를 찾지 못했습니다)". 빈칸을 임의 수치로 채우지 않습니다.
- 본문은 정중한 **존댓말**('-입니다 / -합니다')로 작성합니다. raw URL 노출 금지 — 반드시 markdown 링크.
- 근거 위계: 공식 통계·공시(KOSIS / DART / 한국은행 ECOS) > 학술 리포트 > 언론 순으로 신뢰합니다. TAM 은 통계, SAM 은 공시를 우선 근거로 씁니다.

[필수 출력 구조 — 이 heading 순서를 그대로]
\`# 📊 시장 규모 참고 데이터\` — 키워드와 수집 기간을 표지에 한 줄로 표기합니다.

\`## TAM (Total Addressable Market)\`
전체 시장(산업 총 매출·생산·글로벌 규모)의 근거 수치를 불릿으로 정리합니다. 각 불릿 = "항목명 (출처·발간연도): 수치 [출처](URL)". 국내는 KOSIS, 글로벌은 뉴스/학술 인용을 우선합니다. 근거가 없으면 "데이터 확보 실패"를 명시합니다.

\`## SAM (Serviceable Available Market)\`
유효 시장(세부 카테고리 매출 + 주요 상장사 실적)의 근거 수치를 정리합니다. 상장사별 매출은 DART 공시 항목을 우선 인용합니다 (예: "아모레퍼시픽 2024 매출: XXX원 [DART 공시](URL)"). 근거가 없는 회사·항목은 "데이터 확보 실패"로 둡니다.

\`## 성장률 · 트렌드\`
CAGR·수출 성장률·전년 대비 증감 등 시간축 지표를 근거와 함께 정리합니다. 없으면 "데이터 확보 실패".

\`## 참고 리포트 · 논문\`
Semantic Scholar / KCI 등 산업 리포트·학술 논문을 3~5건 리스트로 정리합니다 (제목 + 인용 링크). 시장 규모 산정에 참고할 이론·방법론이 있으면 한 줄로 덧붙입니다.

\`## ⚠️ 데이터 한계 / 주의\` — 2~4개 불릿. **첫 불릿은 반드시** "본 TAM/SAM 수치는 확정값이 아니며, 사용자가 위 근거 데이터를 직접 확인한 뒤 판단해야 합니다"를 명시합니다. 이어서 데이터 공백 영역, 출처 신뢰도, 후속 확인이 필요한 지점을 적습니다 (이 섹션은 인용 없이 작성해도 됩니다).

요청 언어가 영어이면 heading 을 영어로 번역하되 이모지는 그대로 둡니다.${ISOLATION_NOTICE}`;

// 리포트 user 메시지 — 4 bucket 으로 그룹핑한 수집 항목 + 회사 축(DART 조회
// 대상 상장사)을 첨부한다. companies 는 runMarket 이 LLM 으로 뽑은 목록으로,
// SAM 섹션에서 어떤 회사 매출을 찾아 정리해야 하는지 LLM 에 알려준다.
export function buildMarketReportUserMsg(
  ctx: ReportContext,
  companies: string[],
): string {
  const { sampled, articles, similar, keywords, regions, range, locale } = ctx;

  const grouped = new Map<MarketBucket, typeof sampled>();
  for (const a of sampled) {
    const b = bucketOf(a.source);
    const bucket = grouped.get(b);
    if (bucket) bucket.push(a);
    else grouped.set(b, [a]);
  }

  let itemIdx = 0;
  const blocks = MARKET_BUCKET_ORDER.filter(
    (b) => (grouped.get(b)?.length ?? 0) > 0,
  ).map((b) => {
    const items = grouped.get(b) ?? [];
    const body = items
      .map((a) => {
        itemIdx += 1;
        const media = a.origin || sourceLabelKo(a.source);
        const lines = [
          `${itemIdx}. [${media}] ${a.title}`,
          `   url: ${a.url}`,
          a.publishedAt ? `   published: ${a.publishedAt}` : '',
          a.snippet ? `   snippet: ${a.snippet.slice(0, 200)}` : '',
        ].filter(Boolean);
        return lines.join('\n');
      })
      .join('\n\n');
    return `=== ${MARKET_BUCKET_HEADING[b]} (${items.length}건) ===\n${body}`;
  });

  return [
    `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
    `시장 키워드: ${keywords.join(', ')}`,
    `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
    `SAM 조회 대상 상장사(DART): ${
      companies.length ? companies.join(', ') : '(추출 실패 — 통계·뉴스 근거만 사용)'
    }`,
    `검색 지역: ${regions.join(', ')}`,
    `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
    `전체 수집: ${articles.length}건 (이 중 대표 ${sampled.length}건을 근거 위계별로 아래에 첨부)`,
    '',
    '--- 수집 항목 (근거 위계별 그룹핑 — 수치를 옮길 때 반드시 해당 항목의 출처를 인용하세요) ---',
    blocks.length ? blocks.join('\n\n') : '(수집 항목 없음 — 모든 항목을 "데이터 확보 실패"로 표기)',
  ].join('\n');
}
