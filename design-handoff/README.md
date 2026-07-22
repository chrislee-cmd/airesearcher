# Handoff: Research Canvas — Widget Setup System

## Overview
Six "widgets" that live on a research canvas. Each widget is a self-contained card that walks the user through a short **setup flow** (steps 1–4) and then transitions through runtime **states** (Open / Started·Live / Done / Collapsed). The six widgets:

| Widget | Purpose | Credit | Pastel |
|---|---|---|---|
| Probing Assistant | Real-time interview probing | 💎 25 | `#cfe6ff` |
| Live Interpreter | Real-time simultaneous interpretation | 💎 50 | `#cdebd9` |
| Transcript Generator | Audio → transcription · analysis | 💎 25 | `#e7defe` |
| AI UT (PREVIEW) | AI remote usability testing | PREVIEW | `#ffd9be` |
| Recruiting (PREVIEW) | Screener pipeline · participant recruiting | 💎 10 | `#ffe8a8` |
| Desk Research | Automated web · stats · filings research | 💎 75 | `#bfe9ef` |

The whole point of the system is that **all six widgets share ONE frame/shell** and differ only in (a) header pastel + credit, and (b) the body content of each setup step.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy line-for-line. The task is to **recreate these designs in the target codebase's environment** (React/Vue/etc.) using its established component patterns, then bind them to real data/behavior. If no environment exists yet, pick the most appropriate framework and implement there.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, shadows, and interaction states are final. Recreate pixel-accurately, with the one container exception noted in "Frame spec" below.

## ⭐ Single Source of Truth
**`Widgets Canvas 1c.dc.html` is the ONLY authoritative source for all six widgets.** It renders standalone in a browser (via `support.js`). Every widget's frame, header, toolbar, footer, step rail, and per-step body is defined there.

`Widget Frames.dc.html` and `Widget Fullviews.dc.html` are **DEPRECATED** (older frame spec — tall header band, `전체보기▾` toolbar). They carry a red DEPRECATED banner. **Do not reference them for implementation.** If a rendered widget shows a tall solid header band or a text `전체보기` toolbar, it was built from the deprecated spec and is wrong.

---

## Frame spec (the shared shell — build ONCE, reuse for all 6)

Implement a single `WidgetShell` component. Do **not** re-derive these values from the app's generic design-system tokens (this is the #1 source of drift — e.g. binding radius to a generic `radius-sm`).

**Card frame** — ABSOLUTE, must match exactly:
- border: `3px solid #1d1b20`
- border-radius: **`20px`** (dedicated `--widget-card-radius`; never fall back to a generic small radius like 14px)
- background: `#fff`
- box-shadow: `4px 4px 0 #1d1b20`
- `overflow: hidden; display:flex; flex-direction:column`

**Outer width × height** — CONTAINER-OWNED (the one non-absolute value): the prototype fixes each card at `604 × 900`. In the real canvas these adapt to the grid cell — responsive width/height is fine, but **radius/border/shadow/header/type above stay absolute regardless of size.**

**Header band:**
- background: the widget's pastel (dedicated `--widget-header-<tone>`; NOT the generic banner yellow `#ffd53d`)
- border-bottom: `2px solid #1d1b20`
- padding: `18px 22px`; flex row, space-between, `gap:12px`
- Title: font `Outfit`, weight `800`, size `29px`, letter-spacing `-0.9px`, color `#1d1b20`
- Right side = **compact icon toolbar pill** (see below)

