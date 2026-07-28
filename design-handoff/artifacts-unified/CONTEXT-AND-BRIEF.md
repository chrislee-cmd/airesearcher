# CD BRIEF — 산출물 통합 (Unified Deliverables) : 라이브러리 뷰 + 공유 뷰 셸

> **작성:** spec writer (Opus) · 2026-07-28 · **아웃바운드(writer→CD).**
> **먼저 읽을 것(SSOT):** `design-handoff/CONTEXT-PACK.md`(토큰 어휘) + `design-handoff/CD-DELIVERABLE-RULES.md`(산출물 규칙) + `design-handoff/FULLVIEW-SHELL.md`(형제 셸 — 아래 설명).
> **역할 경계(규칙 0 재확인):** CD = 프레젠테이션(레이아웃·토큰·상태별 정적 모습·문구). 워커 = 데이터/로직. 이 문서의 계약(§0)대로 **typed props 를 받는 dumb 컴포넌트** 전제로 디자인. 계약 밖 prop 이 필요하면 조용히 발명하지 말고 BUILD-SPEC 상단에 `⚠️ contract-change:` 로 표기.

---

## 왜 이걸 디자인하나 (한 문단)

앱에는 6개 기능(프로빙·동시통역·전사록·AI UT·데스크리서치·리크루팅)이 각자 산출물을 만든다. 지금까지 "산출물이 만들어진 뒤"(리스팅·공유·export)가 기능마다 제각각이었다. 이걸 **하나의 공통 계약(봉투)** 위로 통일한다. **산출물 상세 뷰(풀뷰)는 이미 `FULLVIEW-SHELL.md` 로 통일돼 있음(형제 셸).** 이번에 CD 가 새로 디자인할 표면은 **2개뿐**:

- **표면 A — 통합 산출물 라이브러리** ("내 산출물 전체"): 6기능 산출물을 한 곳에서 보는 **신규** 서피스.
- **표면 B — 공유 뷰 셸**: 공개 읽기전용 공유 페이지의 **공통 chrome**(지금은 interpreter/probing 이 각자 만듦 → 하나로).

두 표면 다 **"공유 셸 + 기능별 본문 slot"** 패턴(FULLVIEW-SHELL 과 동일 철학) — chrome 는 CD 가 한 번 디자인, 본문은 기능별. **셸은 기능 이름을 몰라야 함**(규칙: 셸 안에 feature 분기 = 버그).

---

## §0. 데이터 계약 (SSOT — 이 typed props 대로 디자인)

라이브러리의 각 행/카드는 이 한 가지 타입만 받는다. 백엔드가 `GET /api/artifacts` 로 이 배열을 준다(데이터 페칭·상태관리는 워커 소유).

```ts
type DeliverableRow = {
  feature: 'transcript' | 'desk' | 'ut' | 'recruiting';  // (후속: probing·translate)
  id: string;
  kind: string;             // 'transcript' | 'desk_report' | 'ut_insight' | 'recruiting_form'
  title: string;            // 사람이 읽는 제목 (예: "user-interview-3.m4a", "전기차 시장 2026")
  status: 'draft' | 'processing' | 'ready' | 'error';   // ← 정규화된 4-state (전 기능 공통)
  project_id: string | null;
  folder_id: string | null;
  created_at: string;       // ISO
  updated_at: string;       // ISO
  shareable: boolean;       // 공유 버튼 활성 여부
  export_formats: string[]; // ['docx','pdf','srt'] — 비어있으면 export 버튼 숨김/비활성
  meta: Record<string, unknown>;  // 기능 고유 배지용 (예: {duration_seconds, speakers_count} / {clip_count} / {sources})
};
```

