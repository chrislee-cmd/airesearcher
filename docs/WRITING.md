# Writing System — 카피·i18n SSOT

이 문서는 AI Researcher 의 **모든 유저-facing 텍스트**(UI 카피 · 에러 메시지 · LLM
프롬프트의 유저 노출부 · 마케팅)가 따르는 단일 진입점입니다. 새 키를 만들거나
카피를 쓸 때, 로케일을 추가할 때 먼저 읽으세요.

규칙서지 에세이가 아닙니다 — 각 챕터는 "무엇을 강제하고, 왜, 어떻게 우회하는가"만
답합니다. 일부는 CI 가 자동 강제합니다(§7). 프로젝트 전반 규칙은 `PROJECT.md`,
디자인 토큰은 `docs/DESIGN_SYSTEM.md` 가 SSOT — 이 문서는 **글자**만 다룹니다.

지원 로케일: **en**(default) · **ko** · **ja** · **th**.

---

## 1. 불변식 (2개 — 절대 규칙)

### 불변식 ① — 디폴트(영어) 뷰에 한글 노출 금지
유저가 명시적으로 Korean 으로 바꾸지 않는 한, 앱 어디에서도 한글이 보이면 안 됩니다.
**근본 원인은 코드에 하드코딩된 한글 문자열 리터럴** — 이건 로케일과 무관하게 `/en`
뷰에도 그대로 나옵니다. 따라서:

> 유저-facing 소스(`src/components/**`, `src/app/[locale]/**`, `src/lib/**`)에
> **한글 문자열 리터럴을 직접 쓰지 않는다.** 모든 유저 노출 텍스트는
> `messages/{en,ko,ja,th}.json` 에서 온다.

이건 사람의 주의가 아니라 **CI 가 강제**합니다(§7 — 한글 리터럴 ratchet 가드).

**예외**(가드 화이트리스트):
- `src/app/[locale]/(app)/admin/**`, `.../design-system/**` — 내부 도구. 한글 자유.
- `src/app/[locale]/(canvas-lab)/**` — 라우팅되는 `page.tsx` 없는 내부 dev
  샌드박스(레퍼런스 구현). production `/canvas` 는 `(app)/canvas` 라 별개.
  admin·design-system 과 동급 내부 표면.
- 코드 **주석** — 자유(AST 라 애초에 검출 안 됨).
- **유저 입력 데이터**·fixture·`ko.json` 값 비교 코드·정규식 등 정당한 한글 — 같은 줄
  또는 윗줄에 `// i18n-allow-korean -- 사유` 지시자로 개별 예외.
- Phase 1 **언어 제안 배너**(비영어 브라우저에게 "한국어로 볼래요?" 제안) — 의도된 예외.

### 불변식 ② — raw 키 노출 금지
`Features.foo.title` 같은 **번역 키 자체가 화면에 뜨면 안 됩니다.** 키 누락 시
`next-intl` 은 키 문자열을 그대로 렌더합니다. 신규 키는 **최소 en 값**을 반드시
동반하고(§3), 4로케일 fallback 사슬은 `en` 을 최종 안전망으로 둡니다(Phase 2 참조).

---

## 2. 키 아키텍처

### 네임스페이스 (기존 관례 성문화)
top-level 네임스페이스 = 화면/도메인 단위. 현행: `Landing` · `Auth` · `Topbar` ·
`Sidebar` · `SidebarGroups` · `Dashboard` · `Projects` · `Features` · `Canvas` ·
`Widgets` · `Credits` · `Desk` · `TranslateConsole` · `InterviewsV2` · `Members` ·
`Org` · `Scheduler` · `Moderator` · `ShareViewer` · `Common` 등.

- **피처별 카피**는 `Features.<featureKey>.{title,description,cost}` — `featureKey` 는
  `src/lib/features.ts` 의 `FeatureKey` 와 1:1(§13 새 피처 레시피).
- **사이드바 라벨**은 `Sidebar.<featureKey>`.
- 여러 화면이 공유하는 짧은 단어(저장/취소/공유 등)는 `Common.*`.

