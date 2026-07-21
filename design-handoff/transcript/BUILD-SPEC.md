# Transcript Generator — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation; worker owns logic/data/wiring. Spec + `.dc.html` = mechanical TSX port.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (result view). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `../CONTEXT-PACK.md` · `../tokens.json`.
> **Identity:** pastel header `lav` (#e7defe) · accent `amore` (#ff5c8a) · progress accent `#8b5cf6` · credit 💎 25.

---

## §1 Class mapping (Conformance-first)
> Card shell / header / toolbar / step node / rail / field / CTA rows = **identical to Probing §1**. Transcript-specific rows below.

| Element | Measured (proto) | Utility class / token |
|---|---|---|
| Header band | bg pastel-lav · border-b 2px ink | `bg-widget-header-lav`* · `border-b-2 border-ink` |
| Method card (2-col) | radius 13 · sel border 2 amore + soft glow | `rounded-sm` · `border-amore` + **proposed:shadow-card-selected** |
| Upload dropzone | border 1.6 dashed ink/22% · radius 14 · bg #f7f7f5 | `rounded-sm border-dashed border-line bg-surface-elevated` |
| Record button | border 1.4 ink/16% · radius 22 | `rounded-pill border-line` |
| — StageFlow (started) — | | |
| Stage rail | vertical · left 13 · 2px ink/12% | `bg-ink/10` |
| Stage node (done) | 26·circle · success ✓ | `bg-success text-white` |
| Stage node (active) | 26·circle · `#8b5cf6` ● | **proposed:signal-progress** |
| Stage node (todo) | 26·circle · ink/6% | `bg-ink/5` |
| Stage row (active) | border 2px `#8b5cf6` · bg `#f6f2ff` · radius 12 | **proposed:signal-progress + surface-progress-tint** |
| Header progress dot | 8·circle `#8b5cf6` + `N / 6` mono | **proposed:signal-progress** |
| — Done hero — | | |
| Done icon box | 64·radius 16 · border 2 ink · shadow `3px3px0 #16a34a` · bg #f4fbf6 | `rounded-md border-ink` + **proposed:shadow-success-memphis** |
| — Result fullview — | | |
| Modal shell | border 3 ink · radius 14 · shadow 10px10px0 | `rounded-lg border-ink shadow-memphis-lg` |
| Transcript turn avatar | 34·circle · moderator=sky / participant=amore · border 2 ink | `rounded-full border-ink` |
| Toolbar search pill | bg #f7f7f5 · radius 999 | `bg-surface-elevated rounded-pill` |
| Export button | border 1.5 ink · radius 12 · shadow 2px2px0 | `rounded-chrome border-ink shadow-memphis-xs` |
| AI summary card | bg #f6f2ff · border ink/12% · radius 14 | **proposed:surface-ai** |
| Back button (detail toolbar) | 36·circle · border 1.5 ink · shadow 2px2px0 · `‹` | `rounded-full border-ink shadow-memphis-xs` |

## §2 proposed-token
- `surface-widget-header-lav` (lav band). Fallback: `surface-banner`.
- `signal-progress` (`#8b5cf6` stage accent). Fallback: `text-info`.
- `surface-progress-tint` (`#f6f2ff` active stage row / AI summary bg → also `surface-ai`).
- `shadow-success-memphis` (`3px3px0 #16a34a` done hero). Fallback: `shadow-memphis-sm`(success).
- `surface-disabled`, `shadow-card-selected` — shared w/ Probing.

## §3 State matrix (cover ALL)
Setup card:
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps. footNote `Prepare the audio to transcribe` · CTA idle `▶ Start transcription →` |
| **collapsed** | empty-area click | 4 summary rows (Project / Transcription method / Analysis language / Audio input) |
| **ready** | project ∧ method ∧ language ∧ audio-input | CTA active |
| **started** | CTA click | in-place **6-stage StageFlow** (Upload→Transcribe→Document→Speakers→Typos→Polish; node 3-states) · footNote `Transcribing…` · CTA `■ Stop transcription` |
| **done** | stages complete | **done hero** ("Transcript is ready!") · footNote `Done` · CTA `View results →` |
| **error** *(add)* | transcription fail / bad file | `Banner` warning `transcribeError` + retry; CTA idle |
| **empty** *(add)* | no file/recording chosen | STEP4 shows dropzone + record, neither selected → CTA stays idle |
| **disabled** *(add)* | credits exhausted | CTA `surface-disabled` |

Setup steps:
1. `Select the project you are working on` — shared ProjectPicker.
2. `Select the transcription method` — **2 cards**: `Qualitative interview transcription`(1:1 · speaker separation) · `Meeting minutes transcription`(multi-party · summary).
3. `Which language do you want for analysis?` — single `Source audio language` dropdown.
4. `Upload or record the audio to transcribe` — dropzone (`mp3 · m4a · wav · mp4 · txt · docx`) **or** record-with-mic; either selection completes.

Result fullview (`Widget Fullviews` · Transcript) — **two-level**:
- **File list** (entry): transcript files of selected project (name · duration · speakers · date · status). Done = clickable; Transcribing = dimmed, non-clickable.
- **Detail** (on file click): 2-split — left transcript stream (speaker turns; toolbar w/ **back `‹` left of search**, By-speaker / Timestamp toggle) + right sidebar (Export .docx/.txt/.srt · AI summary · Key themes). Widget-switch resets to list.

## §4 Interaction disclaimer
Proto interactions (picker, step collapse, file open, back, StageFlow demo index=3) are demo-only. Real transcription pipeline, stage progression, search, and speaker/timestamp toggles are worker-owned. StageFlow uses **timed reveal** (each stage held ≥5s) — a UI affordance, not real phase timing.

## §5 contract-change (⚠️ surface only; writer resolves as delta)
- ⚠️ `contract-change:` **6-stage progress feed** (Upload/Transcribe/Document/Speakers/Typos/Polish) — confirm phase enum + per-phase status the UI maps to.
- ⚠️ `contract-change:` **file-list per project** (name · duration · speakerCount · date · status) — confirm list shape + statuses (done/processing/failed).
- ⚠️ `contract-change:` **speaker-separated transcript** turns `{ speaker, role, time, text }` — confirm shape.
- ⚠️ `contract-change:` **AI summary + key themes** (theme + count) — model output, confirm.
- ⚠️ `contract-change:` **export formats** .docx/.txt/.srt — confirm generation pipeline.

## §6 Open items
- Credit 25 confirm. · StageFlow timed-reveal duration source. · Search / By-speaker / Timestamp real behavior. · i18n ko/en/ja/th parity.
