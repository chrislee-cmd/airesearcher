import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { spendCredits, refundCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  crawlSourceWithTimeout,
  dedupeArticles,
  sourceMissingKey,
  SOURCE_BUDGET,
} from '@/lib/desk-crawl';
import { pickRepresentativeArticles } from '@/lib/desk-embed';
import { getCache, hashString, setCache } from '@/lib/cache';
import type { DeskDateRange } from '@/lib/desk-crawl';
import {
  DESK_SOURCES,
  type DeskArticle,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

export const maxDuration = 300;

const SOURCE_IDS = [
  'naver_news',
  'naver_blog',
  'naver_cafe',
  'naver_kin',
  'kakao_web',
  'kakao_blog',
  'kakao_cafe',
  'youtube',
  'google_news',
  'gdelt_news',
  'hacker_news',
  'reddit',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REGION_ENUM = z.enum(['KR', 'US', 'SG', 'MY', 'TH', 'JP', 'GLOBAL']);

// ── Crawl scope hard caps (spec-down — 2026-06-30 timeout incident) ──────────
// The crawl phase cost scales with keywords × sources × regions. Unbounded it
// reached 211s (70% of the 300s budget) and the report never got generated.
// These caps bound the worst case so the LLM report phases always get budget.
// Mirrored in the client UI (desk-card-body) for an estimate/warning at input
// time. Keep the three in sync if you change them.
const MAX_KEYWORDS = 5;
const MAX_SOURCES = 12;
const MAX_REGIONS = 3;

const Body = z.object({
  keywords: z.array(z.string().min(1).max(120)).min(1).max(MAX_KEYWORDS),
  sources: z.array(z.enum(SOURCE_IDS)).min(1).max(MAX_SOURCES),
  locale: z.enum(['ko', 'en']).optional(),
  // 멀티 region 우선. 단일 `region` 도 backward-compat 으로 유지 — 누락 시
  // locale 로 기본값 결정 (기존 동작과 동일).
  regions: z.array(REGION_ENUM).min(1).max(MAX_REGIONS).optional(),
  region: REGION_ENUM.optional(),
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const EXPAND_SYSTEM = `당신은 데스크 리서치를 위해 사용자가 입력한 키워드의 검색 적합 유사 키워드를 만드는 보조자입니다.
- 의미가 가깝거나 함께 검색되는 변형을 4개 제시합니다.
- 한국어 입력이면 한국어 위주, 영어 입력이면 영어 위주로 작성하되 통용되는 영문/한글 표기는 섞어도 됩니다.
- 결과는 콤마(,)로만 구분된 한 줄로 출력. 따옴표/번호/설명 금지.`;

// Multi-pass synthesis prompts — see runJob() summarize phase. Sonnet drafts
// per-RQ answers, then critiques itself, then optionally revises before the
// final 6-section report is composed. Korean honorifics (-입니다/-합니다).

const RQ_DRAFT_SYSTEM = `당신은 톱티어 컨설팅 펌의 시니어 리서처입니다. 데스크 리서치에서 추출된 evidence (정량주장 + 관련 article 스니펫) 와 한 개의 리서치 질문을 받아, 그 질문에 대한 답변 초안을 한국어로 작성합니다.

[역할 — 중요]
- 이 답변은 보고서의 **해석** 영역에 들어갑니다. 같은 보고서의 별도 "📝 Findings" 섹션에서 사실(스크랩 내용의 중립 요약)이 이미 정리됩니다.
- 따라서 evidence 의 사실 나열을 길게 늘어놓지 말고, 그 사실들이 이 RQ 에 대해 **무엇을 시사하는지 / 어떻게 답하는지** 에 초점을 둡니다.
- 핵심 수치 한두 개만 짧게 재인용 (예: "거래액 1.2조원 → ...") — 사실 전체 복창은 피합니다.

[원칙]
- 1~2문단 (300~600자) 분량.
- 정중한 존댓말 — 모든 서술은 '-입니다 / -합니다 / -하였습니다 / -보입니다' 어미. 반말 / 명사형 종결 금지.
- 사실 임의 추가 금지 — 제공된 evidence 에만 근거합니다.
- 모든 인용은 [제목](URL) 마크다운 링크. raw URL 금지.
- 답변에 실제로 인용한 article 의 URL 을 cited_article_urls 배열에 모두 명시합니다.
- evidence 가 빈약하면 솔직하게 '제공된 자료로는 충분히 답하기 어렵습니다' 라고 적습니다 — 추측은 금지.`;

const RQ_CRITIQUE_SYSTEM = `당신은 톱티어 컨설팅 펌의 시니어 리뷰어입니다. 동료가 작성한 RQ 답변 초안과 원본 evidence (정량주장 + 관련 article 스니펫) 를 받아, 답변의 약점·누락된 데이터·전체 신뢰도를 평가합니다.

[원칙]
- weaknesses: 답변이 가진 분석적/논리적 약점 (예: "단일 출처에 의존", "수치 출처의 tier 가 낮음", "정의가 모호") 0~5개. 약점이 없으면 빈 배열.
- missing_data: 있으면 답변이 더 강해질 정보 항목 (예: "최근 12개월 거래량", "주요 경쟁사 점유율 정량 수치") 0~5개.
- confidence: 'high' | 'medium' | 'low'. high = 다출처 교차검증 + T1 위주, medium = 부분적 근거, low = evidence 부족 또는 모순.
- 한국어 존댓말, 각 항목은 한 줄.`;

const RQ_REVISE_SYSTEM = `당신은 톱티어 컨설팅 펌의 시니어 리서처입니다. 자신이 작성한 RQ 답변 초안에 대한 critique (weaknesses + missing_data) 와 원본 evidence 를 받아, 약점을 보완한 개선판 답변을 작성합니다.

[역할 — 중요]
- 이 답변은 보고서의 **해석** 영역에 들어갑니다. 별도 "📝 Findings" 섹션이 사실 요약을 담당하므로, 사실 전체를 다시 나열하지 말고 **해석/시사점** 을 다듬는 데 집중합니다.

[원칙]
- 약점은 직접적으로 해소하되, evidence 가 부족한 항목은 '추가 조사 필요'라고 명시 — 없는 데이터를 새로 만들지 마세요.
- 분량은 초안과 비슷 (1~2문단). 사실 복창보다 해석 강화에 분량을 씁니다.
- 존댓말, [제목](URL) 인용, 인용한 article URL 을 cited_article_urls 에 모두 포함합니다.
- 새 evidence 가 없는 항목은 그대로 두되, 답변의 톤을 더 신중하게 (예: '~로 보입니다', '제한적인 자료 기준으로는') 조정합니다.`;

const REPORT_SYSTEM_V2 = `당신은 톱티어 컨설팅 펌(맥킨지/베인/BCG)의 시니어 파트너입니다. 입력으로 (1) 사용자 요청 메타데이터 (키워드 / 지역 / 기간), (2) 미리 작성된 리서치 질문별 답변 (rq_answers), (3) 추출된 정량주장 + 엔티티 (claims), (4) 대표 article 샘플을 받아, 피라미드 원칙에 따라 한 편의 한국어 데스크 리서치 보고서를 작성합니다.

[작성 원칙]
- 한국어 Markdown.
- 정중한 존댓말 — 모든 서술은 '-입니다 / -합니다 / -하였습니다 / -보입니다' 어미. 반말 / 명사형 종결 금지.
- 모든 링크는 [제목](URL) 형식. raw URL 금지.
- 사실 임의 추가 금지 — 제공된 자료에만 근거합니다.
- 섹션 헤더 앞에 의미 있는 이모지 1개 (예: 🧭, ❓, 📊, 🏢, ⚠️, 📚).
- 모든 섹션 헤더는 반드시 출력합니다. 내용이 빈약해도 헤더는 생략하지 않고 한 줄 안내(예: '수집된 정량주장이 없습니다.')로 채웁니다.

[필수 섹션 — 이 순서대로]
1. # 🧭 Executive Summary
   - **Situation** (1문단) — 키워드 / 기간 / 지역 컨텍스트를 짧게 정리합니다.
   - **Complication** (1문단) — 핵심 발견 2~3개를 한 단락으로 압축합니다.
   - **Resolution** (1문단) — '그래서 무엇을 하면 좋은가' 권고 1~2 줄. 권고는 사용자 질문(RQ) 에 답하는 방향으로만 작성하고, 아래 Findings(귀납) 섹션에는 권고를 절대 누설하지 않습니다.

2. ## 📝 Findings — 데이터에서 발견된 토픽/패턴 요약 (귀납적)
   - **이 섹션은 귀납적(bottom-up) 입니다 — 데이터가 말하는 것을 그대로 보여줍니다. 사실(facts) 만 다루며, 해석 / 평가 / 시사점 / 권고는 다음 RQ 섹션(3, 연역적) 에서만 다룹니다.**
   - **작성 방법 (반드시 이 순서로 사고)**:
     1. 먼저 모든 claim + article 의 핵심 주장 / 신호 / 인용을 **그룹 없이** 한 번 훑습니다.
     2. **자주 등장하는 주제 / 반복되는 패턴 / 강한 신호** 를 발견하면 그것을 토픽 헤더(### 헤더) 로 잡습니다.
     3. 그 토픽 아래에 관련 finding 을 묶습니다.
     4. **미리 정한 카테고리 (시장 / 플레이어 / 규제 / 기술 ...) 에 데이터를 맞추지 마세요** — 데이터가 말하는 토픽 그대로 헤더를 씁니다.
   - **토픽 emergence 검증 룰**:
     - 토픽이 한 article 에만 등장 = 약함 → 별도 토픽 헤더 X, 다른 토픽의 finding 으로만 흡수하거나 생략.
     - 2개 이상 article 에서 일관된 신호 = 토픽 후보 (헤더로 가능).
     - 3개 이상 article + 서로 다른 출처 = 강한 토픽 (반드시 헤더로).
   - **토픽 헤더 작성 규칙**:
     - 헤더는 **데이터에서 emerge 한 발견 신호** 를 담은 한 줄 (대략 30~60자).
     - 좋은 예 (O): "### AI 도구 사용 시 직무 정체성 불안이 반복 등장합니다", "### 삼성·LG 외 신규 진입자 5개사가 동시 출시했습니다", "### T1 자료는 시장 규모를, T3 사용자 신호는 페인포인트를 강조합니다"
     - 나쁜 예 (X — pre-defined 카테고리 frame): "### 주요 플레이어", "### 시장 규모", "### 규제 / 정책" — 데이터를 frame 에 끼워 맞춘 형태이므로 금지.
     - 카테고리성 내용이 들어가야 한다면, 그것도 데이터에서 emerge 한 발견 형태로 (이름 자체가 신호가 되도록).
   - **finding 원칙**:
     - **추론 금지** — article 에서 발견된 사실만. "왜" 가 아니라 "무엇" 만.
     - 각 finding 은 원문의 진술을 그대로 옮기되 한국어 존댓말 어미로 마감합니다. 말바꿈은 최소화.
     - **모든 finding 에 인용 링크 필수** — [원문](URL) 마크다운 형식.
     - 한 finding = 한 markdown bullet (대략 80~200자) + 인용 링크.
     - 해석성 표현 ('따라서', '시사하다', '기회', '리스크', '권고') 금지.
   - **분량 — 데이터가 결정합니다**:
     - 토픽 수는 데이터가 결정합니다 — 보통 3~8개. 데이터가 풍부하면 많이, 빈약하면 적게.
     - 한 토픽 안 finding 수도 데이터가 결정 — 보통 2~8개. 동일 사실의 중복 인용은 피합니다.
   - **fallback — 데이터 빈약 시 (article < 20 또는 claim < 10)**:
     - 토픽 수를 1~3개로 줄이고, "다음 토픽이 가장 자주 발견되었습니다: X" 1~2문장 + bullet 2~3개로 정리합니다.
     - 명확한 토픽이 emerge 하기 어려우면 "현 수집 데이터로는 뚜렷한 토픽이 나타나지 않았습니다 — RQ 섹션의 해석을 참고하시기 바랍니다." 한 줄로 대체하고 무리하게 헤더를 만들지 않습니다.

3. ## ❓ Research Questions & Findings (해석)
   - **이 섹션은 연역적(top-down) 입니다 — 사용자가 미리 정한 질문(RQ)에 데이터를 매핑해 답합니다. 위 Findings(귀납) 가 데이터에서 발견한 것을 보여줬다면, 여기는 그 데이터를 사용자 질문에 연결해 해석합니다.**
   - **두 섹션의 분리**: 같은 사실은 여기서 짧게만 재인용해 지면을 절약하고, 해석 / 시사점 / 가설 확신도는 **오직 이 섹션에서만** 다룹니다 (Findings 는 사실만).
   - 입력으로 받은 rq_answers 의 각 항목을 ### 형식의 하위 섹션으로 펼칩니다.
   - 각 RQ 마다:
     - **### Q. <질문>**
     - **답변.** answer_md 본문을 그대로 옮겨 적습니다. (이미 해석 위주로 작성되어 있습니다 — 임의로 사실을 더 끼워 넣지 마세요.)
     - **신뢰도.** 🟢 high / 🟡 medium / 🔴 low 아이콘 + 한 줄 사유 (critique 기반).
     - **더 알아볼 점.** missing_data 항목을 - 불릿으로 나열. 비어 있으면 '- 추가 조사 필요 항목 없음.' 한 줄.

4. ## 📊 Quantitative Snapshots
   - claims 중 kind='quant' 만 모아 다음 markdown 표 형식으로 출력합니다:

     | 주장 | 수치 | 출처 | tier | 신뢰도 |
     | --- | --- | --- | --- | --- |
     | <subject> | <value> <unit> | [원문](<article_url>) | T1/T2/T3 | direct/paraphrased/speculation |

   - quant claim 이 0개면 '수집된 정량주장이 없습니다.' 한 줄로 대체합니다.
   - 행이 15개를 넘으면 상위 15개만 표시하고 표 아래 '_(나머지 N개 생략)_' 한 줄.

5. ## 🏢 Competitive / Market Map
   - claims 중 kind='entity' 의 이름 + role 빈도를 분석합니다.
   - 입력 키워드가 2개 이상이면 키워드별로 ### 소제목으로 비교합니다.
   - 1~2단락으로 어떤 회사·제품·인물이 자주 거명되는지 + 그 시그널이 시장에서 어떤 역할을 하는지 정리합니다.
   - entity 가 0개면 '주요 엔티티 식별이 부족합니다. 본 데이터셋에서는 시장 지도를 그리기 어렵습니다.' 한 줄.

6. ## ⚠️ Caveats & Methodology
   - **검색 컨텍스트.** 언어 / 지역 / 기간을 한 줄.
   - **소스 분포.** T1 N개 / T2 N개 / T3 N개 / 미분류 N개. (claims 의 tier 분포 기준)
   - **샘플링.** 전체 수집 N건 중 의미가 다양한 M건을 본문에 첨부. (입력 메타 그대로)
   - **알려진 갭.** rq_answers 의 missing_data 를 1~2 줄로 요약 + 가능하면 데이터 편향 (예: '한국어 자료가 영문보다 많습니다') 한 줄.

7. ## 📚 Appendix — Sources
   - 입력 article 샘플을 tier 별로 그룹화 (### T1 / ### T2 / ### T3 / ### 미분류) 후 각 항목을:
     - [제목](URL) — 출처 · 발행일 (있으면) · 한 줄 스니펫 (있으면, 80자 이내)
   - 표시 상한 100개. 초과분은 '_(나머지 N개 생략)_' 한 줄.

분량은 충실하게 작성하되 의미 있는 정보가 담길 때만 단락을 둡니다.${ISOLATION_NOTICE}`;

const RQ_DECOMPOSE_SYSTEM = `당신은 톱티어 컨설팅 펌(맥킨지/베인/BCG)의 시니어 리서처입니다. 사용자가 입력한 키워드, 검색 지역, 수집 기간을 보고 — 이 데스크 리서치가 답해야 할 핵심 리서치 질문(Research Questions, RQ) 3~5개를 한국어로 분해합니다.

[원칙]
- 각 질문은 단일 주제로 분리되고, "예/아니오" 가 아닌 분석형 질문이어야 합니다 (예: "X 시장 규모는 얼마이며 최근 3년 CAGR 은?").
- 질문은 서로 의미가 명확히 구분되어야 하며, 같은 정보를 두 번 묻지 않습니다.
- 시장규모 / 경쟁·플레이어 / 트렌드 / 규제·리스크 / 사용자 시그널 / 비즈모델 / 기술 — 이 7가지 카테고리 중에서 가능한 한 다양하게 커버합니다 (모든 카테고리를 다 채우려고 무리하지 마세요).
- 입력 키워드가 이미 좁은 도메인이면 그 도메인 안에서 깊이 있게, 넓으면 핵심을 추려서 폭넓게 분해합니다.

[카테고리 enum]
- market_size: 시장 규모·성장률·거래량
- competition: 주요 플레이어·M&A·신규 진입자
- trends: 신호·반복 등장 토픽·시간 흐름
- regulation_risk: 규제·정책·리스크·소송
- user_signals: 사용자/소비자 반응·여론·페인포인트
- business_model: 수익화·가격·유닛 이코노믹스
- technology: 기술 스택·R&D·특허

[중요도]
- 1(보조) ~ 5(필수) 로 매깁니다. 평균 3 근처로 분포하도록 — 모두 5 로 만들지 마세요.

JSON schema 에 정확히 맞추세요.`;

const CLAIM_EXTRACT_SYSTEM = `당신은 데스크 리서치 보고서를 뒷받침할 evidence 를 articles 에서 추출하는 분석가입니다. 한 개의 article (제목 + 요약 + URL + 출처) 을 받아 정량주장(quant) 과 엔티티(entity) 를 뽑아냅니다.

[정량주장 (quant)]
- 시장규모·성장률·거래액·MAU·DAU·매출·점유율 같은 숫자가 들어간 주장.
- value 는 원문에 등장하는 형태 그대로 (예: "1.2조원", "12%", "3.5M"). 직접 단위 변환 X.
- unit 은 부가 단위 (예: "원", "%", "건"). 분리가 어려우면 비워둡니다.
- subject 는 무엇에 대한 수치인지 한국어 1줄 (예: "국내 OTT 광고 시장 규모").
- source_quote 는 article 의 제목·요약에서 그 주장의 근거가 된 부분을 그대로 옮긴 한 줄.

[엔티티 (entity)]
- 회사·인물·제품·기관 이름.
- role 은 'company' | 'person' | 'product' | 'org' 중 하나.
- source_quote 는 위와 동일.

[카테고리 매칭]
- rq_ids 에는 입력으로 받은 RQ 목록 (id + 질문) 중 이 claim 이 답하는 데 도움이 되는 RQ id 를 0~3개 고릅니다. 확신이 없으면 빈 배열.

[신뢰도]
- direct: article 이 직접 인용·출처·원자료를 명시
- paraphrased: 다른 자료를 재해석·요약한 톤
- speculation: 추정·전망·예상 톤 ("~할 것으로 보인다")

[규칙]
- 명백한 사실/숫자만. 광고성 슬로건·추상적 표현은 추출 X.
- article 에 정량주장이 0개일 수도 있고, 5개 넘을 수도 있습니다. 무리하게 채우지 마세요.
- 한 article 에서 보통 quant 0~3 + entity 0~5 정도가 적절. 최대 quant 5 / entity 8.
- 한국어로 작성합니다.${ISOLATION_NOTICE}`;

const ANALYTICS_SYSTEM = `당신은 방금 작성된 데스크 리서치 보고서를 시각적으로 뒷받침할 정량 분석 차트를 설계합니다.

원칙:
- 차트는 보고서 본문이 주장하는 인사이트를 그림으로 보여주는 보조 자료입니다. 수집 메타데이터(소스 카운트, API 호출 수 같은 것)는 사용하지 마세요.
- 콘텐츠 기반 분석에 집중합니다 — 토픽 분포, 톤(긍정/중립/부정), 키워드/주체별 비교, 유형(신제품/마케팅/실적/리스크 등) 분포처럼 보고서 안에 의미가 있는 차원.
- 2~4개의 차트를 만듭니다. 그 중 **최소 1개는 합이 100% 인 비율 분포(파이 또는 누적 비율 막대)** 입니다.
- 같은 인사이트를 두 번 그리지 마세요.
- 모든 라벨/제목/insight 는 한국어 존댓말. 라벨은 4~12자 정도로 짧게.
- 데이터에 없는 수치는 만들지 말고, 보고서 본문이 시사하는 분포를 합리적으로 추정합니다.`;

const ChartSchema = z.object({
  type: z.enum(['bar', 'pie']),
  title: z.string().min(1).max(60),
  insight: z.string().min(1).max(200),
  unit: z.enum(['percent', 'count']),
  data: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        value: z.number().nonnegative(),
      }),
    )
    .min(2)
    .max(8),
});

const AnalyticsSchema = z.object({
  charts: z.array(ChartSchema).min(2).max(4),
});

const RQ_CATEGORIES = [
  'market_size',
  'competition',
  'trends',
  'regulation_risk',
  'user_signals',
  'business_model',
  'technology',
] as const;

const ResearchQuestionSchema = z.object({
  id: z.string().min(1).max(16),
  question: z.string().min(4).max(200),
  category: z.enum(RQ_CATEGORIES),
  importance: z.number().int().min(1).max(5),
});

const RQDecomposeSchema = z.object({
  research_questions: z.array(ResearchQuestionSchema).min(3).max(5),
});

type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

// Per-article claim extraction. Haiku is cheap enough to call once per
// representative article, so we keep the schema strict and skip articles
// whose payload comes back unparseable instead of retrying.
const QuantClaimSchema = z.object({
  kind: z.literal('quant'),
  value: z.string().min(1).max(80),
  unit: z.string().max(40).optional(),
  subject: z.string().min(1).max(160),
  source_quote: z.string().min(1).max(400),
  rq_ids: z.array(z.string().min(1).max(16)).max(3),
  confidence: z.enum(['direct', 'paraphrased', 'speculation']),
});

const EntityClaimSchema = z.object({
  kind: z.literal('entity'),
  name: z.string().min(1).max(120),
  role: z.enum(['company', 'person', 'product', 'org']),
  source_quote: z.string().min(1).max(400),
  rq_ids: z.array(z.string().min(1).max(16)).max(3),
  confidence: z.enum(['direct', 'paraphrased', 'speculation']),
});

const ClaimExtractSchema = z.object({
  quant: z.array(QuantClaimSchema).max(5),
  entities: z.array(EntityClaimSchema).max(8),
});

// Multi-pass RQ synthesis schemas. Draft + Revise share shape (answer + cited
// URLs); Critique returns the structured weakness/confidence assessment.
const RqDraftSchema = z.object({
  answer_md: z.string().min(1).max(4000),
  cited_article_urls: z.array(z.string()).max(15),
});

const RqCritiqueSchema = z.object({
  weaknesses: z.array(z.string().min(1).max(400)).max(8),
  missing_data: z.array(z.string().min(1).max(400)).max(8),
  confidence: z.enum(['high', 'medium', 'low']),
});

type PersistedRqAnswer = {
  rq_id: string;
  answer_md: string;
  confidence: 'high' | 'medium' | 'low';
  weaknesses: string[];
  missing_data: string[];
  cited_article_urls: string[];
};

// Persisted form — flattened, tagged with the source article + tier so the
// runner can write one combined `claims` array to the row without losing
// provenance. Kind is preserved on each row.
type PersistedClaim =
  | {
      kind: 'quant';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      value: string;
      unit?: string;
      subject: string;
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    }
  | {
      kind: 'entity';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      name: string;
      role: 'company' | 'person' | 'product' | 'org';
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    };

function getModel(): LanguageModel {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  return createAnthropic({ apiKey })('claude-sonnet-4-6');
}

// Haiku — used for the per-article claim extraction loop. Spec calls out
// `claude-haiku-4-5-20251001` so the loop's cost stays well below summarize's.
function getClaimModel(): LanguageModel {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  return createAnthropic({ apiKey })('claude-haiku-4-5-20251001');
}

// Analytics runs on a separate provider (OpenAI gpt-4o-mini) so its rate
// limit pool doesn't share Anthropic's 30k input tokens/min bucket. The
// long-form report stays on Sonnet for quality; only the structured chart
// extraction moves to OpenAI.
function getAnalyticsModel(): LanguageModel | null {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({ apiKey })('gpt-4o-mini');
}

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCES.find((s) => s.id === id)?.label ?? id;
}

