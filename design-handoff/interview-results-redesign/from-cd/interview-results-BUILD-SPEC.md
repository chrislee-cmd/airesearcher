# BUILD-SPEC — 인터뷰 결과 생성기 (interviews) 리디자인

> **CD SSOT:** `interview-results.dc.html` (S1–S6, 정적 프레임 24장). **작성:** Claude Design · 2026-08-05.
> **먼저 읽기:** `CONTEXT-PACK.md`(토큰 어휘) · `tokens.json` 2.0 + `TOKEN-DECISIONS.md` · `WIDGET-SHELL.md`(카드 셸) · `FULLVIEW-SHELL.md` §F(풀뷰 셸) · `CD-DELIVERABLE-RULES.md` · `iconography-duotone/README.md`(아이콘 세트). 실측은 `GEOMETRY.md`.
> **인풋:** `REDESIGN-BRIEF.md` · `CONTEXT-INTERVIEW-RESULTS.md` · `REPORT-CONTENT-RULES.md`.
> **역할 경계:** CD=프레젠테이션(레이아웃·토큰·상태별 정적 모습·문구). 워커=로직/데이터. `CONTEXT-INTERVIEW-RESULTS.md §D`의 `ToplineBlock`·`ToplineReadResult`를 받는 dumb 컴포넌트 전제. 계약 밖은 §5에 `⚠️ contract-change:`로만 표기했습니다.
> **인라인 hex는 렌더용입니다.** diff 대상은 이 문서 §1의 클래스/토큰 칸입니다.

---

## §0 브리프 §3 쟁점 — CD 결정 5건

### 0.1 셸 세대 교체 → **§F FullviewShell 로 수렴 (확정)**
구형 `WidgetFullviewPanel`을 버리고 `FULLVIEW-SHELL.md §F1` 셸에 올립니다. 사이드바 240px · 우 슬롯 · 헤더밴드 per-widget pastel · 프레임 1400×840. 근거: `WIDGET-SHELL.md §S5`가 이미 "셸은 코드에 하나만 존재해야 한다"를 강제하고 있고, 인터뷰가 구형 패널에 남으면 그 규칙의 유일한 예외가 됩니다. 수렴 부작용 한 가지:

- **사이드바 항목이 6 → 7개가 됩니다.** `FULLVIEW-SHELL.md §F2`는 6위젯 기준으로 쓰였습니다. 항목 높이·간격은 그대로 두고 개수만 늘립니다(240×840 안에서 7개 + 푸트노트 카드가 들어갑니다 — `GEOMETRY.md §B2` 실측). 사이드바 자체는 `§F7-3` 대로 **공유 chrome 이므로 인터뷰용으로 다시 구현하지 않습니다.**

### 0.2 정체성 톤 → **rose `#ffd0e2` ✦ (확정)**
`TOKEN-DECISIONS.md §E`가 rose를 "다음 기능의 정체성"으로 예약했고, 인터뷰 결과가 그 다음 기능입니다. peach는 AI UT 단독으로 되돌립니다.

| 표면 | 값 |
|---|---|
| 카드 헤더밴드 · 풀뷰 헤더밴드 · 사이드바 도트 · 팔레트 아이콘 채움 | `bg-widget-header-rose` `#ffd0e2` |
| 보고서 안 강조 톤(핵심 요약 카드 바탕, 인용 바탕, ＋ 가이드선) | `rose-bg` `#ffeef4` |
| 글자·선 강조 | `amore-deep` `#c2334f` (링크·근거 칩·강조 수치) |
| 글리프 | `✦` (`tokens.json` iconography.widget_glyphs.rose) |

> **주의 · 톤 충돌 1건:** `FULLVIEW-SHELL.md §F4` Desk 표에서 exec-head 틴트로 `rose-bg`를 쓰고 있습니다. `pastel_tint.*`는 정체성이 아니라 문서용 워시라고 `tokens.json`이 명시하므로 **그대로 두어도 됩니다**(Desk 정체성은 aqua). 다만 인터뷰 보고서와 Desk 보고서를 나란히 볼 화면이 생기면 Desk exec-head를 `neutral-bg`로 옮기는 편이 안전합니다 — 워커 판단 아님, 그때 CD로 회부.

### 0.3 근거(citations) 노출 → **노출한다 (확정, contract-change 없음)**
`citations: string[]`이 이미 오므로 계약 변경 없이 가능합니다. 리서치 산출물에서 근거를 감추는 편이 더 큰 손해입니다. 규격은 §1.4 `citation` 행 + S5d.
- 문장 **끝**에 위첨자 칩. 문단 중간 inline `[chunk_id]` 원문 토큰은 **계속 strip** 합니다(프롬프트가 md 안에 넣는 형식이 사람이 읽을 형식이 아님).
- 칩 hover/클릭 → 원문 팝오버(청크 발췌 + 파일명 + 지점 + "원문에서 열기").
- `citations` 가 비면 **아무것도 렌더하지 않습니다.** 회색 칩·빈 칩 금지.

