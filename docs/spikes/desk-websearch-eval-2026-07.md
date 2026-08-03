# 스파이크 — 데스크 웹 기사 레인: 자체 크롤러 vs Claude 서버측 web_search (2026-07)

- **카드**: 584 · **성격**: 판단 근거용 스파이크(프로덕션 무변경) · **작성**: 2026-07-30
- **러너**: [`scripts/spikes/desk-websearch-eval.mjs`](../../scripts/spikes/desk-websearch-eval.mjs)
  (로더 [`desk-lib-loader.mjs`](../../scripts/spikes/desk-lib-loader.mjs) + [`env-shim.ts`](../../scripts/spikes/env-shim.ts) · 인용검증 [`desk-websearch-verify-citations.mjs`](../../scripts/spikes/desk-websearch-verify-citations.mjs))
- **현행 레인 SSOT**: [`src/lib/desk-sources/`](../../src/lib/desk-sources/) (naver/kakao/google-news/gdelt/web-search 어댑터) · [`src/lib/desk-source-tiers.ts`](../../src/lib/desk-source-tiers.ts) (`classifyTier`)
- **평가 대상**: 데스크 리서치의 **웹 기사 레인만**(뉴스·블로그·웹검색 크롤+요약). 통계·공시 레인(DART·KOSIS·World Bank·SEC)은 **명시적 범위 밖** — 구조화 소스는 자체 유지가 정답.

---

## 결론 (한 줄)

**국내 리서치는 현행 유지 · 글로벌/기관근거는 web_search 로 보강 — 전면 대체 부적합.**
자체 크롤러의 **국내 소스 커버리지(네이버/카카오 블로그·카페 UGC)** 는 Claude web_search 가 재현하지 못하는 압도적 우위이고(국내 3키워드 평균 국내소스 **44 vs 20**, 그나마 web_search 의 국내분은 정부·연구기관·시장조사 리포트 위주로 **국내 UGC/커뮤니티는 거의 못 잡음**), 국내 리서치가 주력 use case이므로 웹 기사 레인의 국내분은 **현행 유지**가 맞다. 반대로 **글로벌·기관 근거**는 현행 글로벌 레인이 이번 실행에서 GDELT `fetch_failed` 로 15~16건에 그친 반면 web_search 는 28~66건의 애널리스트·시장조사 소스(Morgan Stanley·Grand View·Precedence 등)를 폭넓게 회수 → **보강 가치가 분명**하다. 단 web_search 는 **10~100× 느리고(135~266s vs 1~15s)** 조사당 **수 달러**가 들며, **동적 필터링 모드에선 inline citation 이 안 붙어**(검증은 `web_search_tool_result` URL 로) 동기 크롤 파이프라인(15s task cap)에 그대로 못 얹는다.

---

## 실측 방법 (재현 가능)

- **현행 레인 = 실제 프로덕션 lib 재사용(복제 아님)**: `src/lib/desk-sources/*.ts` 의 소스 어댑터를 의존성 0 ESM 로더(`desk-lib-loader.mjs`)+env-shim 으로 그대로 import 해 `def.fetch()` 호출, `classifyTier`(실제 함수)로 tier 부여. 데스크 job/DB/크레딧 경로는 타지 않음(read-only, 크레딧 차감 0). 소스당 limit 8. KR 쿼리 region=KR(naver×3·kakao×3·google_news·web_search), EN 쿼리 region=US(google_news·gdelt·web_search).
- **Claude 레인**: Anthropic Messages API 를 raw fetch **스트리밍**으로 호출(스파이크 zero-dep 제약 — SDK 미도입), 도구 `web_search_20260209`+`web_fetch_20260209`(**동적 필터링** — Claude 가 code_execution 으로 검색결과를 컨텍스트 도달 전 필터), 모델 **`claude-sonnet-4-6`**(현행 데스크와 동일 — 비용 공정성). `pause_turn` 루프 처리.
- **테스트 키워드 5개**: 국내 3(한국어) — `실버 산업 시장 동향`·`가정간편식 HMR 트렌드`·`전기차 충전 인프라`, 글로벌 2(영어) — `AI agent enterprise adoption`·`GLP-1 weight loss market`. (일반 시장 주제 — PII 아님.)
- **덤프**: `scripts/spikes/out/desk-websearch-eval-*.json`(gitignored).

---

## 비교 표

수치는 2026-07-30 1회 실행 실측치. `[실측]`.

### ① 소스 커버리지 — 건수·tier·**한국어 소스 커버리지**(핵심 리스크)

