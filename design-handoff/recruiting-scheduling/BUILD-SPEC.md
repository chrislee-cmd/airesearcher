# RECRUITING-SCHEDULING — BUILD-SPEC

> **Consumes:** `CONTEXTFORCD.md` (legacy + contracts to preserve), `tokens.json` / `docs/DESIGN_SYSTEM_CURRENT.md` (vocab), `WIDGET-SHELL.md` §S3 (widget identity: recruiting = **sun `#ffe8a8`**), `CD-DELIVERABLE-RULES.md`. **CD SSOT:** `Recruiting Scheduling Redesign.dc.html`. **Date:** 2026-07-22.
> **System move (the whole point):** legacy was **flat editorial** (1px `border-line`, no shadow, `rounded-sm`, sans). Redesign pulls it to **Memphis** (see §1). This resolves CONTEXTFORCD §6.1 (Memphis-vs-flat) by choosing Memphis, consistent with widgets V2 + fullview.

## §1 Class map (Memphis primitives — diff target)
Every surface below uses these; bind, don't hardcode. Values are the app's existing Memphis tokens (already in card widgets / fullview).
| Element | Spec | Token / class |
|---|---|---|
| Screen frame | border 3px ink · radius 14 · shadow 8px8px0 ink/28 · bg `surface-canvas` #fbfbf9 | `border-[3px] border-ink rounded-sm` + `proposed:shadow-fullview-frame` + `proposed:surface-canvas` |
| Header band | border-b 3px ink · pad 15/26 · **bg = sun `#ffe8a8`** (recruiting identity) | `border-b-[3px] border-ink bg-widget-header-sun` |
| Screen title | Outfit 800 · 23px · ink · ls -0.5 | `font-display font-extrabold` + `proposed:text-fullview-title` (≈23) |
| Card / panel | border 2px ink · radius 12 · paper · shadow 2–3px hard | `border-2 border-ink rounded-sm paper shadow-memphis-sm` (`-md` for 3px) |
| Strong card | border 3px ink · radius 14 · shadow 4px4px0 (color = signal) | `border-[3px] rounded-sm shadow-memphis-lg` (tint via signal color) |
| Primary button | ink fill · #fff · rounded-pill · shadow 2–3px | `bg-ink text-white rounded-pill shadow-memphis-sm` |
| Secondary button | paper · border 2px ink · rounded-pill · shadow 2px2px0 ink | `paper border-2 border-ink rounded-pill shadow-memphis-sm` |
| Segmented control | border 2px ink · rounded-pill · active seg = ink fill | `border-2 border-ink rounded-pill`; active `bg-ink text-white` |
| Radio (reach) | 16px circle · 2px ink border · filled = 8px ink dot | `border-2 border-ink rounded-full`; selected inner `bg-ink` |
| Field / input | border 1.5–2px ink · radius 10–11 · paper | `border-ink rounded-[10px] paper` |
| Dashed dropzone | 3px dashed ink · radius 14 · shadow 4px4px0 ink/16 (already Memphis in `file-drop-zone.tsx`) | keep primitive; align surrounding tone |
| Table (sticky-3col) | `border-separate border-spacing-0`; check 44 / name 168 / contact 184 sticky-left; contact col border-r 2px ink + right shadow | **preserve geometry (CONTEXTFORCD §5.9)**; skin cells Memphis |
| Confirm chip | text `#14713a` · bg `#f4fbf6` · border `#cdeed8` | `proposed:signal-success-{text,bg,line}` |
| Mono labels/timestamps | ui-monospace · 9.5–11px · mute-soft | `proposed:font-mono-label` (see FULLVIEW-SHELL §F7.1) |
> Pastel header tints reused across screens: participant = sky `#cfe6ff`; group heads = sky/mint/neutral. Calendar slot status colors in §3.

## §2 proposed-tokens (reuse from FULLVIEW-SHELL §F6 where present)
Same vocab as fullview — do NOT mint duplicates. New-here values:
- **Calendar slot status** (colored time-blocks, CONTEXTFORCD §6.3): `proposed:slot-proposed` border `#ff5c8a`/bg `#ffeef4`/dot `amore` · `proposed:slot-confirmed` border `success`/bg `#f4fbf6`/dot `success` · `proposed:slot-cancelled` border `ink/20`/bg `#f7f7f5`/dot `mute-soft` + line-through. Shadow = block-color at ~35% alpha.
- **Announcement banner** (§6.2): head bg = sun `#ffe8a8` · body bg `warning-bg #fff1e6` · border 2px ink · shadow 3px3px0 `#e0a83a`. Reuse `proposed:accent-amber`.
- Toast (§6.6, new layer): bg `signal-success-bg` · border 2px ink · shadow 3px3px0 `success`. Neutral/error variants follow signal family.
- Master-link bar: bg sky `#cfe6ff` · border 2px ink · shadow 3px3px0 ink.
- Everything else (ink/mute/paper/amore/success/amber ramps, memphis shadows, radii) = existing `tokens.json` / FULLVIEW-SHELL §F5-F6.