### 0.4 읽기 vs 편집 → **모드 분리 (확정)**
헤더 우측 `✎ 보고서 편집` 토글. **읽기 모드가 기본이고 그 상태에서는 블록 사이 ＋도, 드래그 하이라이트도 존재하지 않습니다.** 편집 모드에서만 SectionGap

### 0.4b 액션바 위계 → **보조를 무테 아이콘으로 · 편집은 ink 채움 (확정 · 탐색 `1b`)**
액션바에 보더를 가진 버튼이 여섯이면 무엇부터 볼지 정해지지 않습니다. **Word · Gdoc · 공유 · 재생성을 34×34 무테 아이콘으로 내리고, 언어는 텍스트 트리거로** 둘어 **라벨이 붙은 버튼을 편집 하나로** 만듭니다.

편집은 **rose 채움 → `bg-ink` 채움**으로 바뀍니다. 보조가 전부 무테가 되면 rose 의 대비가 오히려 약해지고, `DESIGN-SSOT-MASTER §D1` 의 "프라이머리 = ink 채움 · 한 화면에 하나"와도 맞습니다. 라벨도 `편집` → **`보고서 편집`** 으로 늘려 무엇을 편집하는지 밝힙니다.

> ⚠️ **무테 아이콘은 툴팁이 필수입니다.** 내보내기와 공유는 둘 다 "밖으로 보낸다"라 아이콘만으로 갈리지 않습니다. hover 400ms · ink 배경 · 11/700 paper.

### 0.4c 드래그를 모르는 사용자 → **힌트 스트립 (확정 · 탐색 `1d`)**
드래그는 **보이지 않는 기능**입니다. 편집 모드 진입 직후 본문 최상단에 한 줄짜리 스트립을 띄우고, **첫 드래그가 성공하면 사라지고 다시 뜼지 않습니다.**

- 생김새는 `§1.4` 드래그 힌트 스트립 행. `rose-bg` · border 1.5 ink · radius 10.
- 닫기는 `DESIGN-SSOT-MASTER §D6` 의 **`banner-dismiss`** (24 · 무테 · hover ink/6). 파괴적이 아니므로 crimson 을 쓰지 않습니다.
- 아이콘 **`highlight`** 는 세트에 없어 그렸습니다 — 경로는 §2 A-2.

> ⚠️ **contract-change:** "첫 드래그 성공했는가"를 기억할 곳이 필요합니다. 사용자 단위 `localStorage` 플래그로 충분하고 서버 계약은 늘리지 않아도 됩니다. 플래그를 안 두면 매 번 뜼게 되는데, 그것도 동작하긴 하나 숨기는 버튼이 무의미해집니다. ＋ · drag-to-ask · 삽입 카드 액션이 활성화됩니다. 근거 칩은 두 모드 모두에서 보입니다(읽기의 일부지 편집이 아님). 상세 S5a–S5c.

### 0.5 차트 팔레트 → **`chart.cat-1…6` 신설 · 값은 전부 기존 토큰 별칭 (확정)**
임의 hex `#f97316` · `#a855f7` 는 삭제합니다. 새 hex 를 만들지 않고 기존 토큰을 순서 있는 카테고리 스케일로 묶습니다.

| 순번 | `--css-var` | 값 | 출처 토큰 |
|---|---|---|---|
| 1 | `--color-chart-cat-1` | `#ff5c8a` | `amore` |
| 2 | `--color-chart-cat-2` | `#2563a8` | `accent-blue` |
| 3 | `--color-chart-cat-3` | `#e0a83a` | `amber` |
| 4 | `--color-chart-cat-4` | `#8b5cf6` | `accent-violet` |
| 5 | `--color-chart-cat-5` | `#16a34a` | `success` |
| 6 | `--color-chart-cat-6` | `#5b5965` | `mute` |

**사용 규칙**: 계열이 1개인 막대/선은 `cat-1` 만 씁니다(무지개 금지). 파이·누적은 1→6 순서로 배정하고 7개째부터는 `mute-soft`로 묶어 "기타"로 접습니다. 축·격자는 `line`, 축 라벨은 `faint` + `font-mono-label`. 기존 `chart.am-accent`/`pm-accent`는 건드리지 않습니다(다른 용도).
> 5·6번이 signal 색과 겹치는 것은 의도입니다. 여섯 번째까지 가는 차트는 이 보고서에 거의 없고, 새 hex 6개를 DS 에 들이는 비용이 더 큽니다. 겹침이 실제로 문제되면 그때 승격 요청.

---

## §1 클래스맵 — diff 대상

### §1.1 위젯 카드 (S1)
프레임·헤더밴드·툴바·푸터는 **`WIDGET-SHELL.md §S1/§S2` 그대로**입니다. 아래는 인터뷰 고유 본문만.

| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 카드 정체성 | 헤더 `#ffd0e2` · credit `💎10` · 팔레트 아이콘 채움 rose | `bg-widget-header-rose` |
| 컨트롤바(active 3층 중 1층) | `border-b 1.5px line` · pad 12/22 · `paper-soft` · 프로젝트 pill + 📤 업로드 | `border-b border-line paper-soft` |
| — 프로젝트 pill | paper · border 1.5 ink · radius 999 · shadow 2px2px0 ink | `paper border-ink rounded-pill shadow-memphis-sm` |
| 프로젝트 셀렉트(idle) | border 1.5 ink · **radius 22** · pad 13/18 · shadow 2px2px0 ink/12 | `border-ink rounded-field` + `shadow-memphis-sm-faint` |
| — "＋ 새 프로젝트" | 12.5/700 amore-deep | `text-amore-deep` |
| 드롭존(비활성) | 3px dashed `line-empty` · radius 14 · `paper-soft` · 텍스트 `faint` | `border-[3px] border-dashed border-line-empty rounded-sm paper-soft` |
| 드롭존(활성) | 3px dashed ink · radius 14 · paper · shadow 4px4px0 ink/16 | `border-[3px] border-dashed border-ink rounded-sm` + `proposed:shadow-dropzone` |
| 파일 행 · ready | border 2px ink · radius 11 · paper · shadow 2px2px0 ink/12 | `border-2 border-ink rounded-card paper shadow-memphis-sm-faint` |
| 파일 행 · 처리중 | border 1.5 `lav-line` · radius 11 · `lav-bg` | `border-lav-line rounded-card bg-lav-bg` |
| 파일 행 · 대기 | border 1.5 line · paper · opacity .75 | `border-line rounded-card paper opacity-75` |
| 파일 행 · 실패 | border 1.5 `error-line` · `error-bg` · 텍스트 `error-text` | `border-error-line bg-error-bg text-error-text` |
| 상태 칩 READY/청킹/QUEUE/FAIL | mono 10/800 · success / lav / neutral / error 셋 | `font-mono-label` + `signal.*` |
| 인덱싱 4단 타임라인 | 노드 20–22px 원 · 연결선 2px · done `success` / 현재 `processing` / 대기 `ink/6` | `bg-success` · `bg-processing` · `bg-ink/5` |
| Ambient progress 밴드 | `border-t 2px ink` · pad 13/22 · **bg = rose 헤더 톤** · 진행바 8px radius 999 · fill ink | `border-t-2 border-ink bg-widget-header-rose` |
| done 본문 | **전사록 생성기 `TG_done` 패턴 그대로** — 카드 안에 별도 박스 없음 · 본문 영역 중앙 정렬 · gap 16 · pad 20 | 재구현 금지 — 공유 done 레이아웃 |
| — 완료 타일 | 64×64 · border 2 ink · radius 16 · **bg `success.bg`** · **shadow 3px3px0 `success`** · `✓` 30/800 `success` | `shadow-memphis-md-success bg-success-bg text-success` |
| — 제목 / 부연 | 21/800 ink (Outfit 아님) / 13·1.55 mute · **max-w 300** | `text-2xl font-extrabold` / `text-sm text-mute` |
| — 본문 CTA | ink pill · pad 12/22 · 14/700 · shadow 2px2px0 ink/20 · `fullview` 아이콘 mono #fff | `bg-ink text-paper rounded-pill shadow-memphis-sm` |
| — 되돌아가기 | 12.5/600 `mute-soft` · 밑줄 1.5 `line-strong` · 버튼 아님 | `text-mute-soft border-b-[1.5px]` |
| — 메타 | 칩 없음. 규모는 부연 문장과 셀 푸터 노트에만 | — |
| analyze-prompt 박스 | border 2px ink · radius 14 · **`rose-bg`** · shadow 3px3px0 ink/14 | `border-2 border-ink rounded-sm bg-rose-bg shadow-memphis-md-faint` |
| CTA · 중단 | border 2px `amore-deep` · 텍스트 amore-deep · shadow 2px2px0 amore-deep | `border-amore-deep text-amore-deep shadow-memphis-sm-crimson` |

