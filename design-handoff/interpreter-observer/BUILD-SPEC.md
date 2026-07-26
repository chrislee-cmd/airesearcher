# INTERPRETER-OBSERVER — Handoff (public listener page redesign)

> **Scope:** the **observer / share-link page** at `/live/<token>` — the read-only listener surface. Legacy flat layout → Memphis system. **Date:** 2026-07-26. **CD = visual SSOT: `Interpreter Observer View.dc.html`** (7 static frames).
> **Delta bundle.** Assumes repo has `FULLVIEW-SHELL.md` (§F class-map + tokens), `tokens.json`, `CONTEXT-PACK.md`, `CD-DELIVERABLE-RULES.md`. Interpreter identity tone = **mint `#cdebd9`** (WIDGET-SHELL §S3).
> **Not the admin fullview.** The admin-side interpreter surfaces (fullview state 03, screen-share frame 10) are unchanged and handed off separately.

## Legacy → redesign (what changed)
| Legacy (screenshot 2026-07-26) | Redesign |
|---|---|
| Plain page: bold title, one-line "Host language: … Translated to: …", hairline rules | **Mint header band** (3px ink border-bottom) w/ 🎧 + Outfit 800 title + LIVE pill + **language-pair pills** (🇰🇷 한국어 → 🇺🇸 English) |
| Full-width flat pink bar "Tap to enable audio" | **Dedicated unlock gate screen** (frame 01): 🔈 tile, "Tap to start listening", primary CTA, reason copy; channel bar shown disabled below |
| `AUDIO` fieldset w/ 3 bare text links (Original / Translation / Mute) + helper on the right | **Segmented control** pinned to a bottom bar (2px ink, rounded-pill, active = ink fill), label `AUDIO CHANNEL` + helper "Captions keep running on any channel." |
| Empty body with a `···` | **Twin caption panels** (ORIGINAL / TRANSLATION) always present; bottom-anchored; explicit **waiting** state (frame 05) |
| No end/ended treatment | **Session-ended screen** (frame 06) |
| No share support | **Shared-screen layout** (frame 07): screen on top, captions 2-column below |

