# RECRUITING-JOURNEY — BUILD-SPEC

> **Consumes:** `FUSIONBRIEF.md` (IA + decisions), `CONTEXTRECSCHED.md` (scheduling design+backend), `CONTEXTRECRUITINGFULLVIEW.md` (fullview design+backend), `FULLVIEW-SHELL.md` §F (shell class-map), `WIDGET-SHELL.md` §S3 (recruiting = **sun `#ffe8a8`**), `tokens.json`. **CD SSOT:** `Recruiting Journey Fullview.dc.html`. **Date:** 2026-07-25.
> **Frame:** per D2 decision, fullview grows to **1600×940 (≈90vw×90vh)**; tab ③ scrolls internally (calendar card intrinsic 1020px). Sidebar 240px (FULLVIEW-SHELL §F1).

## §1 Shell + tab map (diff target)
Shell = `FULLVIEW-SHELL.md §F1–F3` (frame 3px ink / radius 14/16 / fv-frame-shadow · 240px sidebar · sun header band). Additions this feature introduces:
| Element | Spec | Token / class |
|---|---|---|
| Header row-1 | title (Outfit 800 22) + project pill + **master-link chip** + **Share btn** + refresh + ✕ | `bg-widget-header-sun`; pill/chip/btn = `paper border-ink rounded-pill shadow-memphis-sm`; master-link chip bg = sky `bg-widget-header-sky` |
| **3-tab nav** (row-2) | folder tabs, active = `surface-canvas` fill w/ 2px ink top+sides, −2px overlap onto body; each tab = icon + label + count pill | `border-2 border-ink rounded-t-[11px]`; active `bg-surface-canvas`; count = `font-mono rounded-pill` |
| Dead-portal fix | pill·CSV·refresh MUST render (CONTEXTRECRUITINGFULLVIEW A1 ⚠️ — recruiting never injected them). Header slots via `FullviewHeaderSlotProvider` publish. | `⚠️ contract-change:` see §5.4 |
| **Bridge bar** (①) | selection-mode bar under summary/raw toggle; check + "N명 선택됨" + green "→ 명단으로 보내기" CTA + 해제 | `bg-[signal-success-bg-soft]` inset bottom rule; CTA `bg-success text-white border-2 border-ink rounded-pill shadow-memphis-sm` |
| Source card "연동됨" | mint-tinted linked-source card w/ "N명 연동됨 🔒" pill | `bg-success-bg border-2 border-ink` + `proposed:signal-success-*` |
Body primitives (cards, tables, chips, calendar blocks, chat, modals) = reuse the recruiting-scheduling class-map already in the prior bundle + `FULLVIEW-SHELL §F4`. **Sticky-3col table geometry preserved** (check 44 / name 168 / contact 184, `border-separate`, right shadow) — CONTEXTRECSCHED A.2.5.

## §2 proposed-tokens (reuse from FULLVIEW-SHELL §F6 + recruiting-scheduling; new-here below)
Do NOT mint duplicates — calendar slot colors, announcement banner, toast, master-link bar already defined in the recruiting-scheduling BUILD-SPEC §2. New to the fusion:
- `proposed:tab-active-fill` = `surface-canvas #fbfbf9` (folder-tab active) — reuse `surface-canvas`.
- `proposed:bridge-bar-bg` = `signal-success-bg-soft #eafaf0` (① selection bar). 
- PII-masked cell tone = `text-faint #a3a7ad` + 🔒 (reuse `proposed:text-faint`).
Everything else (ink/mute/paper/amore/success/amber, memphis shadows, radii, pastel header tints, sun/sky) = existing `tokens.json` / FULLVIEW-SHELL §F5–F6.

