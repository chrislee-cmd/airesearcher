# BUILD-SPEC — 공유 관리 대시보드 (share management)

> **CD SSOT:** `share-management.dc.html` (C1–C5, 정적 프레임 13장). **작성:** Claude Design · 2026-08-06 (§9 스코프 축 반영).
> **먼저 읽기:** `CONTEXTSHAREMANAGEMENT.md`(인바운드 브리프 — **§9 가 최신**) · `tokens.json` 2.0 + `TOKEN-DECISIONS.md` · `deliverables-library-BUILD-SPEC.md`(셸·행 문법의 출처) · `share-shell-BUILD-SPEC.md`(공개 뷰어와의 접점) · `CD-DELIVERABLE-RULES.md` · `iconography-duotone/README.md`. 실측은 `GEOMETRY.md`.
> **역할 경계:** CD=프레젠테이션. 워커=데이터·액션. 브리프 §3 의 `ShareLinkItem` + §9 보강분(`issuer`) + `onCopy`/`onRevoke`/`onOpenInviteManage` 만 받는 dumb 컴포넌트 전제. 계약 밖은 §5에 `⚠️ contract-change:` 로만 표기했습니다.
> **인라인 hex/px 는 렌더용입니다.** diff 대상은 §1의 클래스/토큰 칸입니다.
> **상태: 마감.** CD 결정 5건 writer 승인 완료 · `⚠️ contract-change` 9건 중 블로킹 항목 없음(§5). 포팅 착수 가능합니다.

---

## §0 CD 결정 4건

### 0.1 자리 → **`/library` 네 번째 탭 (writer 권고 수용)**
역제안 없습니다. 발급이 산출물 풀뷰에서 일어나므로 관리도 산출물 동선에 있는 게 맞습니다. 탭 순서는 **산출물 · 프로젝트 · 내보낸 문서 · 공유** — 공유가 맨 오른쪽인 이유는 나머지 셋이 "만든 것"이고 공유는 "내보낸 것"이라 성질이 다르기 때문입니다.

**셸을 새로 만들지 않았습니다.** 프레임·탭바·툴바·열 헤더·행 문법·상태 배지·잠금 트리트먼트를 `deliverables-library-BUILD-SPEC.md §1` 에서 그대로 가져왔습니다. 라이브러리에 아직 탭바 행이 없다면(현행 헤더는 제목+검색+정렬+뷰토글) **탭바는 공유 chrome 으로 한 번 추가하고 4개 탭이 함께 씁니다** — 공유 전용으로 만들지 마세요.

### 0.2 정체성 톤 → **표면 자체는 중립, 행이 산출물 톤을 실어 나릅니다**
6종이 섞인 목록이라 표면에 단일 파스텔을 칠할 수 없습니다. 라이브러리와 같은 원칙: **중립 셸 + 행 타일의 파스텔이 정체성**입니다.

| resourceType | 톤 | 아이콘 | 라벨(칩) |
|---|---|---|---|
| `interview_topline` | rose `#ffd0e2` | `document` | 인터뷰 탑라인 |
| `probing_persona` | sky `#cfe6ff` | `questions` | 프로빙 페르소나 |
| `transcript` | lav `#e7defe` | `minutes` | 전사록 |
| `ut_insight` | peach `#ffd9be` | `target` | UT 인사이트 |
| `desk_report` | aqua `#bfe9ef` | `keywords` | 데스크 리포트 |
| `recruiting_summary` | sun `#ffe8a8` | `guest` | 리크루팅 집계 |
> 톤 맵은 `tokens.json` pastel 6종과 1:1이고 새 색이 없습니다. 라벨은 **prop 으로 받으세요** — 컴포넌트 안에서 `resourceType` → 한국어를 매핑하면 종류가 늘 때마다 프런트가 바뀝니다(`share-shell-BUILD-SPEC.md §5.2` 와 같은 문제). §5-1 참조.

