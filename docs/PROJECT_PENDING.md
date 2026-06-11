# PROJECT.md 갱신 후보 (Inbox)

PROJECT.md(SSOT)에 반영될 수도 있는 후보들의 inbox.
룰은 [PROJECT.md §5.4](../PROJECT.md).

- 마스터가 PR 머지 후 §5.4 self-check 룰에 따라 append.
- 워커도 작업 중 발견한 SSOT 후보(새 함정, 새 절차)를 직접 추가 가능.
- 5건 누적 시 마스터가 묶어서 PROJECT.md 갱신 PR 제안.
- 폐기 후보는 line 삭제 + 이유 한 줄을 commit 메시지에.

## Inbox

<!-- 형식: - YYYY-MM-DD · PR #XXX · §X.Y · 한 줄 요약 -->
- 2026-06-10 · 본 PR (z-index 토큰) · §9 (아키텍처) · z-index 스케일을 globals.css `@utility` 로 토큰화 (`z-table-sticky/cell-sticky/resize/fab/modal/toast/overlay`). 새 fixed/overlay 레이어 추가 시 `z-[NN]` 하드코드 금지하고 이 토큰 중 하나 사용 — 향후 §9 디자인 시스템 섹션 또는 `docs/design-system.md` 에 layer table 명시 필요.
- 2026-06-10 · 본 PR (radius 토큰) · §9 (아키텍처) · radius 스케일을 `@theme --radius-{xs(4),sm(14),md(24),lg(32),pill(999)}` 토큰으로 통일 (230 사이트 마이그). 새 fixed-radius 사용 시 `[border-radius:NNpx]` 하드코드 금지하고 `rounded-{xs,sm,md,lg,full}` 사용. 잔여 22개 outlier(2/3/8/10px) 는 후속 PR 에서 디자인 합의 후 정리 (정규화 vs 스케일 확장).
- 2026-06-11 · PR #256 · §9 (아키텍처) · radius/z-index 토큰 회귀 방지 lint scope `design-system/no-hardcoded-tokens` 추가. 토큰 매핑된 radius 값(4/14/24/999/9999) 과 모든 `z-[N]` 을 error 로 차단. outlier radius(2/3/8/10px) 와 `text-[Npx]` 는 통과 (B-1 미완). §9 에 lint scope 이름 명시 필요.
- 2026-06-11 · PR #252 · §7 (함정) · `await supabase.auth.signOut({ scope: 'others' })` 를 `signInWithPassword`/`exchangeCodeForSession` 직후 같은 클라이언트에서 호출하면 방금 set 된 sb-* 쿠키까지 같이 무효화. 일반 브라우저(기존 다른 세션 존재)에서만 재현, 인코그니토는 영향 없음 → 디버깅 시 항상 일반 브라우저로 확인. fire-and-forget (`void ....catch(()=>{})`) 으로 회피. 단일-세션 강제는 보안 게이트가 아니라 UX 피처라 best-effort 로 충분.
- 2026-06-11 · 본 PR (quote search recall) · §7 (함정) · PostgreSQL `'simple'` tsv config 은 한국어 합성·조사 결합 형태에 under-recall ("광고" 가 "광고는/광고를" 토큰을 못 잡음). 짧은 텍스트(<1KB) 에 대한 substring 검색은 `pg_trgm` GIN + ILIKE 가 언어 무관하게 robust. tsvector + websearch_to_tsquery 는 영어/공백분리 도메인에서만 권장.
- 2026-06-11 · 본 PR (design-system page F-1) · §9 (디자인 시스템) · in-app 디자인 카탈로그 페이지 `/design-system` (super admin gate) 신설 — Radius / Color / Z-index 토큰 섹션 포함. 후속 F-2~5 PR 에서 Primitives (Button / Input / Modal / Menu) 섹션 추가. §9 본문에 "카탈로그: `/design-system` (super admin)" 한 줄 추가 가능 (후속 SSOT refresh PR 에서).