## Frames (all static — build each)
| # | State | Notes |
|---|---|---|
| 01 | **Entry · audio locked** | unlock gate; channel bar disabled (`surface-disabled` track, `mute` label — NOT wrapper opacity) |
| 02 | Listening · **Translation** channel | TRANSLATION panel emphasized (3px ink border + `3px3px0 success` shadow) + `🔊 PLAYING` badge |
| 03 | Listening · **Original** channel | emphasis moves to ORIGINAL (ink shadow); TRANSLATION marked `CAPTIONS ONLY` |
| 04 | **Muted** | channel bar switches to peach (`proposed:pastel-peach-bg`) + `AUDIO CHANNEL · MUTED` label; captions unchanged |
| 05 | **Waiting** (no speech yet) | dashed empty panels (`proposed:line-empty` #c9ccd2), `● ● ●` + "Waiting for the first words…" |
| 06 | **Session ended** | neutral header (`#eceef1`), ✓ tile, duration + language pair |
| 07 | **Shared screen** (900px wide) | dark monitor chrome + `● SHARING` + participant tiles + **"View only · you can't control the shared screen"**; captions become a **2-column row** underneath; channel bar unchanged |
> Fallback: no share → frames 02–04 (vertical stack). Not yet drawn: invalid/expired token, connection lost/reconnecting, host paused, mobile (<480) layout.

## §1 Class map (diff target — inline hex is render-only)
| Element | Spec | Token / class |
|---|---|---|
| Page frame | border 3px ink · radius 16 · `shadow 8px8px0 ink/28` · bg `surface-canvas` | `border-[3px] border-ink rounded-[16px]` + `proposed:shadow-fullview-frame` + `proposed:surface-canvas` |
| Header band | border-b **3px** ink · pad 16/22 · **bg mint** | `border-b-[3px] border-ink bg-widget-header-mint` |
| — ended variant | bg `#eceef1` · dot + label `mute-soft` | `proposed:surface-disabled` |
| Title | Outfit 800 · 20px · ls -0.4 | `font-display font-extrabold` |
| LIVE pill | paper · border 1.5 ink · rounded-pill · mono 11/700 · dot `amore` | `paper border-ink rounded-pill font-mono` + `bg-amore` |
| Language pills | paper · border 1.5 ink · rounded-pill · 12/700 | `paper border-ink rounded-pill` |
| Caption panel (idle) | border 2px ink · radius 14 · paper · `shadow 2px2px0 ink` | `border-2 border-ink rounded-sm paper shadow-memphis-sm` |
| Caption panel (**active channel**) | border **3px** ink · `shadow 3px3px0 success` (TRANSLATION) / `3px3px0 ink` (ORIGINAL) | `border-[3px]` + `proposed:shadow-memphis-md-success` / `shadow-memphis-md` |
| — ORIGINAL header | bg `paper-soft` · dot `mute-soft` | `paper-soft` |
| — TRANSLATION header | bg `#eafaf0` · dot/label `success` | `proposed:signal-success-bg-soft` |
| — `🔊 PLAYING` badge | `success-text` on `success-bg`, border `success-line`, mono 9.5 | `proposed:signal-success-{text,bg,line}` |
| Caption body | bottom-anchored, gap 14–16, pad 18–20, scrolls; settled line `text-faint` 16–17, live line ink 19–21 (TRANSLATION weight 600) | `font-display`, `.sc` |
| Waiting panel | 1.8px **dashed** `line-empty` · bg `#fafafa` · faint labels | `proposed:line-empty` + `paper-soft` |
| Channel bar | border-top 2px ink · paper · pad 13/18; label mono 9.5/700/.14em `mute-soft` | `border-t-2 border-ink paper` + `proposed:font-mono-label` |
| — muted variant | bg `#fff7f0` · labels `warning-text` | `proposed:pastel-peach-bg` + `proposed:signal-warning-text` |
| Segmented control | border 2px ink · rounded-pill · `shadow 2px2px0 ink`; active seg `bg-ink text-white 800`; idle `paper text-mute 600` | `border-2 border-ink rounded-pill shadow-memphis-sm` |
| — **disabled (frame 01)** | track `#eceef1` · label `mute #5b5965` · border `ink/32` · **no wrapper opacity** | `proposed:surface-disabled` + `text-mute` (a11y: ≥4.5:1 — do NOT dim the container) |
| Unlock gate tile / ended tile | 72–74px · border 3px ink · radius 20 · `shadow 4px4px0 ink` · bg mint / paper | `border-[3px] border-ink rounded-md shadow-memphis-lg` |
| Primary CTA | `bg-ink text-white` · rounded-pill · pad 14/30 · `shadow 4px4px0 ink/30` | `bg-ink text-white rounded-pill` |
| Monitor (frame 07) | border 3px ink · radius 16 · `shadow 3px3px0 ink` · bg ink; titlebar `ink-2`; URL pill mono `text-faint`; `● SHARING` mint | `bg-ink` / `bg-ink-2` + `shadow-memphis-md` |
| Participant tile | `aspect-16/10` · radius 12 · paper · border 2px `line` (idle) / `success` (speaking) · `0 6px 20px ink/8` | `rounded-sm paper` + `proposed:shadow-tile-lift` |

## §2 proposed-tokens
Reuse `FULLVIEW-SHELL §F6` — no duplicates. Used here: `surface-canvas`, `shadow-fullview-frame`, `signal-success-{text,bg,line,bg-soft}`, `pastel-peach-bg`, `signal-warning-text`, `surface-disabled`, `line-empty`, `text-faint`, `font-mono-label`, `shadow-tile-lift`, `shadow-memphis-md-success` (`3px 3px 0 #16a34a`).

## §3 Interaction disclaimer
Static comps — states only. Worker owns: audio unlock (user-gesture `play()`), channel switching + stream routing (floor vs interpreted vs muted), caption streaming/anchoring, share-stream mount, reconnect, session-ended transition.

## §4 ⚠️ contract-change
1. **`⚠️ contract-change:` channel semantics.** Legacy exposes Original / Translation / Mute as one exclusive choice. Confirm "Original" = raw floor audio stream is actually available to observers (not just a label) — if only the interpreted stream is broadcast, drop to a 2-way (Translation / Mute) and I'll revise.
2. **`⚠️ contract-change:` share visibility for observers.** Frame 07 assumes the shared screen is relayed to the listener page. If observers only get audio + captions today, frame 07 is a new capability (needs stream/permission decision); otherwise it's presentation-only.
3. Speaking-tile ring (`border-success`) needs per-speaker audio-level data — drop the ring if unavailable.
4. Session duration + language pair on the ended screen must come from session state.

## §5 Open items
- Mobile layout (<480): channel bar likely becomes full-width 3-up; caption panels stack 1-col even in share mode.
- Invalid/expired token + reconnecting states (not drawn).
- Whether the observer can toggle caption size / hide the original panel.