- **기능 정체성 톤(파스텔)** — 기존 위젯 톤 재사용(FULLVIEW-SHELL/WIDGET-SHELL §S3 과 동일해야 함): 전사록=lavender `#e7defe` · 데스크=aqua `#bfe9ef` · AI UT=peach `#ffd9be` · 리크루팅=sun `#ffe8a8` · (프로빙=sky `#cfe6ff` · 통역=mint `#cdebd9`, 후속). **새 톤 만들지 말 것 — 재사용.**
- **status 4-state 는 전 기능 공통 어휘.** 상태 배지는 기능 무관하게 동일 시각(draft/processing/ready/error). 이게 통일의 핵심 — 기능마다 다른 상태문구를 쓰지 말 것.

---

## 표면 A — 통합 산출물 라이브러리 ("내 산출물")

### A1. 목적 / IA (제안 — CD 가 비주얼 확정)
6기능 산출물을 **한 리스트/그리드**에서 훑고, 열기(→풀뷰)·공유·export·프로젝트 이동을 한다. 제안 레이아웃:

```
┌─ 라이브러리 (앱 내 서피스, 풀폭) ─────────────────────────────┐
│  헤더: "내 산출물"  [검색▸ q]        [＋ 정렬]  [뷰 토글 리스트/그리드] │
│  좌: 필터 레일(240px)         │  우: 산출물 리스트(flex-1)            │
│   · 기능 필터(전사록/데스크/   │   각 행/카드 = DeliverableRow:        │
│     UT/리크루팅 — 파스텔 dot)  │    [기능 dot+톤] 제목 · kind          │
│   · 상태 필터(4-state)         │    status 배지 · 날짜 · meta 배지      │
│   · 프로젝트/폴더 그룹핑       │    우측 액션: [열기] [공유] [⋯ export/이동] │
│                                │                                        │
└──────────────────────────────────────────────────────────────┘
```

### A2. 반드시 그릴 상태 (규칙 4 — 전부 정적으로)
1. **idle / 채워진 리스트** — 여러 기능 섞인 목록(정체성 톤으로 한눈에 구분).
2. **loading** — skeleton 행 6개.
3. **empty (산출물 0)** — "아직 산출물이 없어요" + 위젯으로 유도하는 안내.
4. **filtered-empty** — 필터 결과 0("이 조건에 맞는 산출물 없음" + 필터 초기화).
5. **error** — 로드 실패 + 재시도.
6. **행 상태별 모습** — `processing`(진행 중, 액션 일부 비활성) · `error`(빨강 배지, 열기만) · `ready`(전 액션 활성) · `draft`.
7. **액션 비활성 규칙(정적으로 표현)** — `shareable=false` → 공유 버튼 숨김/비활성 · `export_formats=[]` → export 숨김/비활성 · `processing/error` → export·공유 비활성.
8. **뷰 토글** — 리스트 뷰 / 그리드(카드) 뷰 둘 다.
9. **행 hover / selected** · **⋯ 메뉴 열림**(export 포맷 목록 = `export_formats` 로 동적, move-to-project).
10. (선택) **다중선택 + 벌크 바** — 여러 산출물 폴더 이동 등. 그리면 좋지만 우선순위 낮음, 빠지면 BUILD-SPEC 에 명시.

### A3. 경계
- 각 행은 `DeliverableRow` 하나만 받는 dumb 카드. 정렬/필터/검색 **로직은 워커** — CD 는 컨트롤의 **모습과 상태**만.
- "열기" → 기존 풀뷰(FULLVIEW-SHELL)로 진입. 라이브러리는 풀뷰를 **다시 디자인하지 않음**(형제, 이미 있음). 진입 트리거만.

---

## 표면 B — 공유 뷰 셸 (공개 읽기전용 chrome 통일)

### B1. 목적
산출물을 링크로 공유하면 뜨는 **공개 페이지**(`/share/<token>` 류)의 **공통 chrome**. 지금 interpreter-observer(`Interpreter Observer View.dc.html`)와 probing 이 **각자** chrome 을 갖고 있음 → 하나의 셸로 수렴시키고, 기능별 본문만 slot 으로 꽂는다. **형제 참조 = `FULLVIEW-SHELL.md`**(같은 "셸+본문 slot" 구조, 단 이건 로그인 없는 공개·읽기전용 맥락).