### 키 네이밍
- leaf 키는 **camelCase**, **의미 기반**(위치·색이 아니라 역할). `Sidebar.probing` ✓,
  `Sidebar.blueButton` ✗.
- 계층은 얕게. 3단계 넘으면 네임스페이스 분리 신호.

### 재사용 vs 중복
- **문맥이 같으면 재사용**, **문맥이 다르면 중복 허용.** "Save" 버튼과 "Save" 메뉴가
  로케일에 따라 다른 단어가 될 수 있으므로(ja/th) 억지 공유 금지.
- 애매하면 중복. 잘못된 공유는 한 쪽 카피를 고칠 때 다른 화면을 깬다.

### 키별 intent (신규 키 워크플로)
신규 키를 추가하는 PR 은 본문에 **키의 의도를 1줄** 남깁니다 — "이 키는 어떤 상황에
어떤 톤으로 보이는가". 번역자·LLM·다음 기여자가 값을 재작성할 때 기준이 됩니다.
예: `Desk.emptyState = "아직 리서치가 없어요"` → intent: "데스크 첫 진입, 빈 상태를
부담 없이 안내."

---

## 3. 카피 모델 — per-locale native

**키 구조는 4로케일 공유, 값은 로케일별 네이티브 최적.** en 과 ko 는 각각 **1st-class**
로 그 언어에서 가장 자연스럽게 작성합니다 — **서로 번역 관계가 아닙니다.** 직역투
("번역기 냄새")는 금지.

- **en**: 미국 SaaS 톤 기준(§4).
- **ko**: 한국어로 자연스럽게. en 을 옮긴 티가 나면 안 됨.
- **ja / th**: **LLM-tier** — `pnpm i18n:seed`(Sonnet + 용어집 §5 주입 + 2-pass)로
  en 100% 백필, 자동 품질 게이트 통과분 반영. 추후 네이티브 검수로 승격 가능(선택).

로케일별로 값이 달라도 **묶는 장치는 두 가지**:
1. **Semantic parity** — 같은 키 = 같은 의도·같은 정보량. 한 로케일에만 있는 정보를
   넣지 않는다(A/B 문구 실험은 키를 나눔).
2. **용어집**(§5) — 제품 용어는 로케일마다 **고정 대역**. 자유 재작성은 문장 톤에만,
   용어는 표를 따른다.

### 신규 키 워크플로 (순서 강제)
1. **en 원문 필수** — en 이 없으면 fallback 이 깨진다(불변식 ②).
2. **ko 네이티브** — 직역이 아니라 한국어 최적.
3. **ja / th 필수 — 누락 불가(Phase 8 hard-lock).** en/ko/ja/th 는 이제 4로케일
   모두 **exact key parity** 를 CI 가 강제한다(`scripts/check-i18n.ts`, 옛
   `SUBSET_OF_EN` 면제 제거). en fallback 은 더 이상 허용되지 않는다 —
   누락 키는 CI red. 새 키를 en+ko 로 추가한 뒤 `pnpm i18n:seed` 로 ja/th 를
   백필한다(용어집 §5 자동 주입 + 2-pass + ICU/빈값/한글잔류 게이트). 시드는
   멱등이라 기존 ja/th 값은 보존하고 빈 키만 채운다. 네이티브 검수는 선택 상향 패스.

---

## 4. Voice & Tone (en)

en 은 제품의 얼굴입니다. 미국 SaaS 관례:

- **Sentence case** — 제목·버튼 모두. `Create project` ✓, `Create Project` ✗
  (고유명사·브랜드 제외).
- **CTA 는 동사로 시작** — `Start interview`, `Generate report`, `Invite members`.
- **간결·직설** — 불필요한 관사·수식 제거. `You can now export…` → `Export your…`.
- **마침표**: 완전한 문장(설명·토스트)엔 마침표. 라벨·버튼·짧은 헤드라인엔 없음.
- **이모지**: 프로덕트 UI 본문엔 지양. 온보딩·빈 상태의 의도적 악센트만 예외.
- **You/유저 지칭**: 2인칭 `you`. 시스템을 1인칭 `we` 로 과하게 의인화하지 않음.

