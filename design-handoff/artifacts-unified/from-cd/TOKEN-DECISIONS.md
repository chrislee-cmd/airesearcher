# TOKEN DECISIONS — tokens.json 1.x → 2.0

> **Authored by Claude Design, 2026-07-28.** CD is SSOT for design values. `globals.css` is reconciled **to** this file, not the other way around.
> Read with `tokens.json` (2.0.0) in this folder. Every change below was already true of shipped comps — 2.0 makes the token set able to *say* what the design already does.

## Why this file exists
The 1.x token set was a snapshot extracted from `globals.css` on 2026-07-20. Six widget bundles have shipped since. Auditing the three new artifact surfaces against 1.x surfaced three classes of gap:

1. **Values that disagree** with what every shipped comp uses (peach, sun, shadow colour).
2. **Families the design needs that 1.x does not have at all** (error, processing, amber, aqua, neutral canvas).
3. **Scales too coarse to express the components** (radius, print type) — which is why comps were full of arbitrary values.

Left unreconciled, each gap becomes fidelity drift at implementation time: the worker either invents a value or snaps to a near-miss token. Both have already happened.

---

## A · Conflicts resolved (CD decision)

### A1 · `pastel.peach` `#ffd9c9` → **`#ffd9be`**
Every shipped comp that carries the AI UT identity uses `#ffd9be` — widget card, fullview header, sidebar dot, library tile, journey map. The CD brief for this work also specified `#ffd9be`. One stale snapshot value versus six consistent surfaces: **the snapshot is wrong.**

### A2 · `pastel.sun` `#fff1b6` → **`#ffe8a8`**
Same situation for Recruiting. `#fff1b6` is materially paler; the Recruiting header band and the journey funnel tabs both depend on `#ffe8a8` holding its own against a white body. **Snapshot corrected.**

> A1/A2 are a **one-line change in `globals.css`** and a **no-op in every comp**. If any production component was built against the pale values it will shift slightly warmer/deeper — that is the intended correction, not a regression.

### A3 · Memphis shadow colour `#000` → **`var(--color-ink)` `#1d1b20`**
1.x defined `memphis-sm/md/lg` with `#000` but `memphis-2xl` with `var(--color-ink)` — internally inconsistent. Every comp uses ink. Pure black next to ink text reads as a second, colder ink and makes the offset look detached rather than drawn. **The whole family is now ink.**

### A4 · Desk Research tone: `cyan` → **`aqua`** `#bfe9ef`
The tone was missing from the 1.x pastel set entirely, so it acquired two names in flight (`widget-header-cyan` in the fullview bundle, `aqua` in the artifacts brief). **`aqua` wins** — it is the brief's word and it sits naturally beside mint. `cyan` is dead; treat any occurrence as this token.

---

## B · Families added (were `proposed-token`, now promoted)

| Family | Why 1.x could not express it |
|---|---|
| **`signal.error*`** (`#ef4444` · text `#b4443f` · bg `#fdf0f0` · line `#f0c0c0`) | 1.x signal had success + warning only. The 4-state deliverable status vocabulary (`draft`/`processing`/`ready`/`error`) is **required by the data contract** — error had nowhere to live. Warning is an alert about something; error is a state something is in. They cannot share a colour. |
| **`signal.processing`** + `lav-line` / `lav-text` / `lav-bg` | `pastel.lav` existed as a header wash with no text or border value to pair with it, so every processing pill invented its own. |
| **`signal.amber*`** (`#e0a83a` + text/line) | Distinct from `warning` `#fb923c`: amber marks a *state* (spotlight urgency, medium confidence, partial fill), warning marks an *alert*. Collapsing them makes "this is 2-of-3 filled" look like "something is wrong". |
| **`surface.canvas`** `#fbfbf9` | The only 1.x canvas surface is the yellow `#fffce1`, which is correct for the canvas shell and wrong everywhere else. A document or a library on yellow is unreadable. |
| **`surface.disabled`** `#eceef1` | Needed so disabled controls can be expressed as *a different surface* rather than a dimmed wrapper. Wrapper opacity fails contrast on the label — this token is the a11y-correct alternative. |
| **`text.faint` / `text.disabled`** | The ramp stopped at `mute-soft`, which is already AA-borderline; mono captions and estimated values needed steps below it that are explicitly *not* body copy. |
| **`pastel_tint.*`** | Section-head washes inside reports. Distinct from `pastel.*`, which is reserved for feature identity — using a header tone as a section tint would claim identity it does not have. |
| **`accent.amore-deep`** `#c2334f` | Destructive and total-emphasis need a darker crimson than `amore`; `amore` at small text sizes on white is borderline. |
| **`accent-violet` / `accent-blue`** | Transcript progress accent and moderator-speaker naming. |
| **`shadow.frame` · `*-faint` · `*-success/amber/error/crimson` · `modal-amber` · `tile-lift`** | 1.x had amore and warning coloured shadows only. `tile-lift` is deliberately the **single soft shadow** in the system — video tiles read as physical objects; everything else stays hard-offset. |
| **`shadow.focus-ring`** | 1.x had no focus treatment at all. Not optional: without it, keyboard users get no affordance on any of these surfaces. |

---

## C · Scales extended

### C1 · Radius — 1.x was `2 / 4 / 14 / 24 / 999`
Seven values sat between those steps in shipped comps, all as arbitrary `rounded-[Npx]`. They are not noise; they are a consistent nesting rhythm (nav 8 → icon 9 → control 10 → card 11 → panel 12 → frame 14/16 → field 22). Promoting them makes the arbitrary values disappear and lets a diff catch a wrong one.

**Do not** snap existing comps to the old coarse scale — a 22px field re-rendered at 24px breaks its pairing with the adjacent pill button.

### C2 · Print type family — ADDED
Exported documents are read at paper distance and must clear a **12pt floor**. The screen scale tops out at `text-display 32` with body at `12.5`; on paper `12.5px` is roughly 9.4pt and fails. `text-print-body 16/1.65` is the floor, not a preference.

### C3 · `font.mono` — the blanket ban is lifted, narrowly
1.x said `_no_mono_default: production body is NOT monospace`. That rule is right and stays. But every shipped surface uses mono for **timestamps, IDs, counts, tiers, table heads, page numbers, eyebrow captions** — data whose alignment carries meaning. 2.0 keeps the ban on body and headings and names the permitted use as `font-mono-label`. This closes an open item that had been outstanding since the fullview handoff.

---

## D · What the worker must do with this file

1. **Reconcile `globals.css` to `tokens.json` 2.0** — A1–A4 are edits to existing declarations; B and C are additions.
2. **Delete the arbitrary values** these tokens replace. A grep for `rounded-\[`, `shadow-\[`, and raw hex in the artifact surfaces should come back empty afterwards.
3. **Do not re-derive tokens from the codebase.** If an implemented component disagrees with this file, the component is wrong. Raise it rather than snapping the token back.
4. **New value needed?** Label it `proposed-token:<name>` in the PR and route it to CD. Do not add it to `globals.css` directly — that is how the two sources split apart last time.

## E · Still open (not a CD decision)
- `surface-banner` `#ffd53d` and `surface-accent` `#fffce1` remain canvas-shell-only. Whether the canvas keeps yellow at all is a **brand** decision, not a token one.
- `chart.am/pm-accent` are untouched — no artifact surface uses data-viz yet.
- `rose` is now the only unassigned pastel. It is the next feature's identity; do not spend it on decoration.