### B2. 셸(chrome)이 소유하는 것 vs 본문(slot)이 소유하는 것
- **셸(CD 가 이번에 통일):** 상단 브랜드/헤더 밴드(기능 정체성 톤 적용 가능) · 산출물 제목 · "공유됨/읽기전용" 표식 · (해당 시) 만료·게이트 안내 · 푸터(브랜딩·워터마크) · 본문 slot 컨테이너.
- **본문(기능별, slot):** 전사록=턴 스트림 · 데스크=보고서 · UT=인사이트+클립 · 통역=대역 캡션(=기존 observer 본문). CD 는 이번에 **셸만 통일**하면 됨. 본문은 기존 것 재사용/기능별.

### B3. 반드시 그릴 상태
1. **valid · 로드됨** — 정상 공유(제목·읽기전용 배지·본문 slot 채워진 예시 1개, 예: 전사록).
2. **loading** — 셸만 뜨고 본문 skeleton.
3. **expired / revoked** — "이 공유 링크는 만료(또는 취소)되었습니다" 중립 화면.
4. **not-found / invalid token** — 잘못된 링크.
5. (해당 시) **email-gate** — 접근 이메일 입력 게이트(shared_views 는 이메일 allow-list 지원).
6. **본문 slot 예시 2개** — 서로 다른 기능(예: 전사록 vs 데스크)을 같은 셸에 꽂은 모습 → **셸이 기능 무관**임을 시각적으로 증명.

### B4. 경계
- 셸은 기능 이름을 모른다. 정체성 톤/제목/본문은 **props 로 주입**(typed). `if (feature==='ut')` 류 chrome 분기 금지.
- interpreter observer 의 오디오 채널바·캡션 등 **기능 고유 본문 컨트롤은 셸의 관심사 아님**(본문 slot). 셸은 그 위/아래의 공통 chrome 만.

---

## §6. 산출물 요청 (핸드오프 1건 = `design-handoff/artifacts-unified/from-cd/` 에)

CD-DELIVERABLE-RULES §1 대로, **표면별로**:

**표면 A — 통합 산출물 라이브러리**
- `deliverables-library.dc.html` — 위 A2 상태 전부를 정적 프레임으로(리스트+그리드, empty/filtered-empty/error/loading, 행 상태별, ⋯메뉴 열림).
- `deliverables-library-BUILD-SPEC.md` — 레이아웃·상태 트리거·문구·필터 컨트롤 스펙.
- (커스텀 지오메트리면) `GEOMETRY.md`.

**표면 B — 공유 뷰 셸**
- `share-shell.dc.html` — B3 상태 전부 + 본문 slot 예시 2개(다른 기능).
- `share-shell-BUILD-SPEC.md` — 셸 chrome 스펙 + slot 계약(본문이 받는 컨테이너 규격) + 상태 트리거.
- `GEOMETRY.md` (셸 프레임 실측).

**공통 규칙(재확인):** hex/임의 px 0 → 유틸리티 클래스(신규는 `proposed-token:`) · 전 상태 정적 · 워커가 diff 로 대조 가능한 명시성 · typed props 전제 · 계약 밖 필요는 `⚠️ contract-change:`.

---

## 부록 — 이 디자인이 붙는 백엔드(참고, CD 액션 아님)
- 리스트 데이터: `GET /api/artifacts` → `DeliverableRow[]` (spec: `pr-artifacts-deliverable-registry-list`).
- 공유 백엔드: `shared_views`(polymorphic, 토큰·만료·이메일게이트) 를 전사록·UT·데스크로 확장(후속 spec).
- export: 단일 export 레지스트리(후속 spec). `export_formats` 가 그 포맷 목록.
- **CD 는 위 백엔드를 기다릴 필요 없음** — 계약(§0)만으로 병렬 디자인 가능(계약-우선의 목적).