### ko 톤 (요약)
- 기본 **해요체**(정중·친근). 시스템 알림은 간결한 종결.
- 번역투 금지 — "~을 위한", "~에 대해" 남발 X. 능동·짧게.
- 용어는 §5 표 고정, 문장 톤만 자유.

---

## 5. 용어집 (Glossary) — 4로케일 고정 대역

제품 핵심 용어의 **고정 번역**입니다. UI·LLM 프롬프트·마케팅 공용. 문장 톤은 자유롭게
쓰되 **아래 용어는 표대로**. `(신규)` = 현재 메시지에 대역이 없어 신규 작성 대상.

| 개념 (canonical) | en | ko | ja | th |
|---|---|---|---|---|
| canvas | canvas | 캔버스 | キャンバス | แคนวาส |
| widget | widget | 위젯 | ウィジェット | วิดเจ็ต |
| credit(s) | credit(s) | 크레딧 | クレジット | เครดิต |
| project | project | 프로젝트 | プロジェクト | โปรเจกต์ |
| organization / org | organization | 조직 | 組織 | องค์กร |
| member | member | 멤버 | メンバー | สมาชิก |
| workspace | workspace | 워크스페이스 | ワークスペース | เวิร์กสเปซ |
| session | session | 세션 | セッション | เซสชัน |
| transcript (전사록) | transcript | 전사록 | 文字起こし | ทรานสคริปต์ |
| quote / VOC quote | quote | 인용구 | 引用 | คำพูด |
| insight(s) | insight | 인사이트 | インサイト | อินไซต์ |
| probing assistant | probing assistant | 프로빙 어시스턴트 | プロービングアシスタント `(신규)` | ผู้ช่วยโพรบ `(신규)` |
| live interpretation (동시통역) | live interpretation | AI 동시통역 | AI同時通訳 | ล่ามแปลสด AI |
| AI UT / user test | AI UT | AI UT | AI UT | AI UT |
| moderator | AI moderator | AI 모더레이터 | AIモデレーター | AI moderator |
| desk research | desk research | 데스크 리서치 | デスクリサーチ | เดสก์รีเสิร์ช |
| topline | topline | 탑라인 | トップライン | ท็อปไลน์ |
| affinity (bubble) | Affinity Bubble | Affinity Bubble | アフィニティバブル | Affinity Bubble |
| report | report | 리포트 | レポート | รายงาน |
| respondent (설문·인터뷰) | respondent | 응답자 | 回答者 | ผู้ตอบ |
| participant (일정·세션) | participant | 참석자 | 参加者 | ผู้เข้าร่วม |
| share / viewer | share / viewer | 공유 / 시청자 | 共有 / 閲覧者 | แชร์ / ผู้ชม |

### 용어집 규율 (해소해야 할 실측 불일치)
- **respondent vs participant** — ko 는 두 개념을 **의도적으로 분리**한다:
  설문·인터뷰 응답자는 **응답자**, 일정·세션 참석자는 **참석자**. 혼용 금지.
- **moderator** — 표기는 `AI moderator`(en) / `AI 모더레이터`(ko). 브랜드성 유지로
  ja/th 는 로마자 `moderator` 허용.
- **AI UT** — 4로케일 모두 약어 유지(번역·전개 금지).
- **Affinity Bubble** — 제품명, 4로케일 로마자 고정.
- **insight** — ja 접미사는 `インサイト`로 통일(`-機/-器` 혼용 금지).

신규 용어를 추가할 땐 이 표에 4로케일 대역을 먼저 채운 뒤 카피에 씁니다.

---

## 6. 로케일 조판·포맷

