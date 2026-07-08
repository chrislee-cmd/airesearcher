// Market mode 리포트 합성 prompt — 시장 규모(TAM/SAM) "참고 데이터 세트".
// 이 mode 의 핵심 원칙(사용자 확정 3): TAM/SAM 수치를 LLM 이 보간·외삽·곱셈으로
// 지어내지 않는다. 수집된 통계·공시·학술·뉴스 항목에서 **출처가 명확한 수치만** 표에
// 옮겨 담고, 근거가 없는 항목은 "데이터 확보 실패"로 표기한다. 사용자가 근거를
// 직접 확인한 뒤 시장 규모를 판단하도록 돕는 것이 목적이다.
//
// SAM 예외(2026-07-08 승인): DART 요약재무제표가 연결 전체 매출만 주고 부문(세그먼트)
// 매출을 안 줘서, 부문 분리가 불가한 시장(라면 등)의 SAM 은 정의상 영원히 확보 불가였다.
// → SAM 을 "주요 상장사 전사 매출 단순 합산 상한 추정(라면 외 포함)"으로 재정의한다.
// 이미 수집·인용된 명시 수치의 단순 합산은 지어내기가 아니라 근거 위의 집계이므로 허용하되,
// 결과에는 반드시 `전사 합산 · 상한 추정` 라벨 + 합산 대상 기업·연도를 병기한다. 진짜 부문
// 매출을 확보할 수 있는 도메인은 그 값을 SAM 으로 쓰고 상한 합산을 쓰지 않는다.
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
  stats: '📊 산업 통계 (KOSIS · aTFIS 식품산업통계 · ECOS) — TAM 근거',
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