**Toolbar pill** (right of header) — a single rounded-rect pill, NOT a `전체보기▾` text control:
- container: `border:1.5px solid #1d1b20; border-radius:10px; background:#fff; box-shadow:2px 2px 0 #1d1b20; overflow:hidden`; segments separated by `1.5px` `#1d1b20` vertical dividers
- Segment 1 — credit: 💎 diamond glyph + number, mono `11px` weight `700` (e.g. `💎 25`)
- Segment 2 — status: a `7px` dot + label, mono `10.5px` weight `700` letter-spacing `1px` (e.g. `● READY`, dot `#16a34a`; `LIVE` uses accent `#ff5c8a`; `Done` uses `#16a34a`)
- Segment 3 — palette icon (change color), `15px` stroke icon, `padding:6px 10px`, cursor pointer
- Segment 4 — expand/fullview icon (two diagonal arrows: `M9 4H4v5 / M4 4l6 6 / M15 20h5v-5 / M20 20l-6-6`), `15px`, cursor pointer

**Footer:**
- padding: `15px 22px`; border-top: `1px solid rgba(29,27,32,.08)`; background `#fff`; flex row space-between
- Left: footnote, mono `11px`, color `#8a8693`
- Right: **CTA pill** — `border-radius:999px; padding:11px 20px; font-weight:700; font-size:13.5px; border:1.4px solid; box-shadow:2px 2px 0 rgba(29,27,32,.15)`; icon + text.
  - Active/enabled: background `#1d1b20`, color `#fff`, border `#1d1b20`
  - Disabled: background `#eceef1`, color `#8a8693`, border `rgba(29,27,32,.10)`

---

## The step rail (setup body)

Each widget's setup is a **vertical rail** of 4 steps:
- Rail container: `padding:22px 24px; height:100%`. A `2px` vertical line at `left:12px`, color `rgba(29,27,32,.12)`, runs top→bottom.
- **Active/open step node**: `26px` circle, background `#1d1b20`, white number, weight `800`, positioned `left:-38px` from the content column.
- **Completed step node** (collapsed/summary state): `26px` green circle `#16a34a` with white `✓`.
- **Step title**: `14.5px`, weight `800`, color `#1d1b20`, `margin-bottom:11px`.
- Open steps are stacked with `margin-bottom:26px`; each shows its full body. Collapsed/"All Collapsed" state replaces bodies with one-line **SummaryStep** rows: small label (`STEP 01 · Project`, `11px #5b5965`) + value (`13.5px` weight 700) + a `Change` link (`12px #8a8693`) on the right.

### Shared body primitives
- **Field** (dropdown/select): `border:1.5px solid #1d1b20; border-radius:22px` (use `24px` variant where noted); `padding:12px 16px; font-size:13.5px`; placeholder color `#8a8693`, chosen value `#1d1b20` weight 700; trailing `▼` glyph.
- **Method Card** (choice tile in a Grid): `border-radius:13px; padding:13px 11px`. Unselected border `1.4px solid rgba(29,27,32,.14)`. Selected border `2px solid #ff5c8a` + shadow `0 4px 12px rgba(255,92,138,.16)` + a top-right `18px` pink check badge. Contents: duotone icon (in a `38px` tile), title `12.5px/700`, up to 2 sub-lines `9.5px #5b5965`.
- **Grid**: `display:grid; grid-template-columns:repeat(N,1fr); gap:11px` (N=2 or 3).
- **MiniLabel**: mono `10px`, letter-spacing `.3px`, color `#8a8693`, weight 600, `margin-bottom:6px`.
- **AddRow**: pill input (`border-radius:22px`) + pink `＋ Add` button (`background:#ff5c8a; color:#fff; border-radius:22px`).
- **Chips**: rounded `999px`. Criteria chip = category caption (mono `9px` uppercase `#8a8693`) + label (`600 #1d1b20`) + optional `Required` (`#ff5c8a` weight 700); border `1.4px solid #ff5c8a` when required, else `rgba(29,27,32,.14)`.
- **EmptyDash**: dashed placeholder box `1.4px dashed rgba(29,27,32,.18)`, radius 14, mono text `#a3a7ad`.

---

## Per-widget setup content