### §1.2 풀뷰 셸 (S2·S3)
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 프레임 · 사이드바 · 헤더밴드 | `FULLVIEW-SHELL.md §F1–F3` 값 그대로 | 재구현 금지 (`§F7-3`) |
| 헤더밴드 tone | `#ffd0e2` | `bg-widget-header-rose` |
| 상태 칩 · done | `success-bg` · border `success-line` · mono 11/800 `success-text` · ✓ 원 | `bg-success-bg border-success-line text-success-text font-mono-label` |
| 상태 칩 · generating | paper · border 1.5 ink · 도트 `processing` | `paper border-ink rounded-pill` + `bg-processing` |
| 상태 칩 · no report | paper · border 1.5 ink · 도트 `faint` | `bg-faint` |
| **탭바** (헤더밴드 아래 신규 행) | `border-b 2px ink` · paper · pad 9/20~24 · 좌: ← · 탭 pill · 우: 액션 그룹 | `border-b-2 border-ink paper` |
| — 탭 pill 그룹 | border 1.5 ink · radius 999 · 활성 `bg-ink text-paper` | `border-ink rounded-pill` / `bg-ink text-white` |
| — 액션 아이콘 버튼 (Word/Gdoc/공유/재생성) | **34×34 무테** · radius 9 · bg transparent · 스트로크 `mute` 17px · hover `canvas` | `w-[34px] h-[34px] rounded-icon hover:bg-canvas` |
| — 언어 트리거 | **텍스트만** · 12/700 `mute` · pad 6/4 · 보더·그림자 없음 | `text-mute font-bold` |
| — 편집 CTA | **`bg-ink` 채움** · border 2 ink · radius 999 · pad **9/22** · **13.5/800** paper · shadow **3px3px0 ink/28** · 라벨 **"보고서 편집"** | `bg-ink text-paper border-2 border-ink rounded-pill shadow-memphis-md-faint` |
| — 편집 토글(신규) | §1.2 액션바의 편집 CTA 참조 — **ink 채움 · rose 아님** | `bg-ink text-paper` |
| 파일 패널 (펼침) | **width 300 고정** · `border-r 2px ink` · paper | `w-[300px] border-r-2 border-ink paper` |
| 파일 패널 (접힘) | **width 56 고정** · `paper-soft` · ▶ 버튼 30px radius 9 · 세로 mono 라벨 | `w-[56px] paper-soft` |
| 목차 rail | **width 220 고정** · `border-l 2px ink` · paper | `w-[220px] border-l-2 border-ink paper` |
| — 활성 항목 | `border-l 3px amore` · `rose-bg` · 12/800 ink | `border-l-[3px] border-amore bg-rose-bg` |
| — 비활성 항목 | border-l 3px transparent · 12/400 mute | `text-mute` |
| 본문 캔버스 | `surface-canvas` · 세로 패딩 34/46 | `bg-surface-canvas` |

> **레이아웃 전환 규칙(§F 확장):** 파일 패널은 **status=done 일 때 기본 접힘(56px)**, 그 외 상태에서는 펼침(300px)입니다. 근거는 폭 산술 — `GEOMETRY.md §B3`. 목차 rail 은 status=done 에서만 렌더합니다.

### §1.3 보고서 블록 트리트먼트 (11종) — 필수 표
읽기 컬럼은 **거터 52 + gap 14 + 본문 flex** 구성입니다(`GEOMETRY.md §C1`). 거터의 mono 라벨은 **컴프 주석이므로 구현하지 않습니다.**

| # | block.type | 프레임 | 타이포 | 색/토큰 | 비고 |
|---|---|---|---|---|---|
| 1 | `executive_summary` | border **2.5px ink** · radius 14 · shadow 4px4px0 ink/16 · 헤더 스트립 paper + `border-b 1.5 line-strong` · 본문 `rose-bg` | 제목 `font-display` 21/800/-0.4 · summary 14/1.85 · key_points 13.5/1.65 | `bg-rose-bg` · eyebrow `text-amore-deep font-mono-label` · 마커 `✦` `text-amore-deep` | 항상 첫 블록, 정확히 1개. **inline citation 없음**(프롬프트 규칙). 우측 메타 = `n=N · 전수 순회 · 모델` |
| 2 | `heading` | `border-b 2px ink` · pad-b 10 · **margin-top 44** | 번호 chip mono 11/800 `bg-ink text-paper rounded-chip` + 제목 `font-display` 24/800/-0.5 | ink | 번호는 exec 를 제외한 heading 순번. 질문·주장형 제목이 길어도 2줄까지 허용 |
| 3 | `subheading` | 좌 틱 3×17 radius 2 · gap 9 | 15.5/800 | 틱 `bg-amore` | `heading` 과 달리 밑줄 없음 |
| 4 | `paragraph` | 없음(플레인) | **13.5 / 1.85** | `ink-2`, 링크 `amore-deep` | 마크다운 볼드는 `ink` 800. 문장 끝 citation 칩(§1.4) |
| 5 | `insight` | border 2px ink · radius 12 · `paper-soft` · pad 15/18 · 라벨+본문 2열 | 라벨 mono 10/800 대문자 `amber-text` · 본문 13.5/1.8 | `paper-soft` + `text-amber-text` | 라벨 문구는 "발견" / 교차분석 절에서는 "대조 N". 좌측 회색 선(현행)은 **폐기** — quote 와 구분이 안 됐음 |
| 6 | `quote` | `border-l 3px amore` · radius 0/12/12/0 · `rose-bg` · pad 16/20 · 좌측 큰 따옴표 글리프 34/800 | 본문 **14.5 / 1.8 · italic 없음** · attribution mono 10.5 `mute-soft` | `border-amore bg-rose-bg` · 글리프 `text-amore` | ⚠️ **italic 제거**가 의도된 변경입니다. 한글 이탤릭은 합성 기울임이라 가독성이 떨어집니다. attribution = `그룹 R번호 · 나이/성별 · 조건` |
| 7 | `table` | 캡션 mono eyebrow → wrapper border 2px ink · radius 12 · shadow 3px3px0 ink/14 · overflow hidden | th mono 10/800 대문자 `mute` · `border-b 2px ink` · td 12.5 · `border-b 1px line` | thead `paper-soft` · 짝수행 `surface-canvas` · 수치 `tabular-nums` 우정렬 | 세그먼트가 있으면 **전체 / A / B / 차이** 열 필수. 차이 열은 헤더·셀 모두 `bg-rose-bg`, 값은 800 `amore-deep`(|Δ|≥15%p) / 700 `mute-soft`(<5%p). 표 아래 각주는 mono 10.5 `faint` |
| 8 | `chart` (bar/line) | border 2px ink · radius 12 · shadow 3px3px0 ink/14 · 헤드 `paper-soft` + `border-b 1.5 line` · 푸터 `surface-canvas` | 헤드 mono eyebrow + 14/800 제목 · 값 mono 12/800 | 막대 `chart-cat-*` · 트랙 `paper-soft` + border 1px line | **가로 막대 기본**(한글 카테고리 라벨이 세로축에서 잘림). 라벨 열 120px · 값 열 34px 우정렬. `h-60` 고정 폐기 → 행 수에 따라 자람 |
| 9 | `pie` | chart 와 동일 프레임 | 범례 13 · 값 mono 12.5/800 | 도넛 stroke `chart-cat-*` · 범례 스와치 12px radius 3 border 1.4 ink | **도넛**(stroke-width 9 / r 15.915 = 100 둘레). 범례는 우측 세로 목록, 값은 `M / N` 실수 표기(퍼센트만 쓰지 않음). 0인 항목이 의미 있으면 범례 아래 한 줄로 명시 |
| 10 | `inserted_qa` | **2px dashed ink/28** · radius 12 · `paper-soft` · 헤더 스트립 paper + dashed 하단선 | 칩 mono 9.5/800 · 질문 13/800 · 답 13.5/1.8 · 발췌 좌 2px line 인용 | dashed = 사용자 생성물 표식 | 헤더 우측 = 생성 시각 · 작성자. **정체성 파스텔을 쓰지 않습니다**(lav 는 Transcript) |
| 11 | `inserted_section` | 10번과 동일 프레임 | 제목 14.5/800 · 본문 13.5/1.8 | 동일 | 헤더 우측 = 사용자가 넣은 지시 원문(따옴표) |