type PhaseName =
  | 'expanding'
  | 'scoping'
  | 'crawling'
  | 'gating'
  | 'sampling'
  | 'extracting'
  | 'drafting'
  | 'critiquing'
  | 'synthesizing'
  | 'analytics'
  | 'summarizing';

type ProgressShape = {
  phase?: PhaseName;
  crawl_total?: number;
  crawl_done?: number;
  events: string[];
  // Per-phase wall-clock (ms). Populated as phases close so admins can see
  // exactly where a stuck job was spending its budget without trawling
  // Vercel logs. `progress.timings.drafting_ms` etc.
  timings?: Partial<Record<`${PhaseName}_ms`, number>>;
  // Total elapsed since runJob start (ms). Updated on every progress patch.
  elapsed_ms?: number;
  // HARD_DEADLINE_MS used for this run — lets UI surface "X초 남음" if needed.
  deadline_ms?: number;
  // Steps the budget-skip logic intentionally bypassed (revise / critique /
  // analytics / rq_cap). Shown in the report footer so users know the run
  // ran tight and which corner was cut.
  skipped_steps?: string[];
};

// Server-side maxDuration is 300s — leave a margin for the final DB writes
// (generations insert + final patch). 270s = 30s safety. See spec §D.
const HARD_DEADLINE_MS = 270_000;
// Synthesize is the irreplaceable step — refuse to start unless we have at
// least this much budget left.
const SYNTHESIZE_MIN_BUDGET_MS = 60_000;
// Mode-aware per-RQ budgets, measured on prod runs 2026-06-29:
//   draft only: ~25s   draft+critique: ~40s   full (with revise): ~70s
// Picking each cap with its true mode budget makes the dispatcher honest
// instead of the old single PER_RQ_BUDGET=50 that lied in both directions
// (let two revise RQs through, then died at synthesize).
const PER_RQ_FULL_SEC = 70;
const PER_RQ_CRITIQUE_SEC = 40;
const PER_RQ_DRAFT_SEC = 25;
// Reserve held back from RQ budgeting for synthesize + analytics + writes.
// = SYNTHESIZE_MIN_BUDGET(60s) + analytics(~20s) + DB final patches(~10s).
const RESERVE_AFTER_RQ_SEC = 90;
// Hard per-call LLM timeouts — without these the AI SDK can hang forever
// on a network stall or stuck provider. Picked just above 2x of the worst
// observed P99 for each call type so legitimate slow runs still complete.
const LLM_TIMEOUT_RQ_MS = 90_000;
const LLM_TIMEOUT_SYNTH_MS = 120_000;
const LLM_TIMEOUT_CLAIM_MS = 30_000;
const LLM_TIMEOUT_SHORT_MS = 30_000; // scoping / expanding / analytics
// Below this remaining budget at analytics start, we skip charts.
const SKIP_ANALYTICS_BELOW_MS = 20_000;
// Below this remaining budget at extracting start, we skip claim extraction.
// Extraction is non-fatal (the report still renders from articles alone) but
// burns ~30s — skip if budget is tight so drafting/synthesize gets the time.
const SKIP_EXTRACTING_BELOW_MS = 220_000;
// Hard guarantee against a 0-output run (the 2026-06-30 incident). If crawl
// ate so much budget that we can't even afford one LLM round-trip + the
// synthesize reserve, skip ALL LLM phases and emit a deterministic raw-data
// dump (collected articles + RQs, 0 LLM calls, written in <1s). The user gets
// a usable artifact instead of `function_timeout_autocleanup`. With the new
// crawl caps + per-task timeout this branch should almost never fire, but it
// is the last safety net. ~110s = one minimal draft (25s) + reserve (90s).
const RAW_DUMP_AFTER_CRAWL_MS = 110_000;