### 줄바꿈 / 조판
- **ko**: `word-break: keep-all` — 어절 중간 끊김 방지(기존 관례, 유지).
- **ja**: 조사·금칙 처리 주의. 임의 위치 강제 줄바꿈(`<br>`) 지양.
- **th**: 단어 경계가 공백이 아님 — CSS 자동 줄바꿈에 맡기고 수동 분절 금지.

### 텍스트 팽창 (레이아웃)
en → ja/th 는 길이가 크게 달라집니다. **고정폭 버튼·배지에 텍스트를 하드-핏하지 말 것.**
`min-width` + `truncate`/`line-clamp` 로 여유를 두고, 가장 긴 로케일 기준으로 확인.

### 날짜·숫자·통화 (수동 포맷 금지)
- 날짜·시각·숫자·통화는 **반드시 `Intl.*`**(`Intl.DateTimeFormat` /
  `Intl.NumberFormat`) — 로케일을 인자로. `"2026년 7월"` 같은 **수동 문자열 조립 금지**
  (그 자체가 불변식 ① 위반이자 로케일 하드코딩).
- **통화 표기 기준은 USD** — `Intl.NumberFormat(locale, { style: 'currency',
  currency: 'USD' })`. (계좌이체 KRW rail 은 결제 문맥 한정 — `docs/pricing-scheme.md`.)

---

## 7. 가드 운영 — 한글 리터럴 ratchet

불변식 ①을 CI 로 강제하는 장치.

- **스크립트**: `scripts/check-korean-literals.ts` — TypeScript AST 로 문자열/템플릿/JSX
  텍스트 리터럴만 검사(주석은 trivia 라 제외). `pnpm check:korean` 으로 실행.
- **baseline**: `.i18n-korean-baseline.json` — 현 위반을 **파일별 카운트**로 스냅샷.
- **CI 규칙**(`.github/workflows/ci.yml` › `Korean literal guard`): 파일별 현재
  카운트가 baseline 을 **초과하면 red**(신규 유입 차단). 신규 파일은 baseline 없음 = 0
  허용. 감소하면 green + baseline 갱신 권장 안내.
- **스윕과의 관계**: 이 가드는 신규 유입만 막습니다. 기존 한글 제거(스윕)는 후속
  Phase 4~7 이 담당하며, 스윕 PR 은 baseline 을 **단조 감소**시킵니다. 스윕 후
  `pnpm check:korean --update` 로 baseline 을 조입니다(느슨해지는 방향 갱신 금지).

### 예외 처리 (2단계)
1. **화이트리스트**(스크립트 상수) — 파일/디렉토리 통째 제외. admin·design-system·
   (canvas-lab)·테스트·`.d.ts`·언어 제안 배너. 새 내부 도구 표면은 여기 추가.
2. **라인 지시자** `// i18n-allow-korean -- <사유>` — 같은 줄 또는 바로 윗줄. 정당한
   한글(정규식·`ko.json` 값 비교·fixture) 한 줄만 예외. **사유 필수.**

### 알려진 한계
- `src/components/admin/**`, `src/lib/admin/**` 등 route dir 밖의 admin **구현** 파일은
  화이트리스트가 아니라 **baseline 에 grandfather** 됩니다(스펙 화이트리스트 = route dir
  2개로 한정, `google-oauth-admin.ts` 처럼 "admin" 이 우리 내부 도구가 아닌 오탐 회피).
  이들에 새 한글이 필요하면 라인 지시자 또는 화이트리스트 승격(별도 PR).
- 검출 단위는 **리터럴 노드**. 치환 있는 템플릿은 head/tail 파트마다 카운트됩니다.

---

## 참고
- `PROJECT.md` — 프로젝트 전반 규칙·브랜치·함정 SSOT.
- `docs/DESIGN_SYSTEM.md` — 디자인 토큰·primitive.
- `src/lib/features.ts` — FeatureKey ↔ `Features.*` 키 매핑 SSOT.
- 후속 스윕: Phase 4(크롬/셸) · 5(keep-4 위젯) · 6(auth/billing/랜딩) · 7(LLM/이메일).