### Probing Assistant (`#cfe6ff`, 💎25) — CTA `Start session →`
1. **Select the project you are working on** — Field "Select a project"
2. **Select the interview method** — 3-card Grid:
   - Offline interview → Host → Mic / Guest → Mic
   - Online interview → Host → Mic / Guest → Tab audio
   - Online (observe) → Host → Tab audio / Guest → Tab audio
3. **Which language do you want for analysis?** — MiniLabel "Interview language" + Field "Select" (radius 24)
4. **Inject the questions you must ask** — AddRow "Type a must-ask question and press Enter" + EmptyDash "No questions injected yet"
- Collapsed summary values: `test 5-2` / `Online interview` / `Korean` / `3 questions injected`

### Live Interpreter (`#cdebd9`, 💎50) — CTA `Start interpreting →`
1. Select the project — Field
2. Select the interview method — same 3-card Grid as Probing (default Offline)
3. **Set the interpretation languages** — two Fields side by side with a `→` between: Input language (e.g. Korean) → Output language (e.g. English). *Note: languages are NOT just KO/EN — the selector must support a large language list; treat these as a dropdown of many options.*
4. **Add proper nouns & keywords (optional)** — AddRow + example chips (`Amorepacific ✕`, `Sulwhasoo ✕`)
- Live state: caption stream — HOST(source) line, `→` translated line with a left accent bar `3px #ff5c8a`, GUEST line, `→` translated line; header shows lang pair pill + running timer.

### Transcript Generator (`#e7defe`, 💎25) — CTA `Start transcription →`
1. Select the project — Field
2. **Select the transcription method** — 2-card Grid: Qualitative interview transcription (1:1, speaker separation) / Meeting minutes transcription (multi-party, summary)
3. **Which language do you want for analysis?** — MiniLabel "Source audio language" + Field
4. **Upload or record the audio** — dashed upload zone (`mp3·m4a·wav·mp4·txt·docx`) + "— or —" + "Record with mic" button
- Started state: a 6-stage progress flow (Upload → Transcribe → Document → Speakers → Typos → Polish), each row with a node (done `✓` green / active `●` purple `#8b5cf6` / pending), header "Generating transcript… N/6".
- Done state: big `✓` badge + "Transcript is ready!" + `View results →`.

### AI UT (`#ffd9be`, PREVIEW) — CTA `Create session · issue link`
1. Select the project — Field
2. **Select the test method** — 2-card Grid: Test on my device / Test on participant device (issue a link)
3. **Select the expected language** — MiniLabel "Participant language (required)" + Field
4. **Enter the target and task** — MiniLabel "Target URL" + pill input `https://example.com`; MiniLabel "Participant task" + textarea-style box
- Share state: "Session created", participant link field + Copy, waiting-for-participant dashed area.

### Recruiting (`#ffe8a8`, 💎10) — CTA `Publish form →`
1. **Upload the source material (RFP · brief · email)** — paste box + dashed upload (`pdf·docx·xlsx·csv·txt · up to 10`)
2. **Review the participant criteria** — wrap of criteria chips: `Demographics: Age 25–34 (Required)`, `Occupation: Office worker (Required)`, `Experience: Shops online 3×/wk`, `Lifestyle: Values smart spending`
3. **Review the screening survey** — rows: Privacy consent (🔒 Standard) / Screening questions (8 questions · editable) / Personal info (🔒 Standard). Locked rows have a faint `#faf6ea` fill + a `🔒 Standard` badge; editable rows are white.
4. **Publish to a Google Form** — info row "Creates a Google Form + linked Sheet, shared with anyone-with-link."
- Published state: handoff card "Please check the full view" + `View responses →`.

### Desk Research (`#bfe9ef`, 💎75) — CTA `Search →`
1. Select the project — Field
2. **Enter topics · keywords** — AddRow + removable keyword chips (`checkout UX`, `cart abandonment`, `shipping cost`)
3. **Choose the research purpose** — 2-card Grid: Trend research / Market research
4. **Set the scope** — Search region + Period Fields, plus an info line estimating searches (`3 keywords × 8 sources × 2 regions ≈ 48 searches`)
- Started state: handoff card "Please check the full view".