### §1.4 공통 요소
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| citation 칩 | mono 9.5/800 · `rose-bg` · border 1px `rose` · radius 4 · pad 0/4 · `margin-left 3` · `translateY(-3px)` | `font-mono-label bg-rose-bg border-rose rounded-xs text-amore-deep` |
| citation 팝오버 | border 2px ink · radius 12 · paper · shadow 4px4px0 ink/20 · max-w 420 · 헤더 `rose-bg` | `border-2 border-ink rounded-panel paper` + `proposed:shadow-popover` |
| SectionGap · 유휴 | height **26 고정** · 선 `rose/55` 1.5px · 노드 20px border 1.4 `line-strong` · `＋` `line-empty` | 높이 고정 = 레이아웃 점프 방지 |
| SectionGap · hover | 라벨 pill border 1.5 ink · radius 8 · shadow 2px2px0 ink · 11.5/800 | `border-ink rounded-nav shadow-memphis-sm` |
| SectionGap · pending | 2px dashed `processing` · `lav-bg` · 도트 `processing` | `border-dashed border-processing bg-lav-bg` |
| 드래그 힌트 스트립 | border 1.5 ink · radius 10 · **`rose-bg`** · pad 10/14 · shadow 2px2px0 ink/12 · 아이콘 `highlight` 17 · 12.5/1.6 · 우측 `banner-dismiss` ✕ 24 | `border-ink rounded-panel bg-rose-bg shadow-memphis-sm-faint` |
| 드래그 선택 하이라이트 | `bg sun` + `border-b 2px amber` · pad 1/2 | `bg-pastel-sun border-b-2 border-amber` |
| 배너 · stale | border 2px ink · radius 12 · `warning-bg` · shadow **3px3px0 amber** · 텍스트 `amber-text` | `bg-warning-bg shadow-memphis-md-amber text-amber-text` |
| 배너 · stuck | border 2px ink · radius 12 · `lav-bg` · shadow 3px3px0 processing/35 · 텍스트 `lav-text` | `bg-lav-bg text-lav-text` + `proposed:shadow-memphis-md-processing` |
| 배너 · error | border 2px ink · radius 12 · `error-bg` · shadow **3px3px0 error** · 텍스트 `error-text` · 코드박스 mono 10.5 paper/`error-line` | `bg-error-bg shadow-memphis-md-error text-error-text` |
| 배너 · cancelled | border 1.5 `line-strong` · `paper-soft` · 텍스트 `mute` — **shadow 없음** | 중립 상태이므로 색 신호를 쓰지 않습니다 |
| 모달 (재생성/공유) | border 3px ink · radius 18 · 헤더 rose + `border-b 2px ink` · 푸터 `paper-soft` + `border-t 2px ink` | `rounded-modal` · shadow `8px8px0 ink/40`(재생성) · `6px6px0 ink/30`(공유) |
| 언어 선택 pill | 선택 border 2px ink `bg rose` shadow 2px2px0 ink · 비선택 border 1.5 ink/18 paper | `bg-widget-header-rose` |
| 토글 스위치 (공유 게이트) | 34×20 · track `success` · knob 14px paper · border 2px ink | `bg-success border-2 border-ink` |
| 채팅 말풍선 · 사용자 | border 2px ink · radius 14/14/4/14 · `bg rose` · shadow 2px2px0 ink | `bg-widget-header-rose` |
| 채팅 말풍선 · 응답 | border 2px ink · radius 14/14/14/4 · paper · shadow 3px3px0 ink/14 | `paper shadow-memphis-md-faint` |
| 프로젝트 카드 (목록) | border 2px ink · radius 12 · paper · shadow 3px3px0 ink/14 · 헤더 스트립 = 상태 틴트 | 헤더 틴트: done `rose-bg` / generating `lav-bg` / none `paper-soft` / error `error-bg` |

