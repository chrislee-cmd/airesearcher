# Design System 갱신 후보 (inbox)

`docs/DESIGN_SYSTEM.md` 갱신 후보를 모으는 포스트잇 통.
PROJECT.md §5.4 의 `docs/PROJECT_PENDING.md` 와 동일 패턴.

## 룰

**언제 추가하나** — PR 머지 후 self-check. 다음 중 하나라도 해당하면 한 줄 append:

| 트리거 | DESIGN_SYSTEM.md 갱신 위치 |
|---|---|
| 새 primitive 추가 (`src/components/ui/` 안 새 파일) | §3 Primitive 카탈로그 |
| 새 raw 토큰 키 추가 (`--raw-*`) | §1.2 카테고리 표 + 모든 `[data-theme]` 블록 동기화 점검 |
| 새 semantic / component 토큰 추가 | §1.3 / §1.4 |
| 새 톤 추가 (`[data-theme="<new>"]`) | §2 등록 theme |
| Hardcoded hex sweep PR 머지 | §4.2 카운트 갱신 (139건 → N건) |
| primitive variant / size 변경 | §3 해당 항목 |
| 톤 swap 시 알게 된 함정 / 회귀 | §5.3 디버그 표 |

**기록 포맷** (이 파일에 append):
```
- YYYY-MM-DD · PR #XXX · §X.Y · 한 줄 요약
```

**승격 트리거**:
- inbox 5건 누적 시 묶음 PR 로 DESIGN_SYSTEM.md 갱신 + inbox 라인 삭제
- 시급 트리거 (새 톤 swap 직전 / 미해결 회귀 발견) 시 즉시 단건 PR 도 가능
- 폐기 후보는 line 삭제 + 이유 한 줄 메모 (commit 메시지에)

**왜 inbox 두는가**:
- 매 머지마다 갱신 PR 만들면 overhead. 묶음이 효율적.
- 메모리에만 두면 다른 세션 / 미래 협업자에게 손실. 파일이면 GitHub 에서도 보이고 워커도 추가 가능.
- "이 변경이 DESIGN_SYSTEM 갱신감인가" 자체도 함께 결정 (모든 후보가 SSOT 갈 필요 없음).

---

## 후보 (newest on top)

<!-- 예시:
- 2026-07-15 · PR #520 · §3.15 · Tooltip primitive 추가 (variant default/dark, size sm/md)
- 2026-07-10 · PR #515 · §2.3 · brutalist theme 추가 — 새 라우트 sweep 필요
- 2026-07-02 · PR #501 · §4.2 · translate-console hex 6건 sweep → 139→133
-->

- 2026-07-12 · PR (ds-dropdown-promote-selectmenu) · §3 · SelectMenu primitive 카탈로그 등재 (/design-system Form primitives, Select 다음). ui/select-menu.tsx 는 이미 #745 에서 desk local SelectMenu 를 승격해 존재(desk/probing/interviews-v2 소비 중) — 이번 PR 은 카탈로그 섹션(single/multi 인터랙티브 데모) + gen:ds-usage 재생성 + 3계보 역할 구분 명문화(SelectMenu=값 선택 ↔ DropdownMenu=액션 실행 ↔ Select=native 단일)만 추가. 리크루팅 question-filter-menu 는 2단계 중첩(질문→답변) 구조라 플랫 SelectMenu options 모델에 안 맞아 교체 스킵(보수적 — 프리미티브 중첩/그룹 지원 확장은 후속)
- 2026-07-11 · PR (ds-badge-chip-primitive) · §3 · Badge primitive 추가 — 표시용(DISPLAY) chip pill (상태/라벨/필터). variant neutral(투명+ink 보더)/subtle(ink/25+paper-soft)/amore(브랜드) · size sm(default)/md · leadingIcon · onDismiss(× 제거, ChipField × 패턴과 동일) · 역할 구분 명문화: Badge=표시 ↔ ChipInput/ChipField=입력. 손말이 3계열 교체(리크루팅 분포 필터칩 + 프로빙 팝업 technique/target 뱃지) + 리크루팅 캡션 tracking 2곳(conditions/distribution) 0.04em→0.22em(Label 규격) 통일. 전면 캡션 sweep(judged-list/responses-spreadsheet 테이블 헤더 등)은 후속
- 2026-07-10 · PR (ds-memphis-shadow-tokens) · §1.2/§1.4 · Memphis hard offset shadow 토큰화 — raw offset 스케일 `--raw-memphis-{2xs,xs,sm,md,lg,2xl}`(pop+editorial 동기화) + @theme `--shadow-memphis-*` 11개(색 조합: base black / -faint rgba15% / -warning / -amore / -card / 2xl=ink). ui/ 프리미티브 32곳 `shadow-[Npx_Npx_0_*]` arbitrary → 토큰 순수 치환(diff-0). 6px(xl) 등 미사용 스케일은 미신설. canvas/widgets sweep 은 DS-2 별도
- 2026-07-10 · PR (chipfield-primitive) · §3 · ChipField primitive 추가 — 칩 컨테이너 SSOT (프레임 + 칩 pill + plain × + 내부 ChipInput). variant bordered(default)/subtle · API values/onChange/maxItems/maxLength/commitOnComma/disabled/chipRemoveLabel/inputType · IME-safe commit 내장. Phase 2 에서 desk/translate/tags/invite 4곳 정합
- 2026-07-10 · PR (iconbutton-plain-variant) · §3 · IconButton `plain` variant 추가 — bare glyph (border/bg/shadow 무, hover 색만 text-mute→ink-2)