class TimeoutError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TimeoutError';
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { keywords, sources, locale = 'ko', regions: regionsInput, region: regionInput, dateFrom, dateTo, project_id } = parsed.data;
  // Default region from locale: Korean researchers default to KR sources,
  // English researchers default to GLOBAL (Google News will use US/en).
  // 멀티 region 입력이 있으면 그대로, 아니면 단일 region (legacy) 또는 locale
  // 기본값. 중복은 Set 으로 정리.
  const regions: DeskRegion[] = Array.from(
    new Set<DeskRegion>(
      regionsInput && regionsInput.length > 0
        ? regionsInput
        : [regionInput ?? (locale === 'ko' ? 'KR' : 'GLOBAL')],
    ),
  );
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
  }

  const cleanKeywords = Array.from(
    new Set(keywords.map((k) => k.trim()).filter(Boolean)),
  ).slice(0, MAX_KEYWORDS);
  if (cleanKeywords.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  const skipped: { source: DeskSourceId; missing: string }[] = [];
  const usable: DeskSourceId[] = [];
  for (const s of sources as DeskSourceId[]) {
    const missing = sourceMissingKey(s);
    if (missing) skipped.push({ source: s, missing });
    else usable.push(s);
  }
  if (usable.length === 0) {
    return NextResponse.json(
      { error: 'no_usable_sources', skipped },
      { status: 400 },
    );
  }

  const initialEvents: string[] = [
    `키워드 ${cleanKeywords.length}개를 받았어요${
      cleanKeywords.length > 1
        ? ` (${cleanKeywords.map((k) => `‘${k}’`).join(', ')})`
        : ` — ‘${cleanKeywords[0]}’`
    }. 검색 준비할게요.`,
  ];
  if (dateFrom || dateTo) {
    initialEvents.push(
      `기간은 ${dateFrom ?? '전체'} ~ ${dateTo ?? '오늘'} 으로 좁혀서 봅니다.`,
    );
  }

  // Insert the durable job row first (status=queued). The client polls /jobs
  // or subscribes via Realtime — this request itself returns immediately.
  const initialProgress: ProgressShape = { events: initialEvents };
  const { data: job, error: insertErr } = await supabase
    .from('desk_jobs')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      user_id: user.id,
      keywords: cleanKeywords,
      sources: usable as unknown as string[],
      locale,
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      status: 'queued',
      progress: initialProgress as unknown as object,
      skipped: skipped.length > 0 ? (skipped as unknown as object) : null,
      credits_spent: FEATURE_COSTS.desk,
    })
    .select('id')
    .single();
  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // Pass job.id as the idempotency key so a downstream refund (on
  // crawl/summarize failure) can reverse this exact charge.
  const spend = await spendCredits(org.org_id, 'desk', job.id);
  if (!spend.ok) {
    await supabase.from('desk_jobs').delete().eq('id', job.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // Schedule the heavy work to run after the response is returned. Vercel
  // keeps the function alive up to maxDuration (300s) — enough headroom for
  // even 10 keywords × 11 sources × API latency.
  after(() =>
    runJob({
      jobId: job.id,
      orgId: org.org_id,
      userId: user.id,
      keywords: cleanKeywords,
      usable,
      locale,
      regions,
      range: { from: dateFrom, to: dateTo },
      initialEvents,
    }),
  );

  return NextResponse.json({ job_id: job.id });
}

// Sources that take a region parameter (Google News / GDELT / YouTube). For
// these we crawl once per selected region. Naver/Kakao/Daum are KR-only and
// Reddit/HackerNews are region-agnostic — both are crawled once regardless of
// how many regions the user picked.
const REGION_AWARE_SOURCES = new Set<DeskSourceId>([
  'google_news',
  'gdelt_news',
  'youtube',
]);

// ─── Background runner ───────────────────────────────────────────────────────
async function runJob(args: {
  jobId: string;
  orgId: string;
  userId: string;
  keywords: string[];
  usable: DeskSourceId[];
  locale: 'ko' | 'en';
  regions: DeskRegion[];
  range: DeskDateRange;
  initialEvents: string[];
}) {
  const { jobId, orgId, userId, keywords, usable, locale, regions, range, initialEvents } = args;
  // 단일 region 만 받는 다운스트림 (보고서 prompt 메타데이터) 용 representative.
  // 멀티 region 일 때 첫 region 을 대표값으로 — 보고서 본문은 regions 전체
  // 목록을 별도로 받음.
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';
  const admin = createAdminClient();
  const events: string[] = [...initialEvents];
  let crawlDone = 0;
  let crawlTotal = 0;

  // ── Deadline + per-phase timing (see spec §A/D) ─────────────────────────
  // Single source of truth for wall-clock budget. timeLeft() drives the
  // step-skip logic so synthesize is guaranteed ≥60s; timings keeps a
  // breakdown that survives the function exit (stored in progress JSON).
  const startTime = Date.now();
  const timings: Partial<Record<`${PhaseName}_ms`, number>> = {};
  const phaseStart: Partial<Record<PhaseName, number>> = {};
  const skippedSteps: string[] = [];
  const timeLeft = () => HARD_DEADLINE_MS - (Date.now() - startTime);
  const elapsedMs = () => Date.now() - startTime;
  function beginPhase(name: PhaseName) {
    phaseStart[name] = Date.now();
  }
  function endPhase(name: PhaseName) {
    const start = phaseStart[name];
    if (start) {
      timings[`${name}_ms`] = Date.now() - start;
      delete phaseStart[name];
    }
  }

  type Patch = Partial<{
    status: 'queued' | 'expanding' | 'crawling' | 'summarizing' | 'done' | 'error';
    progress: ProgressShape;
    similar_keywords: string[];
    output: string;
    articles: unknown;
    analytics: unknown;
    research_questions: unknown;
    claims: unknown;
    rq_answers: unknown;
    error_message: string;
    generation_id: string;
  }>;

  async function patch(update: Patch) {
    await admin.from('desk_jobs').update(update).eq('id', jobId);
  }
  // Cooperative cancel — the cancel endpoint just flips a row flag, runner
  // checks at every phase boundary. We throw a tagged error so the outer
  // try/catch can finalise status='cancelled' instead of 'error'.
  class CancelledError extends Error {
    constructor() {
      super('cancelled');
      this.name = 'CancelledError';
    }
  }
  async function checkCancel() {
    const { data } = await admin
      .from('desk_jobs')
      .select('cancel_requested')
      .eq('id', jobId)
      .single();
    if (data?.cancel_requested) throw new CancelledError();
  }
  function pushEvent(text: string) {
    events.push(text);
    if (events.length > 80) events.splice(0, events.length - 80);
  }
  async function pushAndPatch(text: string, phase?: ProgressShape['phase']) {
    pushEvent(text);
    await patch({
      progress: {
        phase,
        crawl_total: crawlTotal,
        crawl_done: crawlDone,
        events: [...events],
        timings: { ...timings },
        elapsed_ms: elapsedMs(),
        deadline_ms: HARD_DEADLINE_MS,
        skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
      },
    });
  }

  // Reverse the upfront charge whenever the job ends without producing a
  // result. Idempotent — safe to call from any failure path; a second call
  // returns ok without re-crediting (see credit_refund RPC).
  async function refundOnFailure(reason: string) {
    const result = await refundCredits(orgId, userId, 'desk', jobId);
    if (!result.ok && result.reason !== 'not_found') {
      console.error('[desk] refund failed', { jobId, reason, refundReason: result.reason });
    }
  }

  try {
    let model: LanguageModel;
    try {
      model = getModel();
    } catch {
      await refundOnFailure('missing_anthropic_key');
      await patch({ status: 'error', error_message: 'missing_anthropic_key' });
      return;
    }

    await checkCancel();

    let similar: string[] = [];
    beginPhase('expanding');
    if (keywords.length === 1) {
      await patch({ status: 'expanding' });
      await pushAndPatch(
        '한 키워드라 비슷한 표현도 같이 찾으면 더 풍부하겠어요. AI한테 4개 더 받아올게요…',
        'expanding',
      );
      // Same keyword + locale always yields the same suggestions (modulo
      // model/temperature drift, which we accept). Cache cross-org/cross-user
      // because the output isn't user-specific. Bump 'v1' if EXPAND_SYSTEM
      // changes meaningfully.
      const expandKey = `desk-expand:v1:${locale}:${hashString(keywords[0].trim().toLowerCase())}`;
      try {
        const cached = await getCache<string[]>(expandKey);
        if (cached && Array.isArray(cached)) {
          similar = cached;
        } else {
          const { text } = await generateText({
            model,
            system: EXPAND_SYSTEM,
            prompt: keywords[0],
            temperature: 0.3,
            providerOptions: ZERO_RETENTION,
            timeout: LLM_TIMEOUT_SHORT_MS,
          });
          similar = text
            .trim()
            .split(/[,\n]/)
            .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
            .filter(Boolean)
            .filter((k) => k.toLowerCase() !== keywords[0].toLowerCase())
            .slice(0, 4);
          if (similar.length > 0) {
            void setCache(expandKey, similar);
          }
        }
      } catch (err) {
        console.error('[desk] expandKeywords failed', err);
      }
      if (similar.length) {
        await pushAndPatch(
          `유사 키워드: ${similar.map((k) => `‘${k}’`).join(', ')} — 이 표현들도 함께 검색합니다.`,
          'expanding',
        );
      } else {
        await pushAndPatch('유사 키워드는 못 만들었어요. 입력 키워드만으로 갑니다.', 'expanding');
      }
      await patch({ similar_keywords: similar });
    } else {
      await pushAndPatch(
        '여러 키워드라 사용자가 직접 큐레이션한 걸로 보고, 유사 키워드 확장은 건너뜁니다.',
        'expanding',
      );
    }
    endPhase('expanding');

    await checkCancel();

    // ── Phase: scoping (RQ decomposition) ──────────────────────────────────
    // Top-tier desk research starts from a structured question list, not a
    // bag of search hits. Sonnet here so we get well-formed analytical
    // questions; this is a single call so latency is bounded.
    let researchQuestions: ResearchQuestion[] = [];
    beginPhase('scoping');
    await pushAndPatch(
      '먼저 이 데스크 리서치가 답해야 할 핵심 리서치 질문을 3~5개로 정리할게요…',
      'scoping',
    );
    try {
      const allKw = [...keywords, ...similar];
      const rqPrompt = [
        `메인 키워드: ${keywords.join(', ')}`,
        `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
        `검색 지역: ${regions.join(', ')}`,
        `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
        '',
        `위 정보를 바탕으로 데스크 리서치에 필요한 RQ 3~5개를 JSON 으로 분해해주세요. 모든 키워드(${allKw.join(', ')})를 통합적으로 다루는 질문이어야 합니다.`,
      ].join('\n');
      const rqResult = await generateObject({
        model,
        system: RQ_DECOMPOSE_SYSTEM,
        prompt: rqPrompt,
        schema: RQDecomposeSchema,
        temperature: 0.3,
        maxOutputTokens: 2000,
        maxRetries: 1,
        providerOptions: ZERO_RETENTION,
        timeout: LLM_TIMEOUT_SHORT_MS,
      });
      researchQuestions = rqResult.object.research_questions;
      await patch({ research_questions: researchQuestions });
      await pushAndPatch(
        `리서치 질문 ${researchQuestions.length}개를 정리했어요. 이제 자료를 수집할게요.`,
        'scoping',
      );
    } catch (err) {
      endPhase('scoping');
      console.error('[desk] scoping failed', err);
      await refundOnFailure('scoping_failed');
      await patch({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'scoping_failed',
        progress: {
          phase: 'scoping',
          crawl_total: crawlTotal,
          crawl_done: crawlDone,
          events: [...events],
          timings: { ...timings },
          elapsed_ms: elapsedMs(),
          deadline_ms: HARD_DEADLINE_MS,
          skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
        },
      });
      return;
    }
    endPhase('scoping');

    await checkCancel();

    const allKeywords = [...keywords, ...similar];
    // 멀티 region 시 region-aware source (google_news/gdelt/youtube) 는 region
    // 마다 별도 crawl, 나머지 (naver/kakao/reddit/hn) 는 한 번만. 사용자가
    // KR + JP 를 고르면 Google News 가 둘 다 검색됩니다.
    type CrawlTarget = { src: DeskSourceId; region: DeskRegion };
    const targets: CrawlTarget[] = [];
    for (const src of usable) {
      if (REGION_AWARE_SOURCES.has(src)) {
        for (const r of regions) targets.push({ src, region: r });
      } else {
        // primaryRegion 으로 한 번만 — 어차피 source 자체가 region 무관.
        targets.push({ src, region: primaryRegion });
      }
    }

    crawlTotal = allKeywords.length * targets.length;
    await patch({ status: 'crawling' });
    beginPhase('crawling');
    // Split each source's budget evenly across keywords. Without this, the
    // first keyword's pull races to the source's full 500 cap and rate-limits
    // / latency starve the later keywords. ceil() means small budgets still
    // give every keyword at least 1 slot.
    const perKwLimit = Math.max(
      1,
      Math.ceil(SOURCE_BUDGET / Math.max(allKeywords.length, 1)),
    );
    const sourceList = Array.from(new Set(usable.map(sourceLabelKo))).join(', ');
    const regionLabel = regions.join(', ');
    await pushAndPatch(
      `이제 ${allKeywords.length}개 키워드 × ${targets.length}개 (소스 × 지역) = ${crawlTotal}회 검색을 동시에 돌릴게요. 키워드당 소스별 ${perKwLimit}건씩 균등 분배합니다. 지역: ${regionLabel}. 소스: ${sourceList}.`,
      'crawling',
    );

    const collected: DeskArticle[] = [];
    const tasks = allKeywords.flatMap((kw) =>
      targets.map(({ src, region }) =>
        // Per-task hard timeout — a single hung/deep-paginating source can no
        // longer balloon the whole crawl phase (2026-06-30 incident root cause).
        crawlSourceWithTimeout(src, kw, region, range, perKwLimit)
          .then(async (items) => {
            crawlDone += 1;
            collected.push(...items);
            await pushAndPatch(
              `${sourceLabelKo(src)} (${region}) · ‘${kw}’ — ${items.length}건 가져왔어요. (${crawlDone}/${crawlTotal})`,
              'crawling',
            );
          })
          .catch(async (err) => {
            crawlDone += 1;
            await pushAndPatch(
              `${sourceLabelKo(src)} (${region}) · ‘${kw}’ — 실패했어요 (${err instanceof Error ? err.message : 'unknown'}).`,
              'crawling',
            );
          }),
      ),
    );
    await Promise.all(tasks);
    await checkCancel();

    // Now that per-source pulls aim at 500, the dedupe pool can balloon to
    // a few thousand. Keep a generous global cap so the LLM still gets fed,
    // but bounded enough to fit the model context.
    const articles = dedupeArticles(collected).slice(0, 1500);
    endPhase('crawling');
    await pushAndPatch(
      `수집 끝났습니다. 중복 정리하고 ${articles.length}건으로 추렸어요. (수집 ${Math.round((timings.crawling_ms ?? 0) / 1000)}초)`,
      'crawling',
    );

    if (articles.length === 0) {
      const output = `# 데스크 리서치 요약\n\n키워드 \`${keywords.join(', ')}\` 로 수집된 항목이 없습니다. 키워드·기간·소스 조합을 바꿔 보세요.`;
      const { data: gen } = await admin
        .from('generations')
        .insert({
          org_id: orgId,
          user_id: userId,
          feature: 'desk',
          input: JSON.stringify({ keywords, sources: usable, locale, range }),
          output,
          credits_spent: FEATURE_COSTS.desk,
        })
        .select('id')
        .single();
      await patch({
        status: 'done',
        output,
        articles: [] as unknown as object,
        generation_id: gen?.id,
      });
      return;
    }

    // ── Emergency raw-data dump (산출물 100% 보장) ─────────────────────────
    // Deterministic markdown built from collected articles + RQs only — zero
    // LLM calls, so it writes in <1s no matter how little budget is left. This
    // is the floor that makes a 0-output run impossible: if the crawl ate the
    // budget (the incident scenario), we hand back the raw sources instead of
    // dying mid-LLM-call. The report opens with a marker the client detects to
    // show the "AI 분석 미완료 — 재시도" banner.
    // Claim extraction hasn't run at this point, so the dump is articles + RQs
    // + metadata only. That is still a usable artifact (titles + source links).
    function buildRawDumpReport(): string {
      const lines: string[] = [];
      lines.push('# 📊 데스크 리서치 결과 — Raw Data');
      lines.push('');
      lines.push(
        '> ⚠️ 시간 제약으로 AI 분석을 완료하지 못했습니다. 수집된 원자료를 그대로 제공합니다. 차감된 크레딧은 자동으로 환불되었습니다.',
      );
      lines.push('');
      lines.push('## 메타데이터');
      lines.push(`- **키워드**: ${keywords.join(', ')}${similar.length ? ` (유사: ${similar.join(', ')})` : ''}`);
      lines.push(`- **지역**: ${regions.join(', ')}`);
      lines.push(
        `- **기간**: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      );
      lines.push(`- **수집**: ${articles.length}건`);
      lines.push('');
      if (researchQuestions.length > 0) {
        lines.push('## 리서치 질문 (AI 분해)');
        for (const rq of researchQuestions) lines.push(`- ${rq.question}`);
        lines.push('');
      }
      lines.push(`## 수집된 원자료 (${articles.length})`);
      for (const a of articles.slice(0, 300)) {
        lines.push(`- [${a.title}](${a.url}) — ${a.source}${a.publishedAt ? ` · ${a.publishedAt}` : ''}`);
      }
      if (articles.length > 300) lines.push(`_(나머지 ${articles.length - 300}건 생략)_`);
      lines.push('');
      lines.push(
        '---',
        '**보완 안내**: AI 분석(Findings / RQ 답변 / 정량 스냅샷)이 미완료입니다. 더 나은 결과를 원하시면 키워드를 좁히거나(예: 3개 이하) 지역/소스 수를 줄여 재실행하세요.',
      );
      return lines.join('\n');
    }

    if (timeLeft() < RAW_DUMP_AFTER_CRAWL_MS) {
      skippedSteps.push('raw_dump');
      const output = buildRawDumpReport();
      await refundOnFailure('raw_dump_budget');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — AI 분석 단계를 돌리기에 부족해, 수집한 원자료를 그대로 보고서로 드릴게요. 차감된 크레딧은 돌려드렸습니다.`,
        'summarizing',
      );
      const { data: gen } = await admin
        .from('generations')
        .insert({
          org_id: orgId,
          user_id: userId,
          feature: 'desk',
          input: JSON.stringify({ keywords, sources: usable, locale, range }),
          output,
          credits_spent: FEATURE_COSTS.desk,
        })
        .select('id')
        .single();
      await patch({
        status: 'done',
        output,
        articles: articles as unknown as object,
        generation_id: gen?.id,
        progress: {
          phase: 'summarizing',
          crawl_total: crawlTotal,
          crawl_done: crawlDone,
          events: [...events],
          timings: { ...timings },
          elapsed_ms: elapsedMs(),
          deadline_ms: HARD_DEADLINE_MS,
          skipped_steps: [...skippedSteps],
        },
      });
      return;
    }

    // ── Concurrency throttle ──────────────────────────────────────────────
    // Anthropic 30k input tokens/min is shared across the whole org. Without
    // this gate, 5 simultaneous users all fire summarize within a few seconds
    // and the slowest 3 hit 429. We poll the desk_jobs table for how many
    // other rows are currently in 'summarizing' state and wait our turn.
    // The whole loop is bounded by MAX_WAIT_MS so we never silently extend
    // past the function's maxDuration.
    // Tightened so the concurrency wait can't eat the entire remaining
    // 5-minute budget after a heavy crawl. A 90s wait + ~3min crawl was
    // leaving generateText with no room to finish; the catch block never
    // ran and jobs froze in 'summarizing'.
    const MAX_CONCURRENT_SUMMARIZE = 2;
    const MAX_WAIT_MS = 20_000;
    const POLL_MS = 3000;
    const waitStart = Date.now();
    beginPhase('gating');
    while (true) {
      await checkCancel();
      const { count } = await admin
        .from('desk_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'summarizing')
        .neq('id', jobId);
      if ((count ?? 0) < MAX_CONCURRENT_SUMMARIZE) break;
      if (Date.now() - waitStart > MAX_WAIT_MS) {
        await pushAndPatch(
          '대기열이 길어요. 그래도 한 번 시도해 볼게요.',
          'summarizing',
        );
        break;
      }
      await pushAndPatch(
        `다른 사용자 ${count}명이 보고서 작성 중이에요. 잠시 기다릴게요…`,
        'summarizing',
      );
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    endPhase('gating');

    await patch({ status: 'summarizing' });

    // ── Sample down to a representative subset for the LLM ──────────────
    // Anthropic Tier 1 한도 = 30k input tokens / min. 1500건 풀을 그대로 보내면
    // 단일 호출에 ~300k tokens 가 필요해 즉시 429. 임베딩 클러스터링으로
    // 의미적으로 다양한 80건만 추려서 보냄. 실패 시 키워드/소스 균등 fallback.
    // UI/DB 에는 1500 풀 그대로 저장됨.
    // Halved from 80 → 50 → 30. The 30 sample still covers the top topics
    // (embedding clustering preserves diversity), but cuts ~40% off extracting
    // (50 × Haiku → 30 × Haiku) and trims synthesize input by the same ratio.
    const SUMMARIZE_SAMPLE_K = 30;
    let articlesForLLM = articles;
    beginPhase('sampling');
    if (articles.length > SUMMARIZE_SAMPLE_K) {
      await pushAndPatch(
        `${articles.length}건은 한 번에 다 못 넣어서, 임베딩으로 의미가 다양한 ${SUMMARIZE_SAMPLE_K}건을 골라낼게요…`,
        'summarizing',
      );
      try {
        articlesForLLM = await pickRepresentativeArticles(
          articles,
          SUMMARIZE_SAMPLE_K,
        );
        await pushAndPatch(
          `대표 ${articlesForLLM.length}건 골랐어요.`,
          'summarizing',
        );
      } catch (err) {
        console.error('[desk] sampling failed', err);
        articlesForLLM = articles.slice(0, SUMMARIZE_SAMPLE_K);
        await pushAndPatch(
          '의미 분석은 실패했지만 80건으로 줄여서 진행할게요.',
          'summarizing',
        );
      }
    }
    endPhase('sampling');

    // ── Phase: extracting (per-article claim extraction) ───────────────────
    // Haiku is cheap enough to invoke once per representative article, so we
    // process the ~50-article sample in small parallel chunks. Failures here
    // are non-fatal — claim extraction is best-effort, and a missing/partial
    // `claims` payload should not block the report. The report prompt below
    // just gets a richer payload when extraction succeeds.
    const persistedClaims: PersistedClaim[] = [];
    // Extraction is non-fatal (the report renders from articles alone). Skip
    // if the budget is tight so drafting/synthesize gets the time it needs.
    if (timeLeft() < SKIP_EXTRACTING_BELOW_MS) {
      skippedSteps.push('extracting');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — 정량주장 추출은 건너뛰고 곧장 답변/보고서 단계로 갈게요.`,
        'extracting',
      );
      await patch({ claims: [] });
    } else {
    beginPhase('extracting');
    await pushAndPatch(
      `대표 ${articlesForLLM.length}건에서 정량주장 + 엔티티를 추출할게요…`,
      'extracting',
    );
    try {
      const claimModel = getClaimModel();
      const rqDigest = researchQuestions
        .map((rq) => `${rq.id}: ${rq.question}`)
        .join('\n');
      const CLAIM_CONCURRENCY = 8;
      let extracted = 0;
      for (let i = 0; i < articlesForLLM.length; i += CLAIM_CONCURRENCY) {
        await checkCancel();
        const chunk = articlesForLLM.slice(i, i + CLAIM_CONCURRENCY);
        await Promise.all(
          chunk.map(async (a) => {
            const tier = a.tier ?? 'unknown';
            const prompt = [
              `요청 언어: 한국어`,
              `리서치 질문 목록:`,
              rqDigest || '(없음)',
              '',
              `--- article ---`,
              `source: ${a.source}`,
              `tier: ${tier}`,
              `title: ${a.title}`,
              `url: ${a.url}`,
              a.publishedAt ? `published: ${a.publishedAt}` : '',
              a.snippet ? `snippet: ${a.snippet.slice(0, 800)}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            try {
              const result = await generateObject({
                model: claimModel,
                system: CLAIM_EXTRACT_SYSTEM,
                prompt,
                schema: ClaimExtractSchema,
                temperature: 0.2,
                maxOutputTokens: 1500,
                maxRetries: 1,
                providerOptions: ZERO_RETENTION,
                timeout: LLM_TIMEOUT_CLAIM_MS,
              });
              for (const q of result.object.quant) {
                persistedClaims.push({
                  kind: 'quant',
                  article_url: a.url,
                  tier,
                  value: q.value,
                  unit: q.unit,
                  subject: q.subject,
                  source_quote: q.source_quote,
                  rq_ids: q.rq_ids,
                  confidence: q.confidence,
                });
              }
              for (const e of result.object.entities) {
                persistedClaims.push({
                  kind: 'entity',
                  article_url: a.url,
                  tier,
                  name: e.name,
                  role: e.role,
                  source_quote: e.source_quote,
                  rq_ids: e.rq_ids,
                  confidence: e.confidence,
                });
              }
            } catch (err) {
              // Per-article failure is silent — the rest of the chunk and
              // subsequent chunks keep going. Log so we can spot systemic
              // breakage in Vercel logs.
              console.error('[desk] claim extract failed', { url: a.url, err });
            }
          }),
        );
        extracted += chunk.length;
        await pushAndPatch(
          `주장 추출 ${extracted}/${articlesForLLM.length} — 누적 ${persistedClaims.length}개.`,
          'extracting',
        );
      }
      await patch({ claims: persistedClaims });
      await pushAndPatch(
        `주장 추출 완료 — 총 ${persistedClaims.length}개 (정량 ${persistedClaims.filter((c) => c.kind === 'quant').length}, 엔티티 ${persistedClaims.filter((c) => c.kind === 'entity').length}).`,
        'extracting',
      );
    } catch (err) {
      // CancelledError must still propagate so the outer handler can mark
      // status='cancelled' + refund. Everything else (missing API key, etc)
      // is swallowed — extraction is best-effort.
      if (err instanceof CancelledError) throw err;
      console.error('[desk] extracting phase failed', err);
      await patch({ claims: [] });
      await pushAndPatch(
        '주장 추출에 실패했어요. 보고서는 그대로 진행할게요.',
        'extracting',
      );
    }
    endPhase('extracting');
    }

    await checkCancel();

    // ── Phase: drafting + critiquing (multi-pass per-RQ synthesis) ──────────
    // Top-tier desk research: each RQ gets a Sonnet draft → self-critique →
    // optional revise (only if the critique flags weaknesses). All three call
    // types share the same `summarizing` status — phases differentiate via
    // progress.phase. Failures per-RQ are non-fatal (RQ falls back to a stub
    // answer so the final report still renders the header).
    const articleByUrl = new Map(articlesForLLM.map((a) => [a.url, a]));
    function buildRqContext(rq: ResearchQuestion): {
      claims: PersistedClaim[];
      articles: DeskArticle[];
    } {
      const relClaims = persistedClaims.filter((c) => c.rq_ids.includes(rq.id));
      const urlOrder = new Set<string>();
      for (const c of relClaims) urlOrder.add(c.article_url);
      const direct = Array.from(urlOrder)
        .map((u) => articleByUrl.get(u))
        .filter((a): a is DeskArticle => !!a);
      const remaining = articlesForLLM.filter((a) => !urlOrder.has(a.url));
      // If we don't have enough directly-tagged articles, pad from the broader
      // sample so the model has something to anchor on.
      const padded =
        direct.length >= 6
          ? direct.slice(0, 12)
          : [...direct, ...remaining.slice(0, 12 - direct.length)];
      return { claims: relClaims, articles: padded };
    }

    function renderClaimsForRq(claims: PersistedClaim[]): string {
      if (claims.length === 0) return '(이 RQ 에 직접 매칭된 evidence 없음)';
      const lines: string[] = [];
      const quant = claims.filter((c) => c.kind === 'quant');
      const ent = claims.filter((c) => c.kind === 'entity');
      if (quant.length) {
        lines.push(`정량주장 (${quant.length}):`);
        for (const c of quant) {
          if (c.kind !== 'quant') continue;
          const unit = c.unit ? ` ${c.unit}` : '';
          lines.push(
            `- ${c.subject}: ${c.value}${unit} [${c.tier} · ${c.confidence}] — ${c.source_quote.slice(0, 140)} (${c.article_url})`,
          );
        }
      }
      if (ent.length) {
        lines.push('', `엔티티 (${ent.length}):`);
        for (const c of ent) {
          if (c.kind !== 'entity') continue;
          lines.push(`- ${c.name} (${c.role}, ${c.tier}) — ${c.source_quote.slice(0, 100)}`);
        }
      }
      return lines.join('\n');
    }

    function renderArticleSnippets(items: DeskArticle[]): string {
      return items
        .map(
          (a, i) =>
            `${i + 1}. [${a.source}] ${a.title}\n   url: ${a.url}\n   tier: ${a.tier ?? 'unknown'}${a.publishedAt ? `\n   published: ${a.publishedAt}` : ''}${a.snippet ? `\n   snippet: ${a.snippet.slice(0, 220)}` : ''}`,
        )
        .join('\n\n');
    }

    const rqAnswers: PersistedRqAnswer[] = [];
    // ── Mode-aware RQ cap (see spec §E + 2026-06-29 tuning) ──────────────
    // Pick the mode that answers ≥3 RQs if any can; fall back to whatever
    // mode answers ≥1. Skipping levels: full(draft+critique+revise) →
    // critique-only → draft-only. Min 1 RQ — we'd rather ship a thin
    // report than refund. Picking critique 3-RQs over full 1-RQ trades
    // self-review depth for coverage breadth, which is the better default
    // when the user wants a usable report at all.
    const remainingForRqSec = Math.max(0, timeLeft() / 1000 - RESERVE_AFTER_RQ_SEC);
    type RqMode = 'full' | 'critique' | 'draft';
    const fullCap = Math.floor(remainingForRqSec / PER_RQ_FULL_SEC);
    const critCap = Math.floor(remainingForRqSec / PER_RQ_CRITIQUE_SEC);
    const draftCap = Math.floor(remainingForRqSec / PER_RQ_DRAFT_SEC);
    let mode: RqMode;
    let perRqSec: number;
    if (fullCap >= 3) {
      mode = 'full';
      perRqSec = PER_RQ_FULL_SEC;
    } else if (critCap >= 3) {
      mode = 'critique';
      perRqSec = PER_RQ_CRITIQUE_SEC;
    } else if (draftCap >= 3) {
      mode = 'draft';
      perRqSec = PER_RQ_DRAFT_SEC;
    } else if (fullCap >= 1) {
      mode = 'full';
      perRqSec = PER_RQ_FULL_SEC;
    } else if (critCap >= 1) {
      mode = 'critique';
      perRqSec = PER_RQ_CRITIQUE_SEC;
    } else {
      mode = 'draft';
      perRqSec = PER_RQ_DRAFT_SEC;
    }
    const rawCap = Math.floor(remainingForRqSec / perRqSec);
    const budgetCap = Math.max(1, Math.min(8, rawCap));
    const skipReviseGlobal = mode !== 'full';
    const skipCritiqueGlobal = mode === 'draft';

    const originalRqCount = researchQuestions.length;
    if (originalRqCount > budgetCap) {
      researchQuestions = researchQuestions.slice(0, budgetCap);
      skippedSteps.push(`rq_cap:${originalRqCount}→${budgetCap}`);
      await patch({ research_questions: researchQuestions });
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — RQ ${originalRqCount}개 중 우선순위 상위 ${budgetCap}개만 답변할게요.`,
        'drafting',
      );
    }

    if (skipReviseGlobal && researchQuestions.length > 0) {
      skippedSteps.push('revise');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — 시간 절약을 위해 RQ 답변 보완(revise) 단계는 생략합니다.`,
        'drafting',
      );
    }
    if (skipCritiqueGlobal && researchQuestions.length > 0) {
      skippedSteps.push('critique');
      await pushAndPatch(
        `남은 시간이 매우 빠듯해서 자가검토(critique)도 건너뛰고 초안만으로 보고서로 갑니다.`,
        'drafting',
      );
    }

    beginPhase('drafting');
    if (researchQuestions.length === 0) {
      await pushAndPatch(
        'RQ 가 비어 있어서 답변 단계는 건너뜁니다.',
        'drafting',
      );
    } else {
      await pushAndPatch(
        `리서치 질문 ${researchQuestions.length}개 각각에 대해 답변 초안을 작성할게요…`,
        'drafting',
      );
      // Run RQs serially to stay under the 30k tpm Anthropic budget without
      // chaining concurrent draft+critique+revise spikes. Each RQ is bounded
      // (~3 Sonnet calls × ~2k input + ~1k output) so even 8 RQs fit the
      // 300s function budget.
      //
      // Adaptive trim: the static cap above assumed PER_RQ_BUDGET_SEC. If
      // the first RQ actually takes longer (heavy revise, slow API), we
      // measure observed time and break out early — keeping enough budget
      // for synthesize. rqAnswers gets whatever we've actually produced.
      let observedAvgSec = 0;
      let observedCount = 0;
      const totalRqs = researchQuestions.length;
      for (let idx = 0; idx < researchQuestions.length; idx++) {
        const rq = researchQuestions[idx];
        // Pre-RQ budget guard — bail out BEFORE starting this RQ if we
        // don't have enough time for it + the synthesize/analytics reserve.
        // Critical: without this, a slow RQ blows past maxDuration and the
        // function gets SIGKILLed before synthesize/fallback can run.
        // idx > 0 keeps at least one RQ attempt so we don't end up empty.
        const requiredMs = (perRqSec + RESERVE_AFTER_RQ_SEC) * 1000;
        if (idx > 0 && timeLeft() < requiredMs) {
          const skippedRqs = totalRqs - idx;
          skippedSteps.push(`rq_pre_skip:${skippedRqs}skipped`);
          await pushAndPatch(
            `남은 시간 ${Math.round(timeLeft() / 1000)}초 — RQ ${skippedRqs}개를 건너뛰고 ${idx}개 답변으로 보고서로 갑니다.`,
            'drafting',
          );
          break;
        }
        const rqStartMs = Date.now();
        await checkCancel();
        const ctx = buildRqContext(rq);
        const evidenceBlock = [
          '--- evidence (이 RQ 에 매칭된 claims) ---',
          renderClaimsForRq(ctx.claims),
          '',
          '--- 관련 article 스니펫 ---',
          renderArticleSnippets(ctx.articles),
        ].join('\n');

        // Draft
        let draftAnswer = '';
        let draftCited: string[] = [];
        try {
          const draftPrompt = [
            `리서치 질문 (id=${rq.id}, category=${rq.category}, importance=${rq.importance}/5):`,
            rq.question,
            '',
            evidenceBlock,
          ].join('\n');
          const draftRes = await generateObject({
            model,
            system: RQ_DRAFT_SYSTEM,
            prompt: draftPrompt,
            schema: RqDraftSchema,
            temperature: 0.3,
            maxOutputTokens: 2000,
            maxRetries: 1,
            providerOptions: ZERO_RETENTION,
            timeout: LLM_TIMEOUT_RQ_MS,
          });
          draftAnswer = draftRes.object.answer_md.trim();
          draftCited = draftRes.object.cited_article_urls;
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          console.error('[desk] rq draft failed', { rq: rq.id, err });
          draftAnswer = '제공된 자료로는 충분히 답하기 어렵습니다. (초안 생성 실패)';
        }

        // Critique — skipped when forceDraftOnly. Falls back to medium
        // confidence + no weaknesses so the report shell still renders.
        let critique = {
          weaknesses: [] as string[],
          missing_data: [] as string[],
          confidence: 'medium' as 'high' | 'medium' | 'low',
        };
        if (!skipCritiqueGlobal) {
          await pushAndPatch(`Q. ${rq.question} — 초안에 대한 자가검토 중…`, 'critiquing');
          try {
            const critiquePrompt = [
              `리서치 질문 (id=${rq.id}):`,
              rq.question,
              '',
              '--- 답변 초안 ---',
              draftAnswer,
              '',
              evidenceBlock,
            ].join('\n');
            const critiqueRes = await generateObject({
              model,
              system: RQ_CRITIQUE_SYSTEM,
              prompt: critiquePrompt,
              schema: RqCritiqueSchema,
              temperature: 0.2,
              maxOutputTokens: 1500,
              maxRetries: 1,
              providerOptions: ZERO_RETENTION,
              timeout: LLM_TIMEOUT_RQ_MS,
            });
            critique = critiqueRes.object;
          } catch (err) {
            if (err instanceof CancelledError) throw err;
            console.error('[desk] rq critique failed', { rq: rq.id, err });
          }
        }

        // Revise (only if critique flags weaknesses AND we still have budget).
        // skipReviseGlobal is decided once at drafting start; a tighter
        // per-RQ check (synthesize reserve + 1 revise call ~60s) handles
        // cases where extracting + first few RQs ate more than expected, so
        // later RQs gracefully degrade.
        let finalAnswer = draftAnswer;
        let finalCited = draftCited;
        const skipReviseForThisRq =
          skipReviseGlobal || timeLeft() < SYNTHESIZE_MIN_BUDGET_MS + 60_000;
        if (critique.weaknesses.length > 0 && !skipReviseForThisRq) {
          await pushAndPatch(
            `Q. ${rq.question} — 약점 ${critique.weaknesses.length}개 보완 중…`,
            'critiquing',
          );
          try {
            const revisePrompt = [
              `리서치 질문 (id=${rq.id}):`,
              rq.question,
              '',
              '--- 초안 ---',
              draftAnswer,
              '',
              '--- critique (반드시 반영할 약점 + 누락된 데이터) ---',
              `weaknesses:\n${critique.weaknesses.map((w) => `- ${w}`).join('\n')}`,
              `missing_data:\n${critique.missing_data.map((m) => `- ${m}`).join('\n') || '- (없음)'}`,
              `confidence: ${critique.confidence}`,
              '',
              evidenceBlock,
            ].join('\n');
            const reviseRes = await generateObject({
              model,
              system: RQ_REVISE_SYSTEM,
              prompt: revisePrompt,
              schema: RqDraftSchema,
              temperature: 0.3,
              maxOutputTokens: 2000,
              maxRetries: 1,
              providerOptions: ZERO_RETENTION,
              timeout: LLM_TIMEOUT_RQ_MS,
            });
            finalAnswer = reviseRes.object.answer_md.trim();
            finalCited = reviseRes.object.cited_article_urls;
          } catch (err) {
            if (err instanceof CancelledError) throw err;
            console.error('[desk] rq revise failed', { rq: rq.id, err });
            // Keep draft on revise failure — the report can still render it.
          }
        }

        rqAnswers.push({
          rq_id: rq.id,
          answer_md: finalAnswer,
          confidence: critique.confidence,
          weaknesses: critique.weaknesses,
          missing_data: critique.missing_data,
          cited_article_urls: finalCited,
        });
        await patch({ rq_answers: rqAnswers });
        await pushAndPatch(
          `Q. ${rq.question} — 답변 정리 완료 (${critique.confidence}, 약점 ${critique.weaknesses.length}건).`,
          'critiquing',
        );

        // Adaptive trim — measure observed RQ time and project remaining.
        // If finishing the rest would push us past the synthesize budget,
        // break out early so synthesize still runs against partial answers.
        const rqElapsedSec = (Date.now() - rqStartMs) / 1000;
        observedAvgSec =
          observedCount === 0
            ? rqElapsedSec
            : (observedAvgSec * observedCount + rqElapsedSec) / (observedCount + 1);
        observedCount += 1;
        const remainingRqs = totalRqs - (idx + 1);
        if (remainingRqs > 0) {
          const projectedSec = remainingRqs * observedAvgSec + RESERVE_AFTER_RQ_SEC;
          if (projectedSec > timeLeft() / 1000) {
            skippedSteps.push(`rq_adaptive_trim:${remainingRqs}skipped`);
            await pushAndPatch(
              `RQ 한 개 평균 ${Math.round(observedAvgSec)}초 — 남은 ${remainingRqs}개를 마치면 보고서를 못 만들어요. ` +
                `여기까지 ${idx + 1}개 답변으로 보고서를 만들게요.`,
              'critiquing',
            );
            break;
          }
        }
      }
    }
    endPhase('drafting');

    await checkCancel();

    // ── Phase: synthesizing (final 6-section pyramid report) ────────────────
    // Budget gate — synthesize is the irreplaceable step. If we can't fit
    // the ~60s Sonnet 6k-output call, skip the LLM and go straight to the
    // deterministic fallback report. This guarantees the user gets an
    // artifact (rqAnswers + claims + sources) instead of a refund-with-
    // nothing-to-show outcome.
    beginPhase('synthesizing');
    const skipLlmSynthesize = timeLeft() < SYNTHESIZE_MIN_BUDGET_MS;
    await pushAndPatch(
      `이제 모든 답변·증거를 묶어 6섹션 컨설팅 리포트로 합성할게요… (남은 시간 ${Math.round(timeLeft() / 1000)}초)`,
      'synthesizing',
    );

    const quantClaims = persistedClaims.filter((c) => c.kind === 'quant');
    const entityClaims = persistedClaims.filter((c) => c.kind === 'entity');
    const tierCounts = persistedClaims.reduce(
      (acc, c) => {
        acc[c.tier] = (acc[c.tier] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const claimsBlock = (() => {
      const lines: string[] = [];
      lines.push(`정량주장 ${quantClaims.length}개 (전체 표시):`);
      if (quantClaims.length === 0) {
        lines.push('(없음)');
      } else {
        for (const c of quantClaims) {
          if (c.kind !== 'quant') continue;
          const unit = c.unit ? ` ${c.unit}` : '';
          lines.push(
            `- subject="${c.subject}" | value="${c.value}${unit}" | tier=${c.tier} | confidence=${c.confidence} | article_url=${c.article_url}`,
          );
        }
      }
      lines.push('', `엔티티 ${entityClaims.length}개 (전체 표시):`);
      if (entityClaims.length === 0) {
        lines.push('(없음)');
      } else {
        for (const c of entityClaims) {
          if (c.kind !== 'entity') continue;
          lines.push(`- name="${c.name}" | role=${c.role} | tier=${c.tier} | article_url=${c.article_url}`);
        }
      }
      return lines.join('\n');
    })();

    const rqAnswersBlock = (() => {
      if (rqAnswers.length === 0) return '(작성된 RQ 답변 없음)';
      return rqAnswers
        .map((a, i) => {
          const rq = researchQuestions.find((r) => r.id === a.rq_id);
          const question = rq?.question ?? '(질문 텍스트 누락)';
          return [
            `${i + 1}. rq_id=${a.rq_id} | category=${rq?.category ?? 'unknown'} | confidence=${a.confidence}`,
            `   Q. ${question}`,
            `   A.`,
            a.answer_md
              .split('\n')
              .map((l) => `      ${l}`)
              .join('\n'),
            a.weaknesses.length
              ? `   weaknesses: ${a.weaknesses.join(' | ')}`
              : '   weaknesses: (없음)',
            a.missing_data.length
              ? `   missing_data: ${a.missing_data.join(' | ')}`
              : '   missing_data: (없음)',
          ].join('\n');
        })
        .join('\n\n');
    })();

    const articleSampleBlock = articlesForLLM
      .map(
        (a, i) =>
          `${i + 1}. [${a.source}] ${a.title}\n   url: ${a.url}\n   tier: ${a.tier ?? 'unknown'}${a.publishedAt ? `\n   published: ${a.publishedAt}` : ''}${a.snippet ? `\n   snippet: ${a.snippet.slice(0, 200)}` : ''}`,
      )
      .join('\n\n');

    const tierLine = `T1=${tierCounts.T1 ?? 0} · T2=${tierCounts.T2 ?? 0} · T3=${tierCounts.T3 ?? 0} · 미분류=${tierCounts.unknown ?? 0}`;

    const userMsg = [
      `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
      `메인 키워드: ${keywords.join(', ')}`,
      `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
      `검색 지역: ${regions.join(', ')}`,
      `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      `전체 수집: ${articles.length}건 (이 중 의미가 다양한 ${articlesForLLM.length}건을 본문에 첨부)`,
      `소스 tier 분포 (claims 기준): ${tierLine}`,
      '',
      '--- rq_answers (Research Questions & Findings 해석 섹션용 — 이미 해석 위주로 작성됨) ---',
      rqAnswersBlock,
      '',
      '--- claims (Findings · Quantitative Snapshots · Competitive Map 섹션용) ---',
      claimsBlock,
      '',
      '--- 대표 article 샘플 (Findings · Appendix 섹션용 — 사실 요약과 출처 인용에 사용) ---',
      articleSampleBlock,
    ].join('\n');

    // Fallback report builder — no LLM. Used when synthesize LLM call dies
    // (timeout, 429, network) so the user still gets a usable artifact made
    // from rqAnswers + claims + articles instead of a blank screen.
    function buildFallbackReport(reason: 'timeout' | 'error'): string {
      const lines: string[] = [];
      lines.push('# 데스크 리서치 보고서 (약식)');
      lines.push('');
      lines.push(
        reason === 'timeout'
          ? '> ⚠️ 시간 제약으로 최종 LLM 합성 단계를 못 돌렸습니다. 모은 답변·증거·출처로 약식 보고서를 구성했습니다. 차감된 크레딧은 자동으로 환불되었습니다.'
          : '> ⚠️ 보고서 합성 단계에서 오류가 발생해 약식 보고서로 대체했습니다. 차감된 크레딧은 자동으로 환불되었습니다.',
      );
      lines.push('');
      lines.push('## 🧭 개요');
      lines.push(`- **키워드**: ${keywords.join(', ')}${similar.length ? ` (유사: ${similar.join(', ')})` : ''}`);
      lines.push(`- **지역**: ${regions.join(', ')}`);
      lines.push(
        `- **수집 기간**: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      );
      lines.push(`- **수집**: 전체 ${articles.length}건 / 분석 ${articlesForLLM.length}건`);
      lines.push('');

      if (rqAnswers.length > 0) {
        lines.push(`## ❓ 리서치 질문별 답변 (${rqAnswers.length})`);
        for (const a of rqAnswers) {
          const rq = researchQuestions.find((r) => r.id === a.rq_id);
          const icon = a.confidence === 'high' ? '🟢' : a.confidence === 'low' ? '🔴' : '🟡';
          lines.push(`### ${rq?.question ?? a.rq_id}`);
          lines.push(`**신뢰도**: ${icon} ${a.confidence}`);
          lines.push('');
          lines.push(a.answer_md);
          if (a.missing_data.length > 0) {
            lines.push('');
            lines.push('**더 알아볼 점:**');
            for (const m of a.missing_data) lines.push(`- ${m}`);
          }
          lines.push('');
        }
      } else {
        lines.push('## ❓ 리서치 질문별 답변');
        lines.push('_답변 단계에 도달하지 못했습니다._');
        lines.push('');
      }

      const quant = persistedClaims.filter((c) => c.kind === 'quant');
      if (quant.length > 0) {
        lines.push(`## 📊 정량 주장 (${quant.length})`);
        lines.push('| 주장 | 수치 | 출처 | tier | 신뢰도 |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const c of quant.slice(0, 15)) {
          if (c.kind !== 'quant') continue;
          const unit = c.unit ? ` ${c.unit}` : '';
          lines.push(
            `| ${c.subject} | ${c.value}${unit} | [원문](${c.article_url}) | ${c.tier} | ${c.confidence} |`,
          );
        }
        if (quant.length > 15) lines.push(`_(나머지 ${quant.length - 15}개 생략)_`);
        lines.push('');
      }

      lines.push(`## 📚 출처 (${articlesForLLM.length})`);
      for (const a of articlesForLLM.slice(0, 50)) {
        lines.push(`- [${a.title}](${a.url}) — ${a.source}${a.publishedAt ? ` · ${a.publishedAt}` : ''}`);
      }
      if (articlesForLLM.length > 50) lines.push(`_(나머지 ${articlesForLLM.length - 50}개 생략)_`);
      return lines.join('\n');
    }

    let output = '';
    let synthesizeFailed: 'timeout' | 'error' | null = null;
    try {
      if (skipLlmSynthesize) {
        // Budget too tight for LLM synth — go straight to deterministic
        // fallback. Treated identically to a timeout fail downstream.
        throw new TimeoutError('budget_exceeded_synthesize');
      }
      const { text } = await generateText({
        model,
        system: REPORT_SYSTEM_V2,
        prompt: userMsg,
        temperature: 0.2,
        // Bumped 6000→10000. The report now has 7 sections (📝 Findings —
        // inductive emergent-topic summary before RQ interpretation). Findings
        // alone can run several topics × multiple bullets + citation links, so
        // the prior 6k ceiling started truncating the tail (Caveats / Appendix).
        maxOutputTokens: 10000,
        maxRetries: 1,
        providerOptions: ZERO_RETENTION,
        timeout: LLM_TIMEOUT_SYNTH_MS,
      });
      output = text.trim();
    } catch (err) {
      // Synthesize LLM died (timeout / 429 / network). DON'T return error —
      // build a deterministic markdown report from what we have so the user
      // still gets an artifact. Refund happens below in the same path.
      synthesizeFailed = err instanceof TimeoutError ? 'timeout' : 'error';
      console.error('[desk] synthesize failed — falling back to deterministic report', {
        synthesizeFailed,
        err,
      });
      output = buildFallbackReport(synthesizeFailed);
      await refundOnFailure(
        synthesizeFailed === 'timeout' ? 'synthesize_timeout_fallback' : 'synthesize_error_fallback',
      );
      await pushAndPatch(
        synthesizeFailed === 'timeout'
          ? '⚠️ 시간 초과로 최종 합성 단계를 못 돌렸어요. 모은 답변·증거로 약식 보고서를 만들어 드렸어요. 차감된 크레딧은 돌려드렸습니다.'
          : '⚠️ 보고서 합성 단계에서 오류가 났어요. 모은 답변·증거로 약식 보고서를 만들어 드렸어요. 차감된 크레딧은 돌려드렸습니다.',
        'synthesizing',
      );
    }
    endPhase('synthesizing');

    await pushAndPatch('보고서 받았어요. 이제 정량 분석 차트를 짜볼게요…', 'summarizing');

    // ── Analytics charts (LLM-derived, content-grounded) ───────────────────
    //
    // Anthropic 조직 한도 = 30k input tokens / minute (Tier 1). summarize
    // 가 방금 같은 분 안에서 큰 입력을 태웠으니, 여기서는 아래 셋을 함께
    // 적용해 두 번째 호출이 윈도우를 못 넘기게 합니다.
    //
    //  1) 프롬프트에서 기사 헤드라인 60개 제거 — 보고서 본문이 이미 인사이트를
    //     포함하고 있어서 차트 설계에는 충분합니다.
    //  2) 보고서 본문도 12k자로 자름 (대략 4~5k tokens) — 더 길어도 차트
    //     생성에 추가 정보가 거의 없습니다.
    //  3) 차트 JSON 출력은 1~2k tokens면 충분하므로 maxOutputTokens 를 명시
    //     해서 SDK 기본값(128k) 이 사용량 추적에 잡히지 않게.
    //  4) summarize 직후 6초 대기. retry-after 헤더 기준 1분 윈도우가 풀리는
    //     데 보통 충분합니다 (한도가 다 안 차면 무해한 sleep).
    let analytics: { charts: { type: 'bar' | 'pie'; title: string; insight: string; unit: 'percent' | 'count'; data: { label: string; value: number }[] }[] } | null = null;
    const analyticsModel = getAnalyticsModel();
    if (timeLeft() < SKIP_ANALYTICS_BELOW_MS) {
      skippedSteps.push('analytics');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — 보고서 저장을 우선해서 차트는 생략합니다.`,
        'summarizing',
      );
    } else {
      beginPhase('analytics');
      try {
        if (!analyticsModel) {
          throw new Error('missing_openai_key');
        }
        const trimmedReport = output.length > 12_000 ? `${output.slice(0, 12_000)}\n…(생략)` : output;
        const result = await generateObject({
          model: analyticsModel,
          system: ANALYTICS_SYSTEM,
          prompt: [
            `메인 키워드: ${keywords.join(', ')}`,
            `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
            '',
            '--- 직전에 작성한 보고서 ---',
            trimmedReport,
          ].join('\n'),
          schema: AnalyticsSchema,
          temperature: 0.2,
          maxOutputTokens: 4000,
          maxRetries: 1,
          providerOptions: ZERO_RETENTION,
          timeout: LLM_TIMEOUT_SHORT_MS,
        });
        analytics = result.object;
        await pushAndPatch(
          `차트 ${analytics.charts.length}개 만들었어요. 화면에 띄울게요.`,
          'summarizing',
        );
      } catch (err) {
        console.error('[desk] analytics failed', err);
        await pushAndPatch('정량 분석 차트는 못 만들었어요 — 보고서만 띄울게요.', 'summarizing');
      }
      endPhase('analytics');
    }

    const { data: gen } = await admin
      .from('generations')
      .insert({
        org_id: orgId,
        user_id: userId,
        feature: 'desk',
        input: JSON.stringify({ keywords, sources: usable, locale, range }),
        output,
        credits_spent: FEATURE_COSTS.desk,
      })
      .select('id')
      .single();

    await patch({
      status: 'done',
      output,
      articles: articles as unknown as object,
      analytics: analytics as unknown as object,
      generation_id: gen?.id,
      progress: {
        phase: 'summarizing',
        crawl_total: crawlTotal,
        crawl_done: crawlDone,
        events: [...events],
        timings: { ...timings },
        elapsed_ms: elapsedMs(),
        deadline_ms: HARD_DEADLINE_MS,
        skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
      },
    });
  } catch (err) {
    // Close any phase that was still open when the throw fired so the
    // partial timing shows where we died.
    for (const k of Object.keys(phaseStart) as PhaseName[]) endPhase(k);

    if (err instanceof CancelledError) {
      await refundOnFailure('cancelled');
      pushEvent('사용자 요청으로 작업을 중단했어요. 차감된 크레딧은 돌려드렸어요.');
      await admin
        .from('desk_jobs')
        .update({
          status: 'cancelled',
          progress: {
            phase: undefined,
            crawl_total: crawlTotal,
            crawl_done: crawlDone,
            events: [...events],
            timings: { ...timings },
            elapsed_ms: elapsedMs(),
            deadline_ms: HARD_DEADLINE_MS,
            skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
          },
        })
        .eq('id', jobId);
      return;
    }
    // TimeoutError → budget_exceeded_*. Tagged so the UI banner can say
    // "시간 초과로 작업 중단 (자동 환불)" instead of a generic stack trace.
    const isTimeout = err instanceof TimeoutError;
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[desk] runJob fatal', { isTimeout, err });
    await refundOnFailure(isTimeout ? 'timeout' : 'runtime_error');
    pushEvent(
      isTimeout
        ? '시간 초과로 작업을 중단했어요. 차감된 크레딧은 돌려드렸어요.'
        : `오류로 작업이 중단되었어요 (${message}). 크레딧은 돌려드렸어요.`,
    );
    await admin
      .from('desk_jobs')
      .update({
        status: 'error',
        error_message: message,
        progress: {
          phase: undefined,
          crawl_total: crawlTotal,
          crawl_done: crawlDone,
          events: [...events],
          timings: { ...timings },
          elapsed_ms: elapsedMs(),
          deadline_ms: HARD_DEADLINE_MS,
          skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
        },
      })
      .eq('id', jobId);
  }
}