### 0.3 `viewCount` → **보여줍니다. 단, 집계 수 + 마지막 열람 시각까지만 (CD 제안 → 사용자 확정 필요)**
브리프 §5가 요구한 신규 결정입니다. 인터뷰 공유 모달의 미렌더 결정(DECISIONS #4)과 **의도적으로 다르게** 제안합니다.

- **모달에서 감춘 이유는 시점입니다.** 링크를 막 만드는 화면에서 "연 사람 0명"은 정보가 아니라 잡음입니다.
- **대시보드의 용무는 정확히 그 반대입니다.** 이 화면에 오는 사람의 질문은 "이거 아직 쓰이나, 끌까"입니다. 열람 0회에 30일 지난 링크와 어제도 41회 열린 링크는 **끄는 판단이 정반대**입니다. 열람을 지우면 이 화면은 목록만 있고 판단 근거가 없는 표가 됩니다.
- **경계:** 집계 수 + 마지막 열람 시각까지. **개별 열람자 신원은 표시하지 않습니다** — 백엔드가 주지 않는 것이 확정이고, 준다 해도 이 화면에 둘 만한 것이 아닙니다.
- **문구는 "N회"** 입니다. "N명"이 아닙니다 — 집계 count 는 사람 수가 아니라 열람 횟수이고, 같은 사람이 세 번 열면 3회입니다. 모달의 "연 사람 N명"이라는 표현은 애초에 데이터와 맞지 않았습니다.
- 값이 없으면(`viewCount: null | undefined`) **"—"** 를 렌더합니다. 0과 미집계는 다릅니다.

> 사용자가 "대시보드에서도 감춘다"로 확정하면: 열람 열(126px)을 지우고 그 폭을 **산출물 열에 줍니다**(`GEOMETRY.md §B1`). 나머지 레이아웃은 그대로 성립합니다.

### 0.5 스코프 축 — **브리프 §9 (a) 반영 · writer 승인 완료 (2026-08-06)**
writer 가 §5-4·§6-4 미결을 닫으면서 스코프 축을 이 번들로 넣었습니다. 계약: `issuer: { name: string, isMine: boolean }` + **`canViewOrgScope: boolean`**(응답 최상위 · §5-9).
**아래 결정 전부 writer 승인됨** — 스코프 헤더 배치 · 발급자 메타 라인 · 액션 정책(남의 링크에도 3종 활성) · 5c 소유자 경고 밴드.

**배치 — 스코프는 헤더, 상태는 툴바.**
세그먼트를 한 줄에 둘 쌓지 않습니다. 두 축은 층이 다릅니다 — 스코프는 **"이 화면이 무엇을 보고 있나"**(프로젝트 pill 과 같은 층, 그래서 헤더에 나란히 둡니다), 상태는 **"그중 무엇으로 좁히나"**(툴바). 툴바에 세그먼트를 둘 놓으면 둘 다 필터처럼 보여 유효 조합을 머릿속으로 세게 됩니다.

**권한별 3형태 (C5, normative)**

| 역할 · 스코프 | 스코프 토글 | 발급자 필터 | 행 아바타 | 프레임 |
|---|---|---|---|---|
| **member** (전체) | **없음** | 없음 | 없음 — 메타는 `"MM-DD 발급"` 에서 끝 | C5 · 5a |
| **admin/owner · 내 링크** | 2칸 · 좌측 선택 | 없음 | 없음 | C5 · 5b |
| **admin/owner · 조직 전체** | 2칸 · 우측 선택 | **있음** | **있음** + 내 것에 `나` 칩 | C1 |

- **member 에게는 잠긴 토글을 보여주지 않습니다.** 백엔드(RLS)가 자기 발급분만 반환하므로 토글이 있어도 바뀔 것이 없고, 권한이 없는 기능의 존재를 알리는 것은 이 화면의 용무가 아닙니다.
- **"내 링크" 스코프에서는 admin 이라도 발급자 축을 렌더하지 않습니다.** 모든 행에 같은 아바타가 붙으면 잉크만 늘고 정보는 0입니다.
- **발급자를 열로 만들지 않고 메타 라인에 싣습니다.** 열로 빼면 고정 폭이 130px 늘어 산출물 열이 634 → 493 으로 줄고 제목이 상시 잘립니다(`GEOMETRY.md §B2`). 메타 라인은 발급일이 이미 있는 자리고, 16px 아바타는 행 높이를 늘리지 않습니다.
- **액션 잠금은 소유권으로 갈리지 않습니다.** 잠금 매트릭스(§1.4)는 **status 축만** 씁니다. admin 이 조직 전체를 볼 때 남의 링크에도 3종이 전부 활성입니다 — 관리 권한이 있어서 이 스코프를 보는 것이고, 볼 수만 있고 끌 수 없으면 화면의 용무가 사라집니다. **백엔드 RLS(`update_owner_or_admin`)가 admin 철회를 이미 허용함을 writer 가 확인했습니다** — 프런트 정책과 DB 정책이 일치합니다.
- **남의 링크를 끌 때만** 확인 모달에 소유자 경고 밴드가 한 줄 붙습니다(C5 · 5c · §1.11). 나머지는 C3a 와 동일해서 컴포넌트가 갈라지지 않습니다.

> **멤버 관리는 이 번들에 없습니다.** 브리프 §9 (b) 대로 기존 `/members` 표면이 담당합니다. 공유 링크(외부인 · 링크 단위 · 만료 있음)와 멤버십(내부인 · 계정 단위 · 만료 없음)은 성질이 달라 한 목록에 섞지 않습니다.

### 0.4 expired / revoked 처리 → **한 목록 · 상태 필터 · 죽은 링크는 톤을 잃습니다**
브리프 §4-6이 CD 판단으로 넘긴 항목입니다. 별도 그룹도, 숨김 토글도 쓰지 않습니다.

- **한 목록에 두고 상태 세그먼트 필터로 좁힙니다.** 기본 선택은 **"살아있는 링크"**(=active). 만료/철회/전체는 옆 세그먼트. 별도 그룹으로 쪼개면 "지금 열리는 게 몇 개냐"를 세는 일이 두 번 스캔이 됩니다.
- 세그먼트에 **개수를 붙입니다**(11 / 4 / 3 / 18). 필터가 곧 요약이 됩니다.
- **`revoked` 행은 타일의 파스텔을 잃습니다**(중립 회색 타일 + mute 스트로크). `share-shell-BUILD-SPEC.md` 의 "dead end 는 톤을 버린다"와 같은 규칙입니다 — 파스텔이 남아 있으면 "색만 다른 살아있는 링크"로 읽힙니다.
- **`expired` 는 톤을 유지합니다.** 되살릴 수 있는 상태(초대 편집으로 기한 연장)라서 죽은 것으로 취급하지 않습니다. 텍스트만 눕힙니다.
- 액션은 숨기지 않고 **잠급니다** — §1.4 매트릭스.

---

## §1 클래스맵 — diff 대상

### §1.1 프레임 · 탭바 · 툴바
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 표면 프레임 | border 3px ink · radius 16 · `shadow-frame` · `surface-canvas` | `border-[3px] border-ink rounded-panel-lg shadow-frame surface-canvas` (라이브러리와 동일) |
| 헤더 블록 | `border-b 3px ink` · `paper` | `border-b-[3px] border-ink paper` |
| — 제품 제목 | Outfit 800 · 24 · ls -0.6 | `font-display font-extrabold` |
| — 프로젝트 스코프 pill | paper · border 1.5 ink · pill · shadow 2px2px0 ink/12 | `paper border-ink rounded-pill shadow-memphis-sm-faint` |
| — **소유자 스코프 세그먼트** (admin/owner 한정) | 그룹 pill: border 1.5 ink · radius 999 · 셀 사이 1.5px ink 구분선 · shadow 2px2px0 **ink**(상태 세그먼트보다 한 단계 진함) · 셀 pad 6/13 · 아이콘 14 + 라벨 gap 6 | §0.5 · 프로젝트 pill **왼쪽**에 배치(넓은 스코프 → 좁은 스코프 순) |
| — 스코프 활성 셀 | `bg-ink text-paper` · 12/800 · 아이콘 스트로크 `paper` | `bg-ink text-paper` |
| — 스코프 비활성 셀 | paper · 12/700 `mute` · 아이콘 스트로크 `mute` | `text-mute` |
| **탭바** | pad 12/24/0 · gap 2 · 항목 pad 9/16 | 공유 chrome (§0.1) |
| — 비활성 탭 | 13/700 `mute` · border transparent | `text-mute` |
| — 활성 탭 | 13/**800** ink · border 1.5 ink · radius 10 10 0 0 · bg `surface-canvas` · **하단 border 를 캔버스색으로 덮어 프레임과 이어붙임** · `margin-bottom:-1.5px` | `border-ink rounded-t-control surface-canvas` |
| 툴바 | `border-b 2px ink` · `paper` · pad 13/24 · gap 12 | `border-b-2 border-ink paper` |
| — 섹션 제목 + 카운트 | Outfit 800 · 20 / mono 12 `mute-soft` | `font-display` / `font-mono-label text-mute-soft` |
| — **상태 세그먼트** | 그룹 pill: border 1.5 ink · radius 999 · 셀 사이 1.5px ink 구분선 · shadow 2px2px0 ink/12 | picker system 그룹 트리거 재사용 |
| — 세그먼트 활성 셀 | `bg-ink text-paper` · 12.5/800 · 카운트 `opacity .7` | `bg-ink text-paper` |
| — 세그먼트 비활성 셀 | paper · 12.5/700 `mute` · 카운트 `faint` | `text-mute` |
| — 검색 | max-w **280**(조직 전체 · 발급자 필터가 있을 때) / **320**(그 외) · border 1.5 ink · **radius 22** · pad 8/15 | `border-ink rounded-field paper` |
| — **발급자 필터** (admin · 조직 전체 한정) | border 1.5 ink · radius 10 · pad 6/11 · shadow 2px2px0 ink/12 · 아바타 스택 3개(18px · `margin-left:-6px`) + 라벨 12/700 + caret | §0.5 · 조건부 렌더 |
| — 정렬 트리거 | 라벨 셀 + 1.5px ink 구분선 + caret 셀 · radius 10 · shadow 2px2px0 ink | `rounded-control shadow-memphis-sm` |
| 열 헤더 | pad 10/24 · `border-b 1px line` · paper · mono 9.5 `.08em` 대문자 `mute-soft` | `border-b border-line font-mono-label text-mute-soft` |
| 푸터 스트립 | `border-t 1px line` · `paper-soft` · pad 9/24 · mono 11 `mute-soft` | `border-t border-line paper-soft font-mono-label` |

### §1.2 행
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 행 | pad 13/24 · gap 11 · `border-b 1px ink/8` | `border-b border-line` |
| — hover | bg `surface-canvas` + 타일에 `shadow-memphis-sm-faint` | `surface-canvas` |
| 산출물 타일 | **34px** · border 2px ink · radius 9 · bg `pastel.<tone>` · 아이콘 18px | `border-2 border-ink rounded-icon bg-<tone>` |
| — `revoked` 일 때 | bg **`surface-disabled`** · border 2px **`ink/28`** · 아이콘 스트로크 `mute-soft` · 채움 `paper` | `surface-disabled border-ink/28` (§0.4) |
| 제목 | 13.5/700 ink · truncate. `revoked` 는 `mute-soft` | `text-lg font-bold` |
| 종류 칩 | mono 10/700 `mute-soft` · border 1.3 `line-strong` · radius 5 | `font-mono-label border-line-strong rounded-xs` |
| 메타 라인 | 11px `mute-soft` — "MM-DD 발급". **조직 전체 스코프일 때만** 뒤에 `· <아바타><이름>` 추가(§1.2a). `revoked` 는 맨 뒤에 **"· MM-DD 철회"** 를 `mute` 800 으로 덧붙임 | `text-sm text-mute-soft` · `display:flex; gap:7` |
| **초대 열** | **210px 고정** · gap 5 · wrap | — |
| — 이메일 칩 | mono 10.5 ink · `paper-soft` · border 1.3 `line-strong` · radius 5 · pad 2/7 | `font-mono-label paper-soft border-line-strong rounded-xs` |
| — 넘침 표기 | mono 10.5/700 `mute` · `＋N` — **클릭하면 §1.5 펼침** | `text-mute` |
| — 초대 0명 | 11.5 `faint` · "초대 없음 · 링크를 아는 사람" | `text-faint` |
| **열람 열** | **126px 고정** · 2줄 | §0.3 |
| — 횟수 | mono 12/800 ink. `expired`/`revoked` 는 `mute` | `font-mono-label` |
| — 마지막 열람 | mono 10 `faint` | `text-faint` |
| — 미집계 | mono 12 `faint` · `—` | — |
| **만료 열** | **150px 고정** · 2줄 | — |
| — 날짜 | mono 11.5 `mute` | `font-mono-label text-mute` |
| — 남은 기간 | mono 10 `faint` | `text-faint` |
| — **7일 이내 경고** | 날짜가 mono 11.5/**800 `amber-text`** + 남은 기간이 칩으로 승격: `warning-bg` · border 1.3 `amber-line` · radius 5 · mono 10/800 | `text-amber-text bg-warning-bg border-amber-line` |
| — 만료 없음 | mono 11.5 `mute` · "만료 없음" (`expiresAt: null`) | — |
| **상태 열** | **108px 고정** | — |
| **액션 열** | **212px 고정** · 우정렬 · gap 7 | — |

### §1.2a 발급자 아바타 (조직 전체 스코프 한정)
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 아바타 | **16 × 16** · radius 50% · border 1.3 ink · 이니셜 8.5/800 ink · `flex-shrink:0` | `border-ink rounded-full` |
| 바탕색 | `pastel.*` 에서 **사람별로 고정 배정** — 산출물 톤 6종과 같은 팔레트 | 새 색 없음 |
| 이름 | 메타 라인과 같은 11px `mute-soft` · 아바타와 gap 5 | — |
| **내 것 표시** | 이름 뒤에 mono 9/800 `amore-deep` · `rose-bg` · border 1px `rose` · radius 4 · pad 0/4 · 라벨 **`나`** | `font-mono-label bg-rose-bg border-rose text-amore-deep` |
| `revoked` 행 | 아바타 바탕 `surface-disabled` · border 1.3 `ink/30` · 이니셜 `mute` · 래퍼 `opacity:.72` | 파스텔을 잃는 규칙을 아바타에도 적용 |
> 사진 아바타를 쓰지 않습니다 — 계약에 `avatarUrl` 이 없고(§5-8), 16px 에서는 이니셜이 더 읽힙니다.

### §1.3 상태 배지 — 라이브러리 4-상태 문법에서 3칸 사용
| status | 라벨 | 도트 | 틴트 | 보더 | 텍스트 |
|---|---|---|---|---|---|
| `active` | 활성 | `success` | `success-bg` | `success-line` | `success-text` |
| `expired` | 만료 | **속 빈** (`paper` + 1.6px `mute-soft` 링) | `paper-soft` | `line-strong` | `mute` |
| `revoked` | 철회됨 | **`ink` 채움** | `surface-disabled` | `ink/24` | `mute` |
> 배지 프레임은 라이브러리와 동일: pill · pad 3/10 · 11.5/700 · 도트 7px.
> **`error` 틴트를 쓰지 않습니다.** 철회는 사람이 의도해서 한 일이고 고장이 아닙니다. 붉은색은 이 표면에서 **철회 버튼과 확인 모달에만** 씁니다 — 목록에 붉은 배지가 3개 떠 있으면 뭔가 잘못된 화면처럼 읽힙니다.

### §1.4 액션 3종 — 잠금 매트릭스 (C2, normative)
| status | 복사 | 초대 편집 | 철회 |
|---|---|---|---|
| `active` | ✔ **primary** (`bg-ink text-paper` · border 2px ink · pill · shadow 2px2px0 ink/28) | ✔ secondary (`paper` · border 1.5 ink · shadow 2px2px0 ink/12) | ✔ **danger secondary** (`paper` · border 1.5 `amore-deep` · 텍스트 `amore-deep` 800 · shadow 2px2px0 amore-deep/24) |
| `expired` | ✖ 잠금 | ✔ secondary — **기한 연장 경로이므로 살립니다** | ✖ 잠금 |
| `revoked` | ✖ 잠금 | ✖ 잠금 | ✖ 잠금 |

- **잠금** = `surface-disabled` 트랙 · border 1.5 `ink/20` · 라벨 `mute` · **그림자 없음** · 아이콘 스트로크 `mute`. 래퍼 `opacity` 금지(명암비가 깨집니다).
- **숨김은 쓰지 않습니다.** 라이브러리는 `shareable=false` 에 숨김을 쓰지만, 여기 액션 3종은 어떤 상태에서도 "이 링크에 원래 없는 기능"이 아니라 "지금은 못 하는 일"입니다. 게다가 18행 목록에서 버튼이 나타나고 사라지면 액션 열의 우정렬이 행마다 흔들립니다.
- 붉은 **채움**은 확인 모달의 최종 버튼 하나에만 씁니다. 목록의 철회 버튼은 테두리만 붉습니다.
- **소유권은 이 매트릭스에 들어오지 않습니다.** `issuer.isMine` 은 액션 활성 여부를 바꾸지 않고, 확인 모달의 경고 밴드(§1.11)만 좌우합니다. RLS 확인 완료(§0.5).

### §1.5 초대 명단 펼침 (`＋N` 클릭)
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 팝오버 | max-w **420** · border 2px ink · radius 12 · paper · `shadow-popover` (4px4px0 ink/20) | `border-2 border-ink rounded-panel paper` |
| 헤더 | `paper-soft` · `border-b 1.5 line-strong` · pad 9/14 · mono 10 대문자 `mute` · 우측 "초대 편집 →" 11.5/800 `amore-deep` | `paper-soft font-mono-label` |
| 행 | pad 12/14 · gap 8 · 이메일 mono 11.5 ink · **여기서는 풀 주소** | `font-mono-label` |
| 우측 상태 | mono 10 `faint` | `text-faint` |
> **이메일 표기 규칙:** 목록 행에서는 **로컬 파트 + `@…`** 로 줄입니다(`recruiting-scheduling.dc.html` 선례와 동일). 펼침 팝오버에서만 풀 주소를 보여줍니다. 210px 열에서 도메인까지 넣으면 두 개도 안 들어가고, PII 를 목록 스캔 중에 계속 노출할 이유도 없습니다(브리프 §7).

### §1.6 철회 확인 모달 (C3a)
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 모달 | 폭 **560** container-owned · border 3px ink · radius 18 · shadow 8px8px0 ink/40 | `rounded-modal` |
| 헤더 | **`error-bg`** · `border-b 2px ink` · pad 14/20 · Outfit 800 19 | `bg-error-bg border-b-2 border-ink` |
| 대상 카드 | border 1.5 `line-strong` · radius 12 · `surface-canvas` · pad 13/15 · 30px 타일(산출물 톤 유지) | `border-line-strong rounded-panel surface-canvas` |
| 본문 | 13/1.8 `ink-2` · 굵은 부분 ink 800 | `text-lg` |
| 영향 범위 박스 | border 2px ink · radius 12 · `error-bg` · pad 13/15 · 이메일 칩 border 1.3 `error-line` | `bg-error-bg border-2 border-ink` |
| 푸터 | `border-t 2px ink` · `paper-soft` · pad 14/20 | `border-t-2 border-ink paper-soft` |
| 취소 | border 1.5 `ink/20` · pill · 13/700 `mute` | — |
| **확정** | `bg-amore-deep` · border 2px `amore-deep` · 텍스트 paper 800 · shadow 2px2px0 amore-deep/35 | `bg-amore-deep text-paper` |
> **확정 버튼 라벨은 "링크 끄기"** 입니다. "확인"·"철회"가 아닙니다 — 비가역 액션의 버튼은 무슨 일이 일어나는지 말해야 합니다.
> **영향 범위를 숫자로 말합니다** — "초대받은 4명 모두 열 수 없습니다" + 이메일 칩. 몇 명이 영향받는지 모르면 확인 단계가 클릭 한 번 늘리는 일밖에 안 됩니다.
> 재발급 시 **주소가 바뀌어 이미 보낸 메일의 링크는 살아나지 않는다**는 사실을 본문에 명시합니다. 이걸 모르고 끄는 것이 가장 비싼 실수입니다.

### §1.7 복사 피드백 (C3b) — 행 안에서
| 상태 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 기본 | primary 버튼 + `link` 아이콘 14px mono | §1.4 |
| **복사됨** | border 2px `success` · `success-bg` · 텍스트 `success-text` 800 · shadow 2px2px0 success/30 · **`min-width:82px`** · `✓ 복사됨` | `border-success bg-success-bg text-success-text` |
| 실패 | 행 아래 카드: border 2px ink · radius 12 · `error-bg` · 주소를 mono 11 로 노출(직접 선택 가능) | `bg-error-bg` |
- 복사됨은 **1.6초** 유지 후 기본으로 복귀(`motion` 토큰 사용).
- **`min-width` 를 두는 이유:** 라벨이 "복사"(2자) → "복사됨"(3자)로 늘면 액션 열의 우정렬이 튑니다. 두 상태의 폭을 미리 맞춰 둡니다.
- **토스트를 쓰지 않습니다.** 18행 목록에서 화면 구석 토스트는 어느 행을 복사했는지 말해주지 못합니다. 피드백은 누른 자리에서 일어납니다.

### §1.8 빈 상태 · 필터 빈 결과
| 요소 | 4a 빈 상태 | 4c 필터 빈 결과 |
|---|---|---|
| 아이콘 타일 | **70px** · border 3px ink · radius 19 · paper · `shadow-memphis-lg` @22% | **62px** · **2.5px dashed `line-empty`** · radius 17 · paper · 그림자 없음 |
| 아이콘 | `link` 34px ink | `link` 28px `mute-soft` |
| 제목 | Outfit 800 · 22 · ls -0.4 | 16/800 |
| 본문 | 13/1.75 `mute` · max-w 520 · 중앙 | 12.5/1.7 `mute` · max-w 480 |
| 액션 | primary pill "산출물 보기 →" | secondary pill "전체 N개 보기" |
> 두 상태는 **다른 화면**입니다. 4a = "아직 아무것도 안 했다"(발급 동선으로 보냄), 4c = "있는데 이 필터엔 없다"(필터를 풀어줌). 같은 컴포넌트로 문구만 바꾸지 마세요 — 탈출구가 다릅니다.
> 4a 본문은 **이 화면이 발급하는 곳이 아니라는 점을 말합니다.** 빈 대시보드에 "＋ 링크 만들기" 버튼을 놓으면 발급 동선이 두 개가 되고, 브리프 §2의 범위와도 어긋납니다.

### §1.9 로딩 skeleton (4b)
| 요소 | 값 |
|---|---|
| 행 리듬 | 실제 행과 동일(pad 13/24 · 타일 34 · 2줄 텍스트 · 5개 열) |
| opacity 래더 | 1 → 0.78 → 0.56 → 0.42 → **0.32** (5행) |
| 색 | `rgba(29,27,32,.05 ~ .09)` — 위계가 높은 요소일수록 진하게 |
| 타일 | 34px radius 9 · `ink/9` |
| 제목 줄 / 메타 줄 | h 12 radius 4 / h 9 radius 4 |
| 배지 자리 | 64 × 21 radius 999 |
| 버튼 자리 | 66 / 74 / 48 × 27 radius 999 |
> **툴바의 세그먼트 카운트도 skeleton 입니다.** 0으로 그려 놓으면 빈 상태로 잘못 읽힙니다.

### §1.10 아이콘
UI 컨트롤에 **이모지를 쓰지 않습니다.** 전부 `iconography-duotone/` 인라인 SVG (viewBox 24 · stroke ink · **stroke-width 2** · linecap/linejoin round).

| 컨트롤 | icon | 크기 | 채움 |
|---|---|---|---|
| 탭 "공유" · 복사 버튼 · 빈 상태 타일 | `link` | 15 / 14 / 28 / 34 | 탭·타일은 채움 없는 스트로크, 버튼은 **mono**(ink 배경 → 흰 스트로크) |
| 프로젝트 스코프 pill | `project` | 15 | rose `#ffd0e2` |
| 행 타일 6종 | §0.2 표 | 18 | **타일 배경이 파스텔이므로 아이콘 채움은 `paper`** — 파스텔 위에 파스텔을 겹치면 형태가 사라집니다 |
| 잠긴 복사 버튼 | `link` | 14 | 스트로크 `mute` |
> 아이콘 채움 규칙이 다른 표면과 다릅니다: 여기서는 **타일이 톤을 담당하고 아이콘은 흰 채움**입니다. 34px 타일 안 18px 아이콘에 듀오톤을 또 쓰면 뭉칩니다.

### §1.11 소유자 경고 밴드 — 남의 링크 철회 시 (C5 · 5c)
| 요소 | 실측 | 클래스 / 토큰 |
|---|---|---|
| 밴드 | border 2px ink · radius 12 · **`warning-bg`** · pad 12/15 · gap 10 · 모달 본문 **맨 위** | `bg-warning-bg border-2 border-ink rounded-panel` |
| 아바타 | **24 × 24** · border 1.4 ink · 이니셜 11/800 | 행의 16px 보다 큼 — 모달은 단일 대상이라 무게를 십니다 |
| 문구 | 12.5/1.6 `amber-text` · 이름은 800 | `text-amber-text` |
> `issuer.isMine === false` 일 때만 렌더합니다. **나머지 모달 구조는 C3a 와 같습니다** — 밴드 하나를 조건부로 끼우는 것이지 모달을 둘로 나누는 것이 아닙니다.
> `error-bg` 가 아니라 `warning-bg` 입니다 — 모달 헤더가 이미 붉고, 그 아래 바로 붉은 밴드를 또 놓으면 두 경고의 위계가 같아져 둘 다 안 읽힙니다.

---

## §2 proposed-tokens

### (A) 승격 요청
| `--css-var` | 값 | 용도 |
|---|---|---|
| `--shadow-memphis-sm-crimson` | `2px 2px 0 rgba(194,51,79,0.24)` | 목록의 철회 버튼(danger secondary) |
| `--shadow-memphis-sm-crimson-strong` | `2px 2px 0 rgba(194,51,79,0.35)` | 확인 모달의 확정 버튼 |
| `--shadow-memphis-sm-success` | `2px 2px 0 rgba(22,163,74,0.30)` | 복사됨 상태 |
| `--shadow-popover` | `4px 4px 0 rgba(29,27,32,0.20)` | 초대 명단 팝오버. **인터뷰 번들에서도 같은 값으로 요청했습니다** — 둘을 같은 토큰으로 승격하세요 |
| `--radius-t-control` | `10px 10px 0 0` | 탭바 활성 탭 |
> crimson/success 그림자는 기존 `shadow-memphis-md-error`/`-amber` 와 같은 문법의 sm 사이즈입니다. 새 색이 아니라 기존 signal 색의 그림자 변형입니다.

### (B) 로컬 (승격 보류)
| 토큰 | 값 | 위치 |
|---|---|---|
| `--sm-col-invited` | `210px` | 초대 열. 마스킹된 칩 2개 + `＋N` 이 들어가는 최소치 |
| `--sm-col-views` | `126px` | 열람 열 (§0.3 이 뒤집히면 삭제) |
| `--sm-col-expiry` | `150px` | 만료 열. 경고 칩이 들어가는 폭 |
| `--sm-col-status` | `108px` | 상태 열 |
| `--sm-col-actions` | `212px` | 액션 열 |
| `--sm-copy-btn-w` | `82px` | 복사 버튼 min-width (§1.7) |
| `--sm-avatar-row` / `--sm-avatar-modal` | `16px` / `24px` | 발급자 아바타 (§1.2a · §1.11) |

### (C) 폐기되는 임의값
없습니다 — 신규 표면입니다. 다만 **라이브러리에서 이 표면으로 가져온 값에 임의값이 섞여 있으면 안 됩니다.** 포팅 시 `deliverables-library-BUILD-SPEC.md §2`("proposed-token 없음")를 근거로 전부 토큰으로 바인딩하세요.

---

## §3 상태 전수 — 브리프 §4 대응

| 브리프 요구 | 프레임 | 비고 |
|---|---|---|
| 1. 빈 상태 (0건) | C4 · 4a | 발급 동선으로 보내는 문구 |
| 2. 목록 · 3상태 혼재 | C1 | 6종 산출물 · active 4 / expired 1 / revoked 1 · 행 4 hover |
| — 만료 임박 | C1 행 2 | 7일 이내 경고 칩 |
| — 만료 없음 | C1 행 3 | `expiresAt: null` |
| — 초대 0명 | C1 행 3 | "링크를 아는 사람" |
| 3. 철회 확인 | C3 · 3a | 영향 범위 + 비가역 명시 + "링크 끄기" |
| 4. 복사 피드백 | C3 · 3b | 기본 / 복사됨 / 클립보드 실패 |
| 5. 로딩 skeleton | C4 · 4b | 5행 · opacity 래더 |
| 6. expired/revoked 처리 | C1 · C2 | 한 목록 + 상태 필터 + 톤 상실 (§0.4) |
| (추가) 액션 잠금 규칙 | C2 | 화면이 아니라 적합성 대상 |
| (추가) 초대 명단 펼침 | C3 · 3c | 풀 주소는 여기서만 |
| (추가) 필터 빈 결과 | C4 · 4c | 빈 상태와 구분 |
| **(§9) member · 스코프 토글 없음** | C5 · 5a | 기본형 |
| **(§9) admin · 내 링크** | C5 · 5b | 토글 있고 아바타 없음 |
| **(§9) admin · 조직 전체** | C1 | 아바타 + 발급자 필터 |
| **(§9) 남의 링크 철회** | C5 · 5c | 소유자 경고 밴드 |

**안 그린 것 (필요하면 요청):** 다중 선택 + 일괄 철회 · 페이지네이션/무한스크롤 · 로드 실패(500) 화면 · 만료일 직접 편집(초대 모달 소유) · 모바일 <900. 브리프 §2에 없어서 발명하지 않았습니다.

---

## §4 인터랙션 면책
`.dc.html` 은 **정적 컴프**입니다. 필터·정렬·검색·팝오버 열기/배치·복사 타이머·모달 열기·`onOpenInviteManage` 라우팅은 전부 워커 소유이고 배선하지 않았습니다. 애니메이션은 `tokens.json motion` 토큰만 쓰고 `prefers-reduced-motion: reduce` 에서 전부 무력화합니다.

---

## §5 ⚠️ contract-change

1. **`⚠️ contract-change:` `resourceType` → 라벨·톤 맵의 위치.** 행 칩의 한국어 라벨("인터뷰 탑라인")과 파스텔 톤을 컴포넌트 안에서 `resourceType` 으로 매핑하면 산출물 종류가 늘 때마다 프런트가 바뀝니다. **`resourceLabel: string` + `tone` 을 `ShareLinkItem` 에 넣는 편을 권합니다** — `share-shell-BUILD-SPEC.md §5.2` 에서 같은 결정을 이미 한 번 했습니다. 넣지 않기로 하면 클라이언트 맵으로 갑니다(6종은 감당 가능, 12종부터는 아닙니다).
2. **`⚠️ contract-change:` 이메일별 마지막 열람 시각.** C3c 팝오버 우측 열("08-06 열람" / "아직 안 열었음")은 계약에 없습니다. 브리프 §5가 **개별 열람자 신원 미제공을 확정**했으므로 이 열은 아마 불가입니다. **불가면 우측 열을 지우고 명단만 남깁니다 — 레이아웃은 그대로 성립합니다.** 초대 명단 자체는 내가 넣은 값이라 표시에 문제 없습니다.
3. **`⚠️ contract-change:` 마지막 열람 시각(링크 단위).** §0.3 이 렌더하는 "08-06 09:14"는 `viewCount` 옆에 필요한 값입니다. 브리프 §5가 "최종 열람 시각 제공 가능"이라 했으니 `lastViewedAt?: string | null` 로 계약에 올려 주세요. 없으면 횟수만 렌더합니다.
4. **`⚠️ contract-change:` 발급자.** ~~행 메타의 "김연구"~~ → **§9 에서 해소**됐습니다: `issuer: { name, isMine }` 확정(백엔드 준비 중). 다만 **`revokedAt`** 은 여전히 계약에 없습니다 — `revoked` 행의 "· 08-05 철회"에 필요합니다. 없으면 그 절만 지우면 됩니다.
5. **`⚠️ contract-change:` 세그먼트 개수.** 툴바의 11 / 4 / 3 / 18 은 facet count 입니다. 전체 배열이 오면 클라이언트가 세도 되지만, **페이지네이션이 들어오면 깨집니다** — `deliverables-library-BUILD-SPEC.md §5.3` 과 같은 문제이므로 같이 결정하세요.
6. **`⚠️ contract-change:` `url` 의 표시 필요성.** 컴프는 실패 상태(C3b)에서만 URL 을 보여줍니다. 목록에 URL 열이 필요하다면 열 폭 재배분이 필요합니다 — 지금은 필요 없다고 판단했습니다(주소는 사람이 읽는 값이 아니라 붙여넣는 값).
7. **`⚠️ contract-change:` 철회 알림.** C5 · 5c 의 "끄면 그분에게 알림이 갑니다"는 **알림이 실제로 가야** 쓸 수 있는 문장입니다. 안 가면 그 절을 지우고 소유자 이름만 남기세요 — 밴드 자체는 그대로 성립합니다.
8. **`⚠️ contract-change:` 아바타 이니셜·색.** `issuer` 에 `name` 만 있으므로 이니셜은 클라이언트가 자릅니다(한글 성 1자 / 라틴 이니셜 2자). **바탕색은 이름 해시로 파스텔 6종에 고정 배정**하면 계약 변경 없이 동작합니다. `avatarUrl` 을 줄 계획이 있으면 알려주세요.
9. ~~**`⚠️ contract-change:` 보는 사람의 역할.**~~ → **확정 (writer, 2026-08-06). 계약 필드명 = `canViewOrgScope: boolean`** — 응답 최상위, admin/owner 에서 파생. §0.5 분기는 이 플래그 하나로 갑니다:
   - `canViewOrgScope === false` → 스코프 토글·발급자 필터·행 아바타 **전부 렌더하지 않음** (C5 · 5a)
   - `canViewOrgScope === true` → 토글 렌더. 선택값이 `내 링크` 면 발급자 축 없음(5b), `조직 전체` 면 아바타 + 발급자 필터(C1)
   - `viewerRole` 을 따로 받지 않습니다 — 이 화면이 역할로 하는 일은 이 분기 하나뿐이라 boolean 이면 충분하고, 역할 문자열을 받으면 컴포넌트가 권한 규칙을 알게 됩니다.

---

## §6 열린 항목
1. **`/library` 탭바가 실재하는지.** 브리프 §6은 "탭 구조가 이미 있음"이라 했지만 `deliverables-library.dc.html` 의 헤더에는 탭 행이 없습니다(제목+검색+정렬+뷰토글). 탭바가 아직 없다면 **공유 chrome 으로 한 번 만들어 4탭이 공유**해야 하고, 라이브러리 헤더도 같이 손대야 합니다 — 그 작업은 이 번들 범위 밖입니다. 필요하면 요청하세요.
2. **§0.3 열람수 노출은 CD 제안이고 사용자 확정 대기입니다.** 뒤집히면 열 하나를 지우는 일이고 나머지는 그대로입니다.
3. **일괄 철회.** 링크가 수십 개로 늘면 필요해집니다. 라이브러리의 다중선택 + bulk bar 문법(`deliverables-library-BUILD-SPEC.md §3 A4b`)을 그대로 가져올 수 있게 행 왼쪽에 체크박스 자리(15px + gap 9 = 24px)를 비워 둘 수 있으나, **지금은 넣지 않았습니다** — 브리프 범위 밖이고, 비가역 액션의 일괄 실행은 별도 결정이 필요합니다.
4. **조직 vs 개인 스코프.** → **완결.** §9 (a) 반영 + `canViewOrgScope` 확정(§5-9). 미결 없음.
5. **공개 뷰어와의 접점.** 철회된 링크를 열면 `share-shell` 의 dead-end 화면이 뜹니다(`share-shell-BUILD-SPEC.md §3 B3b` — revoked 는 expired 와 같은 레이아웃에 문구만 교체). 이 대시보드에서 끈 결과가 그 화면이라는 점은 이미 일관됩니다.
6. **조직 전체 스코프의 빈 상태.** 4a 문구("아직 공유한 링크가 없습니다" + "산출물 보기 →")는 **1인칭입니다.** 조직 전체에 0건이면 "조직에 공유한 링크가 아직 없습니다"로 바뀌고, admin 본인이 발급하러 가는 게 맞는 탈출구인지도 다릅니다. 드문 조합이라 그리지 않았으니, 필요하면 요청하세요.
7. **발급자가 조직을 떠난 경우.** `issuer.name` 이 비거나 탈퇴 표시가 필요한지 — 계약에도 브리프에도 없습니다. 링크는 남고 사람은 떠나는 상황은 실제로 생기고, 그때 그 링크를 누가 끄는지가 문제가 됩니다.