### §1.5 아이콘 — 듀오톤 세트 바인딩 (필수 표)
**이모지는 UI 컨트롤 글리프로 쓰지 않습니다** (`tokens.json` iconography). 모든 컨트롤 아이콘은 `iconography-duotone/` 세트의 인라인 SVG입니다: `viewBox 0 0 24 24` · `stroke ink` · **`stroke-width 2` 고정** · `linecap/linejoin round` · 채움 = **놓인 위젯의 헤더 톤 = rose**.

> ⚠️ **채움값 정정:** 세트의 기본 채움은 `#ffd7e4`지만 `tokens.json` 2.0 의 rose 는 **`#ffd0e2`** 입니다. **토큰이 SSOT** 이므로 `#ffd0e2` 로 렌더했습니다. `svg-tokenized/` 를 쓰고 컨테이너에 `--icon-fill: var(--color-rose)` 를 지정하면 자동으로 맞습니다. 세트의 하드코딩 값은 갱신 대상 — §6-5.

| 컨트롤 | icon name | 크기 | 모드 |
|---|---|---|---|
| 프로젝트 pill · 프로젝트 셀렉트 · 목록 카드 | `project` | 15 / 16 / 17 | 듀오톤 rose |
| 파일 행 · 텍스트 문서 | `document` | 15 / 16 / 17 | 듀오톤 rose |
| 파일 행 · 오디오 | `mic` | 15 / 16 / 17 | 듀오톤 rose |
| 파일 행 · 표 데이터(csv) | **`dataset`** ⚠️ 세트에 없음 (§6-5) | 15 / 16 | 듀오톤 rose |
| 업로드 버튼 · 드롭존 | `upload` | 15 / 30 / 34 | 듀오톤 rose (드롭존 비활성은 `opacity:.35`) |
| Word 내보내기 | **`download`** ⚠️ 세트에 없음 (§6-5) | **17** | **mono** (`mute` 스트로크 · 채움 없음) |
| Google Docs | `document` | **17** | **mono** (`mute` 스트로크 · 채움 없음) |
| 공유 · 링크 필드 | `link` | **17** / 18 | 액션바 **mono** · 링크 필드는 듀오톤 rose |
| 언어 셀렉트 · 언어 칩 | `language` | 13 / 15 | 듀오톤 rose |
| 재생성 (버튼 · stale 배너 · 모달 헤더) | **`regenerate`** ⚠️ 세트에 없음 (§6-5) | **17** / 19 | 액션바 **mono** · 배너/모달은 듀오톤 rose |
| 편집 CTA | `typos` | **16** | **mono** (ink 배경 → 흰 스트로크, 채움 없음) |
| 드래그 힌트 스트립 | **`highlight`** ⚠️ 세트에 없음 (§6-5) | 17 | 단색 ink |
| 드래그 질문 CTA | `questions` | 15 | **mono**(ink 배경 → 흰 스트로크, 채움 없음) |
| 파일 패널 펼치기 | `chevron` (경로 `M9 5l7 7-7 7`) | 14 | 단색 ink |
| 크레딧 `💎` | **이모지 유지** | — | `WIDGET-SHELL.md §S1` 이 명시한 유일한 예외 |
| 위젯 글리프 `✦` | **문자 유지** | — | `tokens.json` iconography.widget_glyphs — 콘텐츠 마커 |
| 상태 원 안 `✓` · 닫기 `✕` · 중단 `■` | 문자/도형 | — | 이모지 아님. `✕`·`✓` 는 셸 기존 처리 그대로, `■` 는 10×10 `bg-amore-deep` radius 2 span |