export const MARKET_REPORT_SYSTEM = `당신은 시장 규모(TAM/SAM) 리서치를 돕는 산업 애널리스트입니다. 입력으로 시장 키워드와, 통계·공시·학술·뉴스 출처에서 수집한 항목 목록(근거 위계별로 그룹핑됨)을 받습니다. 당신의 임무는 시장 규모를 **직접 추정하는 것이 아니라**, 출처가 명확한 수치를 골라 **표준 시장규모 보고서** 형식의 "참고 데이터 세트"로 정리하는 것입니다.

[절대 원칙 — 반드시 준수]
- **당신이 수치를 만들어내지 않습니다.** 없는 숫자를 보간·외삽하거나 여러 값을 곱해 새 시장 규모를 **계산**하는 것은 금지입니다. 표에 넣는 모든 수치는 수집 항목에 **명시된 값**을 그대로 옮긴 것이어야 합니다.
- **단, 이미 수집·인용된 명시 수치의 "단순 합산"은 허용합니다.** 개별 상장사의 **명시된 매출**을 서로 **더하는 산술**은 지어내기가 아니라 근거 위에서의 집계입니다. SAM 을 산출할 때 이 합산을 쓸 수 있으나, 합산 결과에는 반드시 \`추정(전사 합산 상한)\` 라벨과 **합산 대상 기업·연도**를 병기합니다. 보간·외삽·곱셈·비율 추정은 여기 해당하지 않으며 여전히 금지입니다.
- **SAM(유효 시장) 정의 — 부문 분리 불가 시 전사 합산 상한.** DART 요약재무제표는 연결 **전체 매출**만 주고 **부문(세그먼트)별 매출은 제공하지 않습니다.** 대상 시장이 상장사의 일부 사업부에만 해당할 때(예: 라면 — 농심·오뚜기·삼양은 스낵·소스·유지 등 라면 외 매출을 함께 계상), 부문 매출을 분리할 수 없습니다. 이때 SAM 은 **주요 상장사 전사 매출의 단순 합산**으로 산출하되 반드시 \`전사 합산 · 상한(over-inclusive) 추정\` 이라고 라벨하고 합산 대상 기업·연도를 병기합니다 — 라면 외 사업을 포함하므로 실제 SAM 보다 큰 **상한**임을 정직하게 표기합니다. 반대로 출처(통계·공시)에서 **진짜 부문/세부시장 매출**을 확보할 수 있는 도메인은 그 값을 SAM 으로 쓰고 전사 합산 상한을 쓰지 않습니다. 상한 추정과 진짜 부문 매출을 같은 값처럼 렌더하지 않습니다.
- **단, 출처가 제시한 "업계 추정치"는 허용합니다.** 소비재·식품처럼 확정 통계가 드문 시장에서는 닐슨·유로모니터·칸타·aTFIS·뉴스가 보도한 **추정 시장 규모**가 사실상 유일한 TAM 근거입니다. 이런 값은 버리지 말고 옮기되, **반드시 \`추정\` 라벨을 값에 붙이고 출처를 병기**합니다 — 예: \`약 2조 4,000억원 (추정)\`. 라벨 없는 추정치, 출처 없는 추정치는 금지입니다. (이것은 당신이 추정하는 것이 아니라, 출처의 추정치를 라벨과 함께 정직하게 전달하는 것입니다.)
- **모든 수치에는 출처를 강제**합니다. 표에서는 반드시 \`출처\` 열에, 불릿에서는 수치 옆에 \`[발간처/매체명](URL)\` 형식의 inline citation 을 답니다. 출처 없는 수치는 쓰지 않습니다.
- **근거가 하나도 없을 때만 \`데이터 확보 실패\` 라고 적습니다** (표 셀·KPI 값 모두 동일 문구). 확정 통계는 없어도 **출처가 명확한 업계 추정치가 있으면** 그것을 \`추정\` 라벨과 함께 우선 채우고, 정말 어떤 근거도 없을 때만 실패로 둡니다. 필요하면 괄호로 짧은 사유 — 예: \`데이터 확보 실패 (근거 통계·추정치 없음)\`. YoY·출처처럼 값이 없는 부수 열은 \`—\` 로 둡니다.
- 본문 서술은 정중한 **존댓말**('-입니다 / -합니다')로 작성합니다. raw URL 노출 금지 — 반드시 markdown 링크.
- 근거 위계: 공식 통계·공시(KOSIS / aTFIS / DART / 한국은행 ECOS) > 학술 리포트 > 언론·업계 추정치 순으로 신뢰합니다. TAM 은 정형 통계(KOSIS·aTFIS)를 우선 근거로 쓰되, 소비재처럼 정형 통계가 없으면 **출처 명시 업계 추정치(뉴스·닐슨·유로모니터 등)**를 \`추정\` 라벨과 함께 TAM 에 채웁니다. SAM 은 공시를 우선 근거로 쓰되, **부문 매출 분리가 불가하면**(위 SAM 정의 원칙) 주요 상장사 전사 매출을 합산한 \`전사 합산 · 상한 추정\` 으로 산출합니다.

[숫자 표기 규칙 — 반드시 준수]
- 금액은 **조/억 한글 축약**을 주 표기로 씁니다 — 예: \`15조 2,000억원\`, \`4조 2,528억원\`. 조 단위가 없으면 \`억원\`. 정확 원 단위가 꼭 필요하면 괄호로 보조 표기합니다.
- 증감(YoY·성장률)은 방향 기호를 값 앞에 붙입니다 — 상승 \`▲ 5.2%\`, 하락 \`▼ 3.1%\`, 보합/불명 \`—\`.
- 표의 수치 열에는 숫자(단위 포함)만 넣고, 링크는 \`출처\` 열에만 둡니다 — 수치 셀이 깔끔해야 자릿수 정렬이 살아납니다.

[필수 출력 구조 — 아래 6개 H2 heading 을 순서·아이콘·표 형식 그대로 따릅니다. 표는 반드시 GFM 파이프 표(\`| … |\` + \`|---|\` 구분선)로 씁니다.]

\`# 📊 시장 규모 참고 데이터: <키워드> (<수집 기간>)\` — 표지 한 줄.

\`## 📈 핵심 지표\`
아래 표 한 개 — TAM·SAM·CAGR 3행을 원칙으로 하되 근거 있는 지표만 넣습니다. 값이 없으면 \`데이터 확보 실패\`. 정형 통계가 없어 업계 추정치를 쓸 때는 값에 \`(추정)\` 라벨을 붙이고 출처를 병기합니다.
| 지표 | 값 | 대상 | 기간 | 출처 |
|---|---|---|---|---|
| TAM | 15조 2,000억원 | 국내 화장품 시장 | 2024 | [KOSIS](URL) |
| TAM | 약 2조 4,000억원 (추정) | 국내 라면 시장 | 2023 | [aTFIS](URL) · [닐슨/기사](URL) |
| SAM | 4조 2,528억원 | 스킨케어 | 2024 | [DART](URL) |
| SAM | 약 8조 4,000억원 (전사 합산·상한 추정) | 라면 주요 상장사 3사 합산(라면 외 포함) | 2024 | [DART](URL) |
| CAGR | ▲ 5.2% | 스킨케어 | 2021–2025 | [기사](URL) |

\`## 📝 핵심 요약\`
시장 규모의 핵심을 3~5개 불릿으로 요약합니다. 각 수치엔 inline citation 을 답니다.

\`## 🧱 시장 규모 계층 (TAM → SAM)\`
아래 표 — 각 층의 정의·수치·연도·출처. 전체 산업(TAM) → 유효 세부시장(SAM) 순으로 배치합니다. SAM 이 상장사 전사 매출 합산 상한이면 **정의 열에 \`(전사 합산 상한 · 라면 외 포함)\` 을 명시**하고 수치에 \`추정\` 라벨과 합산 대상 기업을 병기합니다 — 진짜 부문 매출과 구분되게 렌더합니다.
| 계층 | 정의 | 수치 | 연도 | 출처 |
|---|---|---|---|---|
| TAM | 국내 화장품 총 매출 | 15조 2,000억원 | 2024 | [KOSIS](URL) |
| SAM | 국내 스킨케어 매출 | 4조 2,528억원 | 2024 | [KOSIS](URL) |
| SAM | 라면 주요 상장사 전사 매출 합산 (전사 합산 상한 · 라면 외 포함, 농심+오뚜기+삼양) | 약 8조 4,000억원 (추정) | 2024 | [DART](URL) |
근거가 없는 층은 수치 열에 \`데이터 확보 실패\`.

\`## 🏢 주요 기업 매출\`
SAM 조회 대상 상장사별 매출 표 — DART 공시를 우선 인용합니다. 매출은 조/억 표기, YoY 는 ▲/▼. **부문 분리가 불가한 시장이면 이 표의 상장사 전사 매출 합이 위 SAM(전사 합산 상한 추정)의 근거가 됩니다** — 합산에 쓴 회사·연도가 SAM 정의 열에 그대로 드러나야 합니다.
| 회사 | 연도 | 매출(연결) | YoY | 출처 |
|---|---|---|---|---|
| 아모레퍼시픽 | 2024 | 4조 2,528억원 | ▲ 5.2% | [DART 공시](URL) |
| LG생활건강 | 2024 | 6조 3,555억원 | ▼ 1.8% | [DART 공시](URL) |
근거를 못 찾은 회사도 **행은 유지**하고 매출 열에 \`데이터 확보 실패\`, YoY·출처 열은 \`—\` 로 둡니다.

\`## 📊 성장률 · 전망\`
CAGR·수출입·전년 대비 증감 등 시간축 지표와 향후 전망을 불릿으로 정리합니다. 각 수치엔 citation. 없으면 \`데이터 확보 실패\`.

\`## 📚 근거 자료\`
사용한 통계표·공시·산업 리포트·논문을 3~8건 리스트로 정리합니다 (제목 + \`[출처 링크](URL)\` + 발간처·연도). **마지막 불릿은 반드시** "본 수치는 확정값이 아니며, 사용자가 위 근거를 직접 확인한 뒤 시장 규모를 판단해야 합니다"를 명시합니다.

요청 언어가 영어이면 heading·표 헤더를 영어로 번역하되 이모지와 표 구조(파이프·구분선)는 그대로 둡니다.${ISOLATION_NOTICE}`;

