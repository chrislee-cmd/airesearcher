# Handoff: Recruiting Widget (V2)

## What this is
The **Recruiting** widget for the research canvas — a card that turns an uploaded RFP/brief into a screening pipeline: extract participant criteria → review/approve → generate a screening survey → review/approve → auto-publish a Google Form + linked Sheet. It shares the exact same frame/shell as Probing, Interpreter, Transcript, AI UT, Desk (the "V2 unified widget" shell).

## Source of truth
**`Widgets Canvas 1c.dc.html` is the ONLY authoritative source** (renders standalone in a browser via `support.js`). This bundle is a design reference — recreate it in the target codebase using its component patterns, then bind to real data. Reproduce colors/type/spacing/radii/shadows pixel-accurately.

The Recruiting row in that file is `FILL = '#ffe8a8'` and appears with all its state columns.

> Older files `Widget Frames.dc.html` / `Widget Fullviews.dc.html` are **DEPRECATED** (tall header band, `전체보기▾` text toolbar). Do not reference them. A tall solid header or a text `전체보기` toolbar = built from the wrong spec.

---

## Shared shell (build once — `WidgetShell`)
Do NOT rebind these to the app's generic design-system tokens (top source of drift).

- **Card frame:** border `3px solid #1d1b20`; border-radius **`20px`** (dedicated token, never a generic 14px); background `#fff`; box-shadow `4px 4px 0 #1d1b20`; `overflow:hidden; display:flex; flex-direction:column`.
- **Outer W×H:** container-owned (prototype fixes `604×900`; responsive in real canvas). Everything else above/below is absolute regardless of size.
- **Header band:** background = widget pastel `#ffe8a8`; border-bottom `2px solid #1d1b20`; padding `18px 22px`; row, space-between. Title `Outfit` 800, `29px`, letter-spacing `-0.9px`, `#1d1b20`.
- **Toolbar pill** (right of header) — single rounded pill, `border:1.5px solid #1d1b20; border-radius:10px; background:#fff; box-shadow:2px 2px 0 #1d1b20; overflow:hidden`, segments split by `1.5px #1d1b20` dividers:
  1. credit — `💎 10` (mono `11px/700`)
  2. status — `7px` dot + label (mono `10.5px/700`, `1px` tracking): `● READY` (dot `#16a34a`), `EXTRACT`/`PUBLISH` accent, `Done` green
  3. palette icon (change color) `15px`
  4. expand/fullview icon (two diagonal arrows) `15px`
- **Footer:** padding `15px 22px`; border-top `1px solid rgba(29,27,32,.08)`; row space-between. Left footnote mono `11px #8a8693`. Right **CTA pill**: `border-radius:999px; padding:11px 20px; 700; 13.5px; border:1.4px solid; box-shadow:2px 2px 0 rgba(29,27,32,.15)`. Enabled = bg `#1d1b20`/white; disabled = bg `#eceef1`/`#8a8693`/border `rgba(29,27,32,.10)`. Recruiting CTA label = **`Publish form →`** (disabled until both approvals done).

## Step rail (shared)
- Container `padding:22px 24px; height:100%`; `2px` vertical line at `left:12px`, `rgba(29,27,32,.12)`, full height.
- **Active node** = `26px` ink circle, white number `800`, at `left:-38px`.
- **Completed node** = `26px` green `#16a34a` circle, white `✓`.
- **Review node** (awaiting approval) = `26px` circle with `2px` amore ring `#ff5c8a`, amore number.
- **Dim/todo node** = `26px` circle `rgba(29,27,32,.06)` fill, muted number `#a3a7ad`.
- Step title `14.5px/800 #1d1b20`, `margin-bottom:11px`. Open steps `margin-bottom:26px`.

---

## Recruiting states (each is a column in the SSOT — build all as static states)

| # | State | Node badges | CTA |
|---|---|---|---|
| 0 | **All Open** | all 4 steps expanded (1 active, 4 dim) | `Publish form →` disabled |
| 0b | **Empty · All Open** | steps expanded, no data yet | `Publish form →` disabled |
| 1 | **Extracting criteria** | ①=summary ✓ · ②=active spinner · 3,4 todo | disabled |
| 2 | **Review criteria** | ①✓ · ②=amore review ring · 3,4 todo | disabled |
| 3 | **Review survey** | ①✓ · ②=APPROVED · ③=amore review ring · 4 todo | disabled |
| 4 | **Publishing** | ①✓ · ②✓ · ③✓ · ④=auto-publish progress | disabled |
| 5 | **Published** | handoff card | `View responses →` enabled |

### Step content
**Step 1 — Upload the source material (RFP · brief · email)**
- Paste box (pill textarea, `border:1.5px solid #1d1b20; border-radius:22px`, placeholder "Paste an RFP, brief, or recruiting email…").
- Dashed dropzone `1.4px dashed rgba(29,27,32,.18)`, radius 14, upload glyph + "Drag & drop or click to upload" + mono sub "pdf · docx · xlsx · csv · txt · up to 10".
- **Empty state only:** a right-aligned disabled primary button **`Extract criteria →`** (bg `#eceef1`, text `#a3a7ad`; enabled = bg `#ff5c8a`/white, shadow `2px 2px 0 rgba(255,92,138,.28)`). Enables once a source is present.