**배너에는 아이콘을 쓰지 않습니다.** stale/stuck/error/cancelled 4종 모두 글리프 없이 **틴트 + 그림자색 + 제목 800** 으로만 상태를 말합니다. ⚠/⏳/⊘ 는 세트에 없고, 넣으려면 세 개를 새로 만들어야 하는데 배너는 이미 색·제목·문구로 충분히 구분됩니다.

---

## §2 proposed-tokens

### (A) 승격 요청 — `globals.css @theme`
| `--css-var` | 값 | 용도 |
|---|---|---|
| `--color-chart-cat-1…6` | §0.5 표 | 카테고리 차트 스케일 (기존 토큰 별칭 — 새 색 아님) |
| `--shadow-memphis-md-processing` | `3px 3px 0 rgba(139,92,246,0.35)` | stuck 배너 · 순회중 파일 행. `shadow-memphis-md-error/amber` 와 짝 |
| `--shadow-popover` | `4px 4px 0 rgba(29,27,32,0.20)` | 근거 팝오버 · 부유 카드. `memphis-lg`(불투명)와 `sm-faint` 사이가 비어 있음 |
| `--shadow-dropzone` | `4px 4px 0 rgba(29,27,32,0.16)` | 활성 드롭존. Recruiting `file-drop-zone.tsx` 가 이미 같은 값을 인라인으로 씀 → 이번에 승격 |

### (A-2) proposed-icon — 듀오톤 세트에 추가 요청 3종
세트 규격(24 그리드 · stroke 2 · 듀오톤)에 맞춰 그렸습니다. 경로는 `interview-results.dc.html` 안에 인라인으로 있습니다.

| name | 경로 | 용도 |
|---|---|---|
| `download` | `M12 4v11` · `M8 11l4 4 4-4` · `M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4` | Word 내보내기. `upload` 의 화살표만 뒤집은 짝 |
| `regenerate` | `M20 12a8 8 0 1 1-2.6-5.9` · `M20 4v5h-5z`(fill) | 재생성 · 다시 만들기 |
| `dataset` | `rect 4,4,16,16 rx1.6`(fill) · `M4 9.5h16M9.5 9.5V20` | 표 형식 파일(csv·xlsx). `minutes`(회의록)를 대신 쓰면 뜻이 틀립니다 |
| `highlight` | `M6 7h7` · `M6 11h5` · `M13.5 12.5l6.5 6.5` · `M13.5 12.5l1.6 8 1.8-3.2 3.4-.6z`(fill) | 드래그 힌트 스트립. 텍스트 위 커서 = "문장을 끌어보라" |

### (B) 로컬 (승격 보류)
| 토큰 | 값 | 위치 |
|---|---|---|
| `--iv-lang-select-w` | `132px` | 언어 셀렉트 폭. 6개 언어 라벨 중 최장(`Español`)이 잘리지 않는 최소치. 현행 `w-[132px]` 임의값을 이름만 붙여 유지 |
| `--iv-file-panel-w` / `--iv-file-rail-w` | `300px` / `56px` | 파일 패널 펼침·접힘 |
| `--iv-toc-w` | `220px` | 목차 rail |
| `--iv-gutter-w` | `52px` | 보고서 거터(컴프 주석용). 구현 시 0 |
| `--iv-gap-h` | `26px` | SectionGap 고정 높이 |

### (C) 폐기되는 임의값
`w-[132px]`(→ B) · `grid-cols-5` 파일 그리드(→ 300px 패널의 단일 열 목록, 카드 내 요약은 2열) · `h-60` 차트 고정 높이(→ 행 기반 자동) · 차트 hex `#f97316`·`#a855f7`(→ `chart-cat-*`) · skeleton 임의 높이(→ `GEOMETRY.md §D3` 표).

---

## §3 상태 매트릭스 — 전부 정적으로 그렸습니다

| 축 | 상태 | 프레임 |
|---|---|---|
| 카드 | idle(프로젝트 미선택) | S1 · 1a |
| 카드 | empty(선택됨·파일 0) | S1 · 1b |
| 카드 | generating(인덱싱+탑라인) | S1 · 1c |
| 카드 | analyze-prompt(파일 준비·보고서 없음) | S1 · 1d |
| 카드 | done(완료 · 전체보기로 넘김 · `TG_done` 패턴) | S1 · 1e |
| 파일 인덱싱 | 업로드→파싱→청킹→임베딩 4단 + QUEUE + FAIL | S1 · 1b(예고) / 1c(진행·실패) |
| 풀뷰 | 빈 상태 | S2 · 2a |
| 풀뷰 | 로딩 skeleton | S2 · 2b |
| 풀뷰 | 생성 중 (map 진행 · reduce 대기) | S2 · 2c |
| 풀뷰 | 완료(읽기 모드, 블록 11종) | S3 · 3a |
| 배너 | stale / stuck / error / cancelled | S4 · 4a |
| 재생성 | 모달(방향 128/600자 · 언어 6종) | S4 · 4b |
| 공유 | Word 3상태 · Gdoc 3상태 · 초대 모달(이메일 게이트) | S4 · 4c |
| 편집 | 읽기↔편집 대조 | S5 · 5a |
| 편집 | SectionGap 유휴/hover/열림/pending | S5 · 5b |
| 편집 | 드래그 힌트 스트립(편집 진입 직후) | S5 · 5c |
| 편집 | drag-to-ask 선택→입력→답변(+근거 없음 폴백) | S5 · 5c |
| 근거 | 칩 기본/hover 팝오버/다건/없음 | S5 · 5d |
| 목록 | done / generating / none / error 프로젝트 카드 | S6 · 6a |
| 검색 | 질문·응답·근거 응답자·아티팩트 미생성 폴백 | S6 · 6b |