---

## Runtime states (columns in the SSOT)
Each widget row in `Widgets Canvas 1c.dc.html` shows 3–4 state columns:
- **All Open** — every step expanded, CTA disabled until requirements met (badge `SETUP`, status `● READY`).
- **Started / Live / Waiting** — after the CTA fires; body becomes a live/progress/handoff view (badge `START`/`LIVE`/`WAIT`, accent status dot `#ff5c8a`, CTA becomes `End…`/`Stop`/`Cancel`).
- **Done** (Transcript only) — completion view (status `Done` green).
- **All Collapsed** — steps become one-line summaries with `Change` links; CTA enabled.

## Browser Share Guide Popup
For Online / Online-observe methods (no native app), a 2-step modal appears on Start: (1) "Join via your browser" — never the native app or audio won't record; (2) "Also share system audio" toggle ON — required for participant audio. Screenshots: `assets/zoom-browser-join.png`, `assets/share-audio-on3.png`. Modal: white card `border:2.5px solid #1d1b20; border-radius:18px; box-shadow:6px 6px 0 #1d1b20` over a `rgba(29,27,32,.34)` scrim.

## Design Tokens
- **Ink / primary:** `#1d1b20`
- **Accent (pink / "amore"):** `#ff5c8a` — required chips, selected cards, live status, `＋ Add`. Selected-card glow `rgba(255,92,138,.16)`.
- **Success green:** `#16a34a` (ready dot, done nodes/badges)
- **Purple (transcript progress active):** `#8b5cf6`
- **Muted text:** `#5b5965` (secondary), `#8a8693` (tertiary), `#a3a7ad` (placeholder)
- **Surfaces:** card `#fff`; subtle fill `#f7f7f5`; locked-row fill `#faf6ea`; disabled CTA `#eceef1`
- **Header pastels:** see table at top
- **Radii:** card `20`, modal `18`, method card/step boxes `12–14`, Field/AddRow pill `22–24`, chip/CTA `999`
- **Shadows:** card `4px 4px 0 #1d1b20`; toolbar/CTA `2px 2px 0` (ink or `rgba(29,27,32,.15)`); modal `6px 6px 0 #1d1b20`
- **Type:** headers `Outfit` 800 (29px title, -0.9px tracking); mono labels `ui-monospace, Menlo, monospace`; body sans.
- **Border widths:** card 3px, header divider 2px, toolbar/most controls 1.4–1.5px.

## Icons
See `Icon System.dc.html` for the full stroke-icon set (project, mic, minutes, host, guest, offline, online, observe, upload, transcribe, document, speakers, typos, polish, link, waiting, start, stop, audio, fullview, trend, market, search, diamond, language, questions, keywords, target). All are `24×24` viewBox, `stroke-width:2`, round caps/joins, drawn in `#1d1b20`. A "duotone" fill mode tints interior with the active pastel; a "tile" mode wraps the icon in a bordered chip with `1.5px 1.5px 0` shadow.

## Files in this bundle
- `Widgets Canvas 1c.dc.html` — ⭐ SSOT: all 6 widgets × all states + share popups. Open directly in a browser.
- `Icon System.dc.html` — icon reference.
- `support.js` — runtime that renders the `.dc.html` files (design-tooling only; not for production).
- `assets/zoom-browser-join.png`, `assets/share-audio-on3.png` — share-guide screenshots.

## Recommended verification (strongly advised)
Because the SSOT renders standalone, gate the implementation with a **visual diff against `Widgets Canvas 1c.dc.html`** (e.g. Playwright screenshot of the built widget vs. the corresponding SSOT card at the same state) rather than eyeballing. This catches frame/color/type drift in one pass instead of many review cycles. A secondary code audit ("which token did each frame value bind to?") explains any diff the visual check flags.