**Step 2 — Review the participant criteria**
- **Criteria chips** (`critWrap`): rounded `999px`; caption (mono `9px` uppercase `#8a8693`) + label (`600 #1d1b20`) + optional `Required` (amore `700`); border `1.4px solid #ff5c8a` when required else `rgba(29,27,32,.14)`. Sample: `Demographics · Age 25–34 · Required`, `Occupation · Office worker · Required`, `Experience · Shops online 3×/wk`, `Lifestyle · Values smart spending`.
- **Extracting state:** replace chips with a **GeneratingRow** — `1.6px solid rgba(255,92,138,.35)` border, bg `#fff7fa`, amore spinner (`rcspin .8s linear infinite`), "Extracting criteria from your source…" + "8 criteria found so far".
- **Review state:** review note ("12 criteria extracted…") + chips + **ReviewBar**: ghost buttons `Preview · Edit · Restart` (`1.4px solid rgba(29,27,32,.16)` pill, `#5b5965`) pushed left, amore **`✓ Approve criteria`** pill on the right.
- **Empty state:** EmptyDash "Criteria appear here after you upload a source".

**Step 3 — Review the screening survey**
- **Survey sections** (`surveyWrap`, column gap 8): each row = title + sub. Locked rows (Privacy consent, Personal info) get faint `#faf6ea` fill + `🔒 Standard` badge; editable row (Screening questions · 8 questions · editable) is white.
- **Review state:** review note ("4 sections · 18 questions generated…") + sections + ReviewBar ghosts `Preview · Regenerate` + amore **`✓ Approve survey`**.
- **Empty/todo:** EmptyDash "generated after criteria are approved" / dim todo.

**Step 4 — Publish to a Google Form**
- Info row (`#f7f7f5`, `1.4px solid rgba(29,27,32,.10)`, radius 12): link icon + "Creates a Google Form + linked Sheet, shared with anyone-with-link."
- **Publishing state:** GeneratingRow "Creating the Google Form…" + three **pubLine** rows: `Google Form created` (done ✓ green), `Linking response Sheet…` (active amore), `Share · anyone-with-link` (pending, hollow).

**State 5 — Published:** Handoff card — title "Please check the full view", body "The Google Form is published and collecting responses. Filter respondents and request invites in the full view." CTA becomes `View responses →`.

---

## Approval flow (behavior notes — implement as real logic)
1. Upload source → **Extract criteria** (LLM) → criteria list.
2. User reviews criteria; can Preview / Edit / Restart. **Approve criteria** gates step 3.
3. Approving criteria triggers **survey generation** (LLM). User reviews; Preview / Regenerate. Standard blocks (privacy, personal info) are locked; only domain screening questions editable. **Approve survey** gates step 4.
4. Both approved → **auto-publish** Google Form + linked Sheet (anyone-with-link).
5. Published → handoff to full view for responses/invites.

CTA `Publish form →` stays disabled until criteria AND survey are both approved.

## Tokens
- ink `#1d1b20`; accent/amore `#ff5c8a` (required chips, selected, approve, spinner); success `#16a34a` (done nodes, ready dot); glow `rgba(255,92,138,.16/.28)`.
- muted `#5b5965` / `#8a8693` / placeholder `#a3a7ad`.
- surfaces: card `#fff`; subtle `#f7f7f5`; locked-row `#faf6ea`; disabled `#eceef1`; generating bg `#fff7fa`.
- header pastel `#ffe8a8`.
- radii: card 20, method/step boxes 12–14, field/pill 22, chip/CTA/button 999.
- shadows: card `4px 4px 0 #1d1b20`; toolbar/CTA `2px 2px 0`; approve `2px 2px 0 rgba(255,92,138,.28)`.
- type: `Outfit` 800 headers; mono labels `ui-monospace, Menlo, monospace`.
- keyframe: `@keyframes rcspin { to { transform: rotate(360deg) } }`.

## Icons
`Icon System.dc.html` — `document`, `target`, `link`, `search`, `typos`, `polish`, `minutes`, etc. All `24×24`, `stroke-width:2`, round caps, `#1d1b20`; duotone mode tints interior with the pastel.

## Files in this bundle
- `Widgets Canvas 1c.dc.html` — ⭐ SSOT (Recruiting row = all 7 states; also the other 5 widgets for shell reference).
- `Icon System.dc.html` — icon reference.
- `support.js` — design-runtime (not for production).

## Verification (advised)
Gate with a **screenshot diff of the built widget vs the Recruiting column in `Widgets Canvas 1c.dc.html`** at each state, rather than eyeballing — catches frame/color/type drift in one pass.
