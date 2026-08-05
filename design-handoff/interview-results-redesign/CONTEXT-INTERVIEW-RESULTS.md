# CONTEXT — 인터뷰 결과 생성기 (interviews) 디자인 표면 전수 추출

> **용도**: 리디자인 CD 인풋 1/2 (짝: `REDESIGN-BRIEF.md` + `REPORT-CONTENT-RULES.md`). origin/main 2026-08-05 기준, writer 검수. 코드 참조는 대조용 — 재현이 아니라 **현황 파악**용.

## A. 위젯 카드 (`src/components/canvas/widgets/interviews-card.tsx`, 704줄)

- **메타**: label "인터뷰 결과 생성기" · accent `peach` (⚠️ AI UT 정체성 톤과 동일 — 아래 브리프 §쟁점) · 💎10 · expandedCols 3 · thumbnail analysis.png.
- **Idle**: ControlBoardPanel 안에 ① `ProjectSelectControl`(프로젝트 선택/생성 드롭다운, "＋ 새 프로젝트"=text-amore) ② `ControlDropzone`(드래그앤드롭, txt/md/csv/json/doc(x)/pdf/오디오/비디오, 25MB) ③ 비활성 CTA. 프로젝트 미선택 업로드 시 UploadModal 이 선택 게이트 강제.
- **Active** (3층): 상단 고정 컨트롤바(프로젝트 전환+인라인 업로드) → `WidgetOutputRegion`(스크롤) → `ToplineAmbientProgress` 밴드(shrink-0) → "분석 시작" CTA.
  - OutputRegion 4모드: **abstract**(완료 요약 카드: "핵심 요약" 칩 bg-amore-bg · 제목 2줄 clamp · 요약 5줄 clamp · 키포인트 불릿 3~4 · 파일 개수 칩 + "전체 보기" 링크 · `<details>` 파일 토글) / **generating**(파일 목록+인덱싱 진행 "N/M chunks") / **analyze-prompt**(보고서 없음 안내 박스) / **empty**(EmptyState subtle).
  - 파일 인덱싱 단계 시각화: 업로드→파싱→청킹→임베딩 4단 타임라인.
  - `ToplineAmbientProgress`: 풀뷰를 닫아도 카드에서 생성 진행이 보이는 전용 밴드 — Map "N/M 문서 분석"+진행바 / Reduce "작성 중(N블록)"+펄스 도트, 완료/실패 Toast.
- 상태 persist: localStorage `interview-v2-card-active-project`.

## B. 전체보기 (리디자인 본체)

### B1. 셸/진입 (`interviews-v2/interview-v2-fullview.tsx`)
- `WidgetFullviewPanel` (공유 v2 셸: title/subtitle/headerAction/닫기×) — **§F FullviewShell 사이드바 셸이 아니라 구형 패널 셸** 사용 중 (브리프 §쟁점).
- 3뷰: **list**(프로젝트 목록) / **detail**(단일 프로젝트 — 본체) / **cross**(크로스 프로젝트 검색).

### B2. ProjectDetail 레이아웃 (`interviews-v2/project-detail.tsx`)
```
┌ 뒤로 · 프로젝트명 ──────────── [🌐 전체 검색] ┐
├─ 좌: 파일 패널 (lg:basis-5/12, 접기 ◀) ─┬─ 우: 탭 (lg:flex-1) ──┤
│  "업로드된 파일" + 📤 업로드            │  [탑라인 | 검색] 탭     │
│  · 탑라인 생성 진행률(map/reduce)      │  ToplineView            │
│  · 검색 읽음 진행률(파일 순차)         │  or SearchChat          │
│  · 파일 그리드 grid-cols-5             │  (둘 다 상시 mount)     │
│    FileCard 상태: reading/readDone/    │                          │
│    analyzing(amore)/analyzed           │                          │
└──────────────────────────────┴──────────────────┘
```

### B3. ToplineView (`interviews-v2/topline-view.tsx`, ~1300줄)
- **헤더** (blocks 있을 때만): "탑라인 리포트" uppercase 라벨 ↔ 액션 그룹 [⬇ Word · 📄 Gdoc 공유(⏳ 토글) · 🔗 초대공유(ShareInviteButton)] | divider | [언어 SelectMenu w-[132px] · 🔄 재생성].
- **본문 4상태**: 로딩 skeleton / **생성 중**(skeleton+map·reduce 진행+중단 버튼) / **완료 보고서**(stale·stuck 배너 + 블록 스트림 + 블록 사이 hover ＋버튼 SectionGap + pending Q&A/섹션 카드) / **빈 상태**(인트로 + 언어 선택 + [생성|보고서 업로드] 2버튼).
- **재생성**: 방향 자유입력 textarea (최대 600자) + 언어 선택.