| 키워드 | 방식 | 건수 | 국내소스 | tier(T1/T2/T3/?) |
|---|---|---|---|---|
| 실버 산업 시장 동향 [KR] | 현행 | **63** | **43** | 1 / 0 / 37 / 25 |
| | Claude | 33 | 27 | 4 / 0 / 2 / 27 |
| 가정간편식 HMR 트렌드 [KR] | 현행 | **60** | **41** | 1 / 0 / 35 / 24 |
| | Claude | 25 | 19 | 2 / 0 / 2 / 21 |
| 전기차 충전 인프라 [KR] | 현행 | **64** | **49** | 0 / 0 / 41 / 23 |
| | Claude | 27 | 13 | 2 / 0 / 2 / 23 |
| AI agent enterprise adoption [EN] | 현행 | 15 (GDELT `fetch_failed`) | 0 | 2 / 1 / 2 / 10 |
| | Claude | **28** | 0 | 0 / 0 / 0 / 28 |
| GLP-1 weight loss market [EN] | 현행 | 16 (GDELT `fetch_failed`) | 0 | 2 / 0 / 0 / 14 |
| | Claude | **66** | 0 | 2 / 2 / 0 / 62 |

**해석 (스펙 §핵심 리스크):**
- **국내 3키워드: 현행 압승.** 현행은 네이버/카카오 **블로그·카페 UGC**(T3 35~41건 — 감성·신흥 신호)를 대량 확보. Claude 의 국내분(13~27)은 회수돼도 **korea.kr·kdi.re.kr·mss.go.kr·지역언론·시장조사 리포트** 같은 **기관/정책 소스** 위주로, **네이버 블로그/카페 같은 국내 UGC 는 사실상 못 잡는다**(구조적 — Google 인덱스 기반 검색이 로그인·robots 로 막힌 국내 커뮤니티를 못 봄). 국내 UGC 감성/틈새가 필요한 리서치는 현행이 유일 경로.
- **글로벌 2키워드: Claude 우세.** 현행 글로벌 레인은 이번에 GDELT 가 두 번 다 `fetch_failed`(실패 지점 실증) → 15~16건. Claude 는 시장조사·애널리스트 소스 28~66건.
- **tier `unknown` 주의**: Claude 소스의 unknown 다수는 **품질 저하가 아니라** `classifyTier` 의 T1/T2 화이트리스트에 시장조사사(precedence/grandview/rootsanalysis 등)·연구기관 도메인이 미등재라 unknown 으로 떨어진 것. 실제로는 상당수가 T1급 근거(아래 §인용검증의 제목 참조).

### ② 인용 정확도 (링크 실존·본문 일치) — 환각 게이트

동적 필터링 모드(`web_search_20260209`)는 검색이 code_execution 을 거쳐 **모델 text 에 inline citation 을 붙이지 않는다**(5키워드 전부 inline인용 **0** — 실측). 따라서 auditable 소스는 `web_search_tool_result` 블록의 URL 이다. 이를 실제 HTTP 요청으로 검증([`desk-websearch-verify-citations.mjs`](../../scripts/spikes/desk-websearch-verify-citations.mjs)):

| # | 상태 | 키워드 | URL(제목으로 본문일치 확인) |
|---|---|---|---|
| 1 | ✅ 200 | 실버 산업 | en.wikipedia.org/wiki/APEC_South_Korea_2025 — "APEC South Korea 2025" |
| 2 | ⚠ 403(봇차단) | 실버 산업 | colliers.com/…/2024-korea-senior-housing-market — 실존 도메인, anti-bot |
| 3 | ✅ 200 | HMR | ko.accio.com/…간편식시장트렌드 — "2025년 간편식 시장 트렌드…" |
| 4 | ✅ 200·KR | HMR | foodbank.co.kr/…idxno=64510 — "2024 식품·외식업계 대세 'Health & Wellness'" |
| 5 | ✅ 200 | 전기차 충전 | pwc.com/kr/…ev-charging-outlook-2025 — "2025년 EV 충전 시장 전망 \| 삼일PwC" |
| 6 | ✅ 200·KR | 전기차 충전 | auri.re.kr/…publication_id=2116 — "공동주택 전기차 충전시설 설치 현황과 쟁점" |
| 7 | ✅ 200 | AI agent | lyzr.ai/state-of-ai-agents — "State of AI Agents in Enterprise Report" |
| 8 | ✅ 200 | AI agent | index.dev/blog/ai-agents-statistics — "50+ Key AI Agent Statistics… 2025" |
| 9 | ⚠ 403(봇차단) | GLP-1 | grandviewresearch.com/…glp-1… — 실존 도메인, anti-bot |
| 10 | ✅ 200 | GLP-1 | precedenceresearch.com/obesity-glp-1-market — "Obesity GLP-1 Market Size…" |

→ **실존 8/10**(2건은 Colliers·GrandView 의 **anti-bot 403** — 실존 도메인, 환각 아님). 반환 제목이 전부 키워드 주제와 일치 → **환각 인용 없음**. 현행 레인은 소스 API(naver/kakao/google)가 URL 을 직접 돌려주므로 실존 문제 자체가 드묾.

### ③ 요약 품질

현행 레인은 **크롤만** 하고 요약은 하류 데스크 리포트 LLM 이 별도로 한다(이 스파이크 범위 밖). Claude 레인은 **회수+필터+요약을 한 번에** 수행 — 실측 브리핑은 구조화된 한국어(예: 실버 산업 → "한국 무역협회 국제무역통상연구원에 따르면 시장규모 2020년 72조원→2030년 168조원", 한국보건산업진흥원 EU/미국/중국/일본 실버경제 수치 인용)로 **실수치·출처를 갖춘 5~8불릿 브리핑**을 산출. 요약 자체 품질은 Claude 가 turnkey 하나, 근거 소스 풀이 국내에서 좁다는 게 상위 제약.