## §3 State matrix (all STATIC — build each)
| # | Tab / surface | State | Notes |
|---|---|---|---|
| N1 | ① 응답 | populated + **selection mode** | conditions panel · gender×age crosstab (active cross-filter chip) · fit-filter chips · judged table w/ checkboxes · bridge bar (3 selected) |
| N4 | ①→② bridge | modal | target-group Select · **D1-A PII notice (🔒 masked, admin-proxy send)** · selected list (masked contact) · dedup note |
| N2 | ② 명단 | populated · dual-PII | source 3-up (응답 연동됨🔒 / CSV / Sheets) · list controls (status filter) · bulk bar · sticky-3col table (bridged rows 🔒 masked · upload/sheet rows plaintext) |
| N3 | ③ 일정 | populated | calendar (colored blocks, 80px/h) + collapse rail + multi-tile chat (announcement banner vs bubbles, red-bean, segment+radio hierarchy) + confirmed roster · **internal scroll (D2)** |
| N5 | states | empty · google-reauth · slot-create(group fan-out) | 3 state cards |
> Not yet drawn (worker: request from CD or reuse prior bundle): ② empty/loading, ③ calendar/chat empty, respondent drawer (reuse legacy per CONTEXTRECRUITINGFULLVIEW B4), bridge success toast, phone-gate error, Sheets OAuth bounce (reuse prior bundle), collaborator-share modal (reuse prior).

## §4 Interaction disclaimer (static comps)
Comps disclose states, not behavior. Worker owns: tab switching, response selection→bridge POST, cross-filter math, form selector, calendar cell→create / block→edit, chat reach→payload map, multi-tile open/focus/close, red-bean last-seen, copy/refresh/share. Nothing is wired in the `.dc.html`.

## §5 ⚠️ contract-change (confirm with writer/product BEFORE building)
> These change data/flow/policy, not just pixels. Tied to FUSIONBRIEF §5 decisions D1–D5.
1. **`⚠️ contract-change:` bridge API (NEW — core).** Selected responses → `sched_candidates`. **PII flows server-only**: server reads name/phone/email from Forms response, creates candidate rows, returns masked fields to client per policy; other columns carried to `fields` jsonb. dedup = existing multi-key upsert (email>phone>name). Requires `sched_projects.form_id` (nullable, additive) + 1:1 lazy project provisioning. FUSIONBRIEF §4.1–4.2. **Blocks N1/N2/N4 wiring.**
2. **`⚠️ contract-change:` dual-source PII policy (D1-A).** Response-bridged candidates → contact **masked** (🔒 ●●●●), admin-proxy sends invites (policy unchanged). Upload/sheet candidates → **plaintext** (user's own data). Candidates table + bridge modal render both; confirm masking is server-enforced per source. FUSIONBRIEF §5-D1.
3. **`⚠️ contract-change:` entry removal.** `/admin/recruiting-scheduling` + account-menu scheduling entry **removed**; redirect `/admin/recruiting-scheduling → /canvas?focus=recruiting`. `/admin/recruiting-invitations` (superadmin desk) **kept** if D1-A. FUSIONBRIEF §3, §5-D4.
4. **`⚠️ contract-change:` header dead-portal fix.** Recruiting fullview never rendered pill/CSV/refresh (portal never injected — CONTEXTRECRUITINGFULLVIEW A1). Must move to `FullviewHeaderSlotProvider` publish (as probing/desk/interpreter did). Also wire the interactive `FullviewProjectPill` (recruiting still display-only).
5. **Access unification.** Fused surface gate = **form owner OR their org member** (extend scheduling `getSchedulingAccess` to form-anchor). Recommend adding `org_id` to `sched_*` (B4 debt). FUSIONBRIEF §4.4.
6. **Preserved contracts (unchanged — do NOT touch):** participant route/phone-gate/HMAC cookie · chat fan-out payload (is_announcement×batch_id×private) · slot fan-out · source ingest upsert · Realtime/polling · responses PII blanking · admin-proxy token routing. CONTEXTRECSCHED §B, CONTEXTRECRUITINGFULLVIEW §B.

## §6 Open decisions (FUSIONBRIEF §5 — CD reflected a recommendation; product confirms)
- **D1** PII/bridge model — CD shows **A (admin gate, masked)**. Confirm A vs B (self-serve plaintext).
- **D2** frame size — CD shows **1600×940 + tab③ internal scroll**. Confirm vs split calendar/chat layout.
- **D3** share/master-link placement — CD **promoted to header**. Confirm.
- **D4** `/admin/recruiting-invitations` desk — keep (A) vs shrink (B).
- **D5** form↔project cardinality — 1:1 vs form-with-multiple-rounds.
- Inherited scheduling opens: phone-suffix collision UX · master-link rotate UI · group-head tint scheme · calendar 80px/h density.