### B4. 블록 렌더러 (`interviews-v2/topline-blocks.tsx`) — 11종 현행 트리트먼트

| 블록 | 현행 시각 |
|---|---|
| executive_summary | `rounded-sm border-line-soft bg-paper-soft px-5 py-4` 리치 카드 (summary 문단 + key_points 불릿) |
| heading | H2 `text-xl font-semibold` + border-b 구분선, mt-8 |
| subheading | H3 `text-md font-semibold text-ink-2` |
| paragraph | 마크다운 prose (`text-md leading-[1.7]`, 링크 text-amore) |
| insight | 좌 `border-l-2 border-line` 회색 강조 |
| quote | 좌 `border-l-2 border-amore` + `bg-amore-bg` + italic + attribution |
| table | `bg-paper-soft` 박스 안 표 |
| chart / pie | recharts, h-60 고정, 5색 팔레트(amore·ink·mute·#f97316·#a855f7 순환) |
| inserted_qa | 좌 amore 선 + Q&A 박스 (question + selected_excerpt) |
| inserted_section | 좌 amore 선 + ✚ 칩 |

- 인용: inline `[chunk_id]` 토큰은 화면에서 strip, citations 배열만 보존 (근거 UI 미노출 상태 — 브리프 §쟁점).

## C. 공유·Export 표면
- **Word 다운로드** `GET /topline/export?format=docx` · **Google Docs 공유**(진행 토글+클립보드+새탭+토스트) · **초대 링크** `ShareInviteButton resourceType="interview_topline"` (shared_views — 이메일 게이트 모달).

## D. 데이터 계약 (typed props — 디자인이 받는 전부)

```ts
type ToplineBlock = {
  id: string;                    // blk_NN — DOM anchor
  type: /* 위 11종 */;
  md?: string; citations?: string[]; attribution?: string;
  question?: string; selected_excerpt?: string;   // inserted_qa
  prompt?: string;                                 // inserted_section
  table?: { headers: string[]; rows: string[][] };
  summary?: string; key_points?: string[];         // executive_summary
  title?: string; chartKind?: 'bar'|'line';
  data?: { label: string; value: number }[]; description?: string;
};

type ToplineReadResult = {
  id: string | null;             // 공유용 toplineId
  status: 'none'|'idle'|'generating'|'done'|'error'|'cancelled';
  blocks: ToplineBlock[];
  stale: boolean;                // 파일 변경 → 재생성 배너
  indexed: boolean;
  generated_at: string | null; model: string | null;
  error_message: string | null;
  output_lang: 'ko'|'en'|'ja'|'zh'|'es'|'th' | null;
  user_direction: string | null; // 재생성 방향 (≤600자)
  source: 'uploaded'|'generated'|null;
  map_total: number | null; map_done: number | null;  // 생성 진행
  updated_at: string | null;     // stuck 감지
};
```

## E. 토큰/스타일 현황 + 임의값 (정리 대상 후보)

- 강조 전부 amore 계열 (text-amore/bg-amore-bg/border-amore). 카드 accent = peach.
- 셸: 카드=WidgetShell(공통) · 풀뷰=**WidgetFullviewPanel(구형)** — §F FullviewShell 미사용.
- **임의값 플래그** (tokens 2.0 위반 후보 — 리디자인에서 토큰화): `w-[132px]`(언어 셀렉트) · `grid-cols-5`(파일 그리드) · `h-60`(차트) · skeleton 높이들 · 차트 팔레트에 hex 2개(#f97316/#a855f7).

## F. 진입 경로 전수
1. 캔버스 카드 헤더 "전체보기" / 카드 "분석 시작" CTA → 풀뷰
2. 카드 abstract의 "전체 보기" 링크
3. `/interviews` 리다이렉트 → `/canvas?focus=interviews`
4. `/library`(산출물 라이브러리)의 interview 행 → 열기 *(assign registry 상 interview 는 Phase1 4기능 밖 — 현재 라이브러리 미편입, 참고)*
5. 공유 링크: `/share/topline/*` (interview_topline 뷰어 — 이번 범위 밖, 무변경)
