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

- 2026-07-10 · PR (iconbutton-plain-variant) · §3 · IconButton `plain` variant 추가 — bare glyph (border/bg/shadow 무, hover 색만 text-mute→ink-2)