## §3 State matrix (all STATIC — build each)
| # | Screen | State | Notes |
|---|---|---|---|
| 01 | Admin · List (All candidates) | populated + toast + bulk-selected | source intake 2-up (CSV dropzone + Sheets) · **master-link bar** · list controls (segmented view / group / filter / sort) · bulk action bar (3 selected) · sticky-3col table w/ 확정 chip |
| 01B | Admin · List (By group) | grouped roster | per-batch section (head = name + count + Rename) · **Inbox/unassigned** section (Assign-to-group action) |
| 02 | Admin · Calendar + Chat | live | colored time-blocks (proposed/confirmed/cancelled) + legend · roster · chat rail: **segmented announcement/chat** + **radio reach** + announcement banner vs bubbles + composer |
| 02B | Chat reach sub-picker | All / Group / Individual | All = no sub-target · Group = group Select (recipient count) · Individual = candidate Select (defaults to open thread, pick to start new private thread) |
| 03 | Slot editor modal | edit (overlap warning) | **Title (free text)** → Target (assign mode + candidate) → Time (2× datetime + soft overlap warn) → Details (status/location/note) · footer Delete + Cancel/Save |
| 03B | Participant · Phone gate | entry | last-6-digit input (6 cells) · Verify · privacy note. Precedes 04. |
| 04 | Participant view | confirmed | slot card · **announcement banner** · chat bubbles · composer |
> Not yet drawn (worker: request from CD if needed): list empty/loading, calendar empty, chat empty, phone-gate error (wrong digits), slot editor **create** mode (assign-mode = group fan-out), Sheets-OAuth-bounce state.

## §4 Interaction disclaimer (static comps)
Comps disclose states, not behavior. Worker owns: project switch (URL full-nav), tab switches, client filter/sort, bulk select math, calendar cell→create / block→edit, chat reach payload mapping, phone-gate verify, copy/refresh actions. No interactivity is wired in the `.dc.html` by design.

## §5 ⚠️ contract-change (confirm with writer BEFORE building)
> These change data/flow vs CONTEXTFORCD, not just pixels. Do not silently invent — writer propagates.
1. **`⚠️ contract-change:` per-candidate token → master link.** Legacy `ShareLinkCell` issued a unique `/schedule/[token]` per candidate with copy + rotate (CONTEXTFORCD §5.8). Redesign uses **one project-shared link**; the per-row Share-link column is **removed**. CONTEXTFORCD §5.8 already flags this as in-flight — this design commits to it. Impact: token issuance/rotation endpoints, `ShareLinkCell`, candidate schema `token`.
2. **`⚠️ contract-change:` phone gate = primary identity, not just a block.** `participant-phone-gate.tsx` becomes the entry step for the shared link: last-6-digits → match candidate → render their schedule. Impact: public route resolves candidate by (project, phone-suffix) instead of token; collision handling for duplicate suffixes needed (writer decision).
3. **`⚠️ contract-change:` announcement vs chat treatment in ADMIN.** Legacy admin rendered announcements and chat as identical bubbles (CONTEXTFORCD §6.2). Redesign gives announcements a **banner** treatment in admin too (participant already had it). No data change — but confirm `is_announcement` is available admin-side to branch render.
4. **Reach sub-picker reveal.** All=no target · Group=`batch_id` Select · Individual=`candidate_id` Select (default = open thread). Maps to the existing 1-POST scope logic (CONTEXTFORCD §5.6) — confirm no payload change, only UI reveal.
5. **Slot title free-text** shown on participant schedule + calendar block label — confirm `slots.title` is persisted & returned to participant view.
6. **Toast layer (new).** Legacy had only a flash `p` + `window.confirm/alert` (§4, §6.6). Redesign adds a toast system — writer decides the mechanism (this is a new cross-cutting UI concern).

## §6 Open items
- Duplicate phone-suffix collision UX (see §5.2) — needs writer/product decision.
- Master-link revocation / per-project rotation UX (replaces per-token rotate).
- Group-head tint mapping (sky/mint/neutral) vs a systematic batch-color scheme.
- Calendar: PX_PER_MIN in redesign = 80px/hour (was 0.8·56). Confirm density acceptable vs legacy.