### ④ 처리 시간

| | 현행 | Claude |
|---|---|---|
| 국내 키워드 | **1~3s** | 163~266s |
| 글로벌 키워드 | 15s (GDELT timeout 포함) | 135~174s |

Claude 는 **10~100× 느림**. 현행의 15s task timeout(`CRAWL_TASK_TIMEOUT_MS`, desk-crawl.ts)에 그대로 못 얹음.

### ⑤ 비용 / 조사 1건

| | 현행 | Claude |
|---|---|---|
| 키워드당 | 사실상 무료 (naver/kakao/google 무료, Tavily basic 저렴) | **$0.95 ~ $2.21** |
| 산정 | — | web_search $10/1k회 × 5~9회 + 토큰(sonnet 4.6 $3/$15 per MTok) × in 280k~670k. 동적필터링 code_execution 은 web_search 동반 시 무료. |
| 5키워드 조사 1건 | ~0 | **≈ $6.8** (실측 합계) |

출처: [Anthropic web search tool 요금 $10/1,000검색](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) · [Claude 요금 sonnet 4.6 $3/$15](https://platform.claude.com/docs/en/pricing) · Tavily 요금 [tavily.com/#pricing](https://tavily.com). 현행 크롤 비용은 naver/kakao/google-news RSS 가 무료라 사실상 0(Tavily 만 유료·저렴).

### ⑥ 운영 유지비 (파이프라인 코드량·실패 지점)

| | 현행 | Claude |
|---|---|---|
| 코드량 | 소스별 어댑터 다수(`desk-sources/*.ts` — naver/kakao/google/gdelt/tavily + helpers + tiers) | 도구 2개 선언, 크롤 코드 0 |
| 실패 지점 | 소스별 API 변경·키·레이트리밋·파서 (이번 실행에서 **GDELT `fetch_failed` 2/2** 실증) | Anthropic API 1개 |
| 유지비 | 높음(소스 수만큼) | 낮음 |

→ **유지비는 Claude 압승** — 스펙이 지목한 "소스별 버그 이력" 문제를 web_search 는 도구 1개로 흡수. 단 그 대가가 국내 커버리지 상실 + 속도/비용.

---

## 후속 권고 (통합 지점 초안)

**권고: 국내 웹 기사 레인은 현행 유지, 글로벌/기관 근거 보강용으로 `claude_web` 레인 선택 도입.**

채택 시 통합 지점(초안):
1. **새 소스 어댑터** `src/lib/desk-sources/claude-web.ts` = `DeskSourceDefinition`:
   - `id: 'claude_web'`, `category: 'news'`, `group: 'global'`, `envKeys: ['ANTHROPIC_API_KEY']`.
   - `fetch({keyword,region})` → Messages API(web_search_20260209, 스트리밍) 호출 → `web_search_tool_result` URL 을 `DeskArticle[]` 로 매핑(`source:'claude_web'`, snippet=검색결과 title/발췌, `classifyTier` 는 dedupe 후 자동). tavily `web-search.ts` 와 동일 매핑 패턴.
2. **동기 크롤 파이프라인엔 얹지 말 것** — 135~266s 는 `CRAWL_TASK_TIMEOUT_MS`(15s) 초과. **별도 비동기 잡**(desk_jobs realtime 패턴)이나 "글로벌 근거 보강" 전용 버튼/옵션으로 분리. 크레딧 스킴에 web_search 실비($1~2/키워드) 반영 필요.
3. **국내 UGC 는 현행 유지** — `claude_web` 은 국내 네이버/카카오 UGC 를 대체하지 못하므로 KR region 기본 소스 세트는 불변. `claude_web` 은 글로벌/영문·기관근거 보강에 한정.
4. **인용 처리**: 동적필터링 모드는 inline citation 이 없으므로, 통합 시 근거 표시는 `web_search_tool_result` URL 목록을 쓴다(모델 text 의 인용 파싱에 의존하지 말 것).
5. **GDELT `fetch_failed` 는 별건**으로 점검 — 이번 스파이크에서 현행 글로벌 레인의 실패 지점이 드러남(web_search 도입과 무관하게 고쳐야 하는 회귀).

---

## 실측 상태 (정직성 명시)

- ✅ 양 레인 5키워드 라이브 실행 완료(현행 실제 lib · Claude 라이브 API). 위 표는 전부 `[실측]`.
- ✅ 인용 실존 HTTP 검증 10건(8 live, 2 anti-bot 403, 환각 0).
- 단일 1회 실행이라 절대수치는 키워드·시점 의존(web_search 회수건수·비용은 실행마다 변동). 재실행: `bash scripts/spikes/desk-websearch-eval.sh --limit 8`. 결론(국내 UGC 커버리지 우위·글로벌 보강가치·속도/비용/유지비 트레이드오프)은 구조적이라 단발 변동에 견고.