**안 그린 것 (필요하면 요청):** 업로드 진행률 개별 파일 · 25MB 초과 거부 · 보고서 업로드(파일→블록 변환) 흐름 · 언어별 재렌더 프루프(ja/zh/th 줄높이) · 크레딧 부족 · 공유 뷰어(범위 밖, `share-shell` 계열).

---

## §4 인터랙션 면책
`.dc.html` 은 **정적 컴프**입니다. 모드 전환·hover·드롭다운·스크롤스파이는 상태별 프레임으로만 개시했고 배선하지 않았습니다. 동작은 워커 소유입니다. 애니메이션은 `tokens.json motion` 토큰만 쓰고 `prefers-reduced-motion: reduce` 에서 전부 무력화합니다.

---

## §5 ⚠️ contract-change

1. **`⚠️ contract-change:` 근거 청크 본문.** 팝오버가 발췌 텍스트·파일명·지점을 보여주려면 `citations: string[]`(id 뿐)로는 부족합니다. id → `{text, file_name, offset|timestamp}` 를 주는 조회 수단이 필요합니다. **id만 남기고 팝오버 없이 칩만 보이는 축소판으로도 출시 가능**하므로 이 항목이 리디자인을 막지는 않습니다. 어느 쪽인지 writer 확정 요청.
2. **`⚠️ contract-change:` 남은 시간.** 카드·풀뷰의 "약 2분 남음"은 `map_total`/`map_done` 만으로는 계산할 수 없습니다(reduce 구간 미지). 필드를 주거나, 문구를 진행률만 남기고 삭제하거나 — 결정 필요. **삭제해도 디자인은 성립합니다.**
3. **`⚠️ contract-change:` stuck 판정 임계값.** `updated_at` 기준 몇 분부터 배너를 띄울지는 제품 결정입니다. 컴프는 "17분째"로 그렸고 문구는 분 단위 변수입니다.
4. **`⚠️ contract-change:` 공유 열람 수.** 초대 모달의 "지금까지 연 사람 4명"은 `shared_views` 집계가 필요합니다. 없으면 그 행을 렌더하지 않습니다(레이아웃 영향 없음).
5. **`⚠️ contract-change:` 파일↔청크 역참조.** 파일 패널에서 "이 파일이 근거인 블록 보기"는 그리지 않았습니다. 계약에 역인덱스가 없어서입니다 — 필요하면 별도 티켓.

---

## §6 열린 항목
1. **Desk exec-head 틴트 `rose-bg` 중복** — §0.2 주의 참조. 지금은 그대로 두는 판단.
2. **사이드바 8번째 위젯** — 7개까지는 240×840 에 여유 있게 들어갑니다(`GEOMETRY.md §B2`). 8개째부터는 푸트노트 카드를 접거나 항목 높이를 줄여야 하므로, 그 시점에 `FULLVIEW-SHELL.md §F2` 개정이 필요합니다.
3. **인쇄/Word 내보내기 레이아웃** — `export-documents-BUILD-SPEC.md` 가 이미 문서 레이아웃 SSOT 입니다. 인터뷰 탑라인은 그 §2 페이지 해부를 그대로 따르고, 블록 11종 → 인쇄 매핑만 추가하면 됩니다. 이번 번들 범위 밖 — 필요하면 요청.
4. **검색 탭** — 브리프대로 리스킨만 했습니다. 대화 UX 자체(멀티턴 유지, 아티팩트 삽입)는 손대지 않았습니다.
5. **아이콘 세트 갱신 3건** — (a) `download`·`regenerate`·`dataset` 3종을 세트에 추가(§2 A-2 경로 제공). (b) 세트의 하드코딩 채움 `#ffd7e4` → `tokens.json` rose `#ffd0e2` 로 정정, 또는 전 표면이 `svg-tokenized/` + `--icon-fill` 로 이행. (c) `iconography-duotone/README.md` 의 이모지 교체표에 `📁 → project` 가 이미 있는데, **공유 풀뷰 헤더의 프로젝트 pill 은 다른 번들에서 아직 `📁` 이모지로 남아 있습니다.** 이번 번들은 `project` 아이콘으로 그렸으므로, 셸 컴포넌트에서 한 번 교체하면 6개 위젯이 같이 정리됩니다 — 인터뷰만 따로 고치지 마세요.
