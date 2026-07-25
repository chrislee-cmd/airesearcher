# RECRUITING-JOURNEY — Handoff entry point (Claude Design → repo)

> **Feature:** fusion of recruiting **fullview** (response analysis) × **recruiting-scheduling** into ONE 3-tab journey funnel. Fullview is the only entry. **Date:** 2026-07-25. **CD = visual SSOT.**
> **Source briefs:** `uploads/FUSIONBRIEF.md` (§3 IA, §6 deliverable ask), `uploads/CONTEXTRECSCHED.md` (1/3), `uploads/CONTEXTRECRUITINGFULLVIEW.md` (2/3).
> **Delta bundle.** Assumes repo has: `CONTEXT-PACK.md`, `tokens.json`, `WIDGET-SHELL.md`, `FULLVIEW-SHELL.md`, `CD-DELIVERABLE-RULES.md`, `docs/DESIGN_SYSTEM_CURRENT.md`.

## ⚠️ THIS SUPERSEDES the prior `recruiting-scheduling/` bundle
The 2026-07-22 `design-handoff/recruiting-scheduling/` bundle (7 standalone admin frames on a 1360 page card) is **superseded** by this one. Reconcile = **override**, not additive:
- The standalone `/admin/recruiting-scheduling` **page shell is dropped**. Its List / Calendar / Chat / Slot-editor / Participant surfaces are **re-homed inside the recruiting FULLVIEW** as tabs ② and ③.
- Keep from the old bundle (unchanged, re-used as-is): **participant surface** (`/schedule/<token>` phone-gate + view — frames 03B/04) and every **backend contract** in CONTEXTRECSCHED §B.
- Everything else in the old bundle now reads through this file's frames. Mark the old `recruiting-scheduling/` folder `SUPERSEDED-BY: recruiting-journey/` in its README (writer).

## What's in this bundle
| File | Role |
|---|---|
| `recruiting-journey/HANDOFF.md` | this — read first |
| `recruiting-journey/BUILD-SPEC.md` | §1 shell/tab map · §2 tokens · §3 state matrix · §4 interaction · **§5 ⚠️ contract-change (bridge/PII/entry-removal — READ)** · §6 open decisions (D1–D5) |
| `recruiting-journey/Recruiting Journey Fullview.dc.html` | visual SSOT — 5 frames (N1 응답 · N4 브리지 · N2 명단 · N3 일정 · N5 states). Inline hex = render-only; bind to tokens. |
| `recruiting-journey/support.js` | local runtime. Not a build artifact. |

## The fused IA (FUSIONBRIEF §3)
```
[리크루팅 풀뷰 — §F shell, sun header, 3 journey tabs]
 ├─ ① 응답 (Responses)   ← 기존 fullview state 08 리프레시 + 선택모드 → [② 명단으로 보내기] 브리지
 ├─ ② 명단 (Candidates)  ← scheduling "리스트 뷰" 흡수 (소스: 응답브리지🔒 + 업로드 + 시트)
 └─ ③ 일정 (Schedule)    ← scheduling "캘린더+채팅+로스터" 흡수
```
Header (all tabs): 3-tab nav + **master-link + Share promoted to header** (D3) + project pill + refresh + ✕. Participant uses the master link (unchanged).

## Read order (worker)
1. This file → the supersede scope + IA.
2. `BUILD-SPEC §5` — contract-changes; **confirm D1–D5 with writer/product before building** the bridge + entry-removal.
3. `BUILD-SPEC §3` — the 5 frames/states (+ not-yet-drawn list).
4. `Recruiting Journey Fullview.dc.html` — pixel reference.
5. Diff TSX class list against `§1` + `FULLVIEW-SHELL.md §F` + `tokens.json`; resolve `§2` proposed-tokens.

## Rules (unchanged — CD-DELIVERABLE-RULES.md)
1. Utility class / token only — raw hex/px = drift; new value → `proposed-token:` (§2).
2. Conformance-first — every visual element = explicit class (worker diffs).
3. All states static (§3) — build each; don't infer.
4. Contract-outside-spec → `⚠️ contract-change:` (§5), never silent invention.
5. Build **fresh** per CD (fullview presentation); reuse **logic/data only** — the whole scheduling backend (`sched_*`, APIs, fan-out, phone-gate, PII pipe) is preserved (CONTEXTRECSCHED §B; CONTEXTRECRUITINGFULLVIEW §B). Do NOT re-skin legacy admin-page components — re-home them.