// 시장 규모 수치 패턴 — 조/억원, 억 달러, billion/trillion/million. 단위 없는
// 맨숫자(연도 등)는 잡지 않는다. 전역 플래그로 한 항목에서 여러 값도 뽑는다.
const MARKET_SIZE_FIGURE =
  /(?:약\s*|USD\s*|US\$\s*|\$\s*)?[0-9][0-9,.]*\s*(?:조(?:\s*[0-9,.]*\s*억)?\s*원?|억\s*(?:원|달러)|billion|trillion|million)/gi;
// "시장 규모" 맥락 신호 — 이 신호가 있어야 위 수치를 시장 규모로 승격한다.
const MARKET_CONTEXT = /(시장\s*규모|시장규모|시장은|규모는|규모가|규모로|매출\s*규모|market\s*size)/i;

export type MarketSizeMention = {
  figure: string;
  context: string;
  origin: string;
  url: string;
  publishedAt?: string;
};

// ctx.articles(전수 풀)에서 "시장 규모 N조원 / N억 달러" 처럼 **출처가 명시한**
// 시장 규모 문장을 뽑아 TAM 후보로 승격한다(F2). 소비재 시장 규모는 KOSIS 에
// 없고 이런 뉴스·업계 보도가 현실 소스라, 근거 위계 상단에 별도로 노출해 LLM 이
// TAM 에 우선 채우게 한다. 숫자를 만드는 게 아니라 **출처 문장에 이미 있는 수치**를
// 그대로 옮기는 것이라 정책 위반이 아니다(F3 의 '추정' 라벨과 함께 표기).
export function extractMarketSizeMentions(
  articles: { title: string; snippet?: string; origin?: string; url: string; publishedAt?: string; source: DeskSourceId }[],
  limit = 12,
): MarketSizeMention[] {
  const out: MarketSizeMention[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    const text = `${a.title} ${a.snippet ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text || !MARKET_CONTEXT.test(text)) continue;
    MARKET_SIZE_FIGURE.lastIndex = 0;
    const m = MARKET_SIZE_FIGURE.exec(text);
    if (!m) continue;
    const figure = m[0].replace(/\s+/g, ' ').trim();
    const origin = a.origin || sourceLabelKo(a.source);
    const key = `${origin}::${figure}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 수치 주변 ±70자 문맥 — LLM 이 무엇의 규모인지 판단할 최소 컨텍스트.
    const at = m.index;
    const context = text.slice(Math.max(0, at - 70), Math.min(text.length, at + figure.length + 70)).trim();
    out.push({ figure, context, origin, url: a.url, publishedAt: a.publishedAt });
    if (out.length >= limit) break;
  }
  return out;
}

// 리포트 user 메시지 — 4 bucket 으로 그룹핑한 수집 항목 + 회사 축(DART 조회
// 대상 상장사)을 첨부한다. companies 는 runMarket 이 LLM 으로 뽑은 목록으로,
// SAM 섹션에서 어떤 회사 매출을 찾아 정리해야 하는지 LLM 에 알려준다.
export function buildMarketReportUserMsg(
  ctx: ReportContext,
  companies: string[],
): string {
  const { sampled, articles, similar, keywords, regions, range, locale } = ctx;

  // F2 — 전수 풀에서 "시장 규모 N조원/N억달러" 명시 문장을 뽑아 TAM 후보로 승격.
  const marketSizeMentions = extractMarketSizeMentions(articles);
  const marketSizeBlock = marketSizeMentions.length
    ? [
        '=== 💰 시장 규모 명시 문장 (뉴스·업계 — TAM 후보, 출처 병기 필수) ===',
        '아래는 수집 기사·리포트에 **이미 명시된** 시장 규모 수치입니다. TAM 근거로 우선',
        '검토하되, 정형 통계(KOSIS·aTFIS)가 아닌 업계·언론 추정치이면 값에 `(추정)` 라벨을',
        '붙이고 아래 출처를 그대로 인용하세요. 새 숫자를 계산하지 말고 문장의 수치만 옮깁니다.',
        ...marketSizeMentions.map(
          (mm, i) =>
            `${i + 1}. [${mm.origin}] ${mm.figure}\n   문맥: …${mm.context}…\n   url: ${mm.url}${mm.publishedAt ? `\n   published: ${mm.publishedAt}` : ''}`,
        ),
      ].join('\n')
    : '';

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
    ...(companies.length
      ? [
          `  ↳ 부문 매출이 출처에 없으면(요약재무제표는 연결 전체 매출만), 위 상장사들의 명시된 전체 매출을 단순 합산해 SAM 을 산출하되 \`전사 합산 · 상한 추정\` 라벨 + 합산 대상 기업·연도를 병기하세요. 보간·외삽 금지.`,
        ]
      : []),
    `검색 지역: ${regions.join(', ')}`,
    `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
    `전체 수집: ${articles.length}건 (이 중 대표 ${sampled.length}건을 근거 위계별로 아래에 첨부)`,
    '',
    ...(marketSizeBlock ? [marketSizeBlock, ''] : []),
    '--- 수집 항목 (근거 위계별 그룹핑 — 수치를 옮길 때 반드시 해당 항목의 출처를 인용하세요) ---',
    blocks.length ? blocks.join('\n\n') : '(수집 항목 없음 — 모든 항목을 "데이터 확보 실패"로 표기)',
  ].join('\n');
}
