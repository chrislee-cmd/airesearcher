# FULLVIEW-SHELL — Widget fullview design contract + token map

> **Scope:** the **expanded "fullview"** surface (opened from a widget's `⤢`). Distinct from `WIDGET-SHELL.md`, which owns the collapsed 604×900 **card**. This shell = **left 240px sidebar (4/6-widget switch) + right slot**, framed at **1400×840** (proto). CD SSOT = `Widget Fullview Comps.dc.html` (9 static state frames).
> **Consumes:** `WIDGET-SHELL.md` (authority model + §S3 identity), `tokens.json` (vocab), `CONTEXT-PACK.md` (§5 proposed-token convention). **Date:** 2026-07-22.
> **Authority (inherited from WIDGET-SHELL):** CD `.dc.html` is the visual SSOT. DS token = convenience vocab, used only where its value already equals the CD value. On conflict the **measured CD value wins** → promote it as a `proposed-token`, never bend CD toward a DS default. Build the fullview as a **new component**; reuse logic/data only.

---

## §F0 What "conformance" means here
The worker diffs their TSX against the **§F class map** below. Every visual element must resolve to an explicit **utility class / token** (existing) or a **`proposed-token:<name>`** (intentional new value). Raw hex/px in the built component = drift. The inline hex in the `.dc.html` is render-only reference — **do not copy it**; bind to the class/token in this column.

## §F1 Fullview shell geometry (frame + regions)
| Element | Measured (CD) | Class / token |
|---|---|---|
| Fullview frame | **1400×840** · border 3px ink · radius **14** · shadow **8px8px0 ink/28%** · overflow hidden · flex row | `border-[3px] border-ink rounded-sm` + `proposed:shadow-fullview-frame` (8px8px0 `ink/28`) |
| — outer W/H | 1400×840 = proto; **container-owned** (canvas/app owns final W/H) | keep proportions; box may be responsive |
| Frame bg | `#fbfbf9` (warm near-white, NOT the yellow canvas accent) | `proposed:surface-canvas` `#fbfbf9` |
| Sidebar | **240px** · flex-col · bg `#f7f7f5` · border-r 2px ink · pad 14/12 · gap 6 | `w-[240px] paper-soft border-r-2 border-ink` |
| Right slot | flex-1 · flex-col · overflow hidden | `flex-1 overflow-hidden` |
| Region divider | 2px ink (sidebar↔slot, slot inner columns) | `border-ink` @2px |
| Soft divider | 1px `ink/10` | `border-line` |

## §F2 Sidebar nav item (widget switch)
| Part | Measured | Class / token |
|---|---|---|
| Item (active) | border 2px ink · radius 8 · bg paper · shadow 2px2px0 ink | `border-2 border-ink rounded-[8px] paper shadow-memphis-sm` |
| Item (idle) | border transparent · bg transparent · mute-soft text | `text-mute-soft`, no border/shadow |
| Status dot | 10px circle, per-widget pastel (§S3) · ring `ink/30` | `bg-widget-header-<tone>` |
| Badge LIVE | border+fill amore · #fff · mono 9/800 · pulse dot | `border-amore bg-amore text-white font-mono` |
| Badge DONE | border ink · bg mint · text `#14713a` | `bg-pastel-mint` + `proposed:signal-success-text` |
| Section label | mono 10 · `#a3a7ad` · ls 1px | `font-mono` + `proposed:text-faint` |
| Footnote card | border `line` · radius 10 · paper | `border-line rounded-[10px] paper` |

## §F3 Fullview header (per screen)
| Part | Measured | Class / token |
|---|---|---|
| Header band | border-b 2px ink · pad 13/24 · flex row · bg = per-widget pastel (§S3) | `border-b-2 border-ink` + `bg-widget-header-<tone>` |
| Title | Outfit **800 · 22px** · ink · ls -0.5 | `font-display font-extrabold text-ink` + `proposed:text-fullview-title` (22/800/-0.5) — **NOT** 29px card title |
| Project pill | paper · border 1.5 ink · radius 999 · shadow 2px2px0 ink · 📁 + name + ▾ | `paper border-ink rounded-pill shadow-memphis-sm` |
| Live/status chip | paper · border 1.5 ink · radius 999 · mono 11/700 · dot amore/`#ef4444` | `paper border-ink rounded-pill font-mono` + dot `bg-amore` / `proposed:signal-rec` |
| End-session btn | border 2px `#c2334f` · text `#c2334f` · radius 999 · shadow 2px2px0 `#c2334f` | `rounded-pill` + `proposed:amore-deep` (`#c2334f`) + `proposed:shadow-memphis-sm-crimson` |
| Close ✕ | 32px · border 1.5 ink · radius 9 · shadow 2px2px0 ink | `border-ink rounded-[9px] shadow-memphis-sm` |
| Done badge | bg `#f4fbf6` · border `#cdeed8` · text `#14713a` · ✓ in success circle | `proposed:signal-success-bg` / `-line` / `-text` |

## §F4 Body components (by screen)
**Probing** — persona grid + thinking/history rail
| Part | Measured | Class / token |
|---|---|---|
| Persona card (filled) | border 2px ink · radius 11 · paper · shadow 2px2px0 `ink/10` | `border-2 border-ink rounded-[11px] paper` + `proposed:shadow-memphis-sm-faint` |
| Persona card (empty) | border 1.6 dashed `#c9ccd2` · bg `#fafafa` | `proposed:line-empty` (`#c9ccd2`) dashed + `paper-soft` |
| Fill dots | 3=success · 2=`#e0a83a` · 1/0=`#c9ccd2` | `text-success` / `proposed:accent-amber` / `proposed:line-empty` |
| Thinking header dot | amore | `bg-amore` |
| Spotlight scrim | `ink/34` overlay | `bg-ink/34` |
| Spotlight modal | bg `warning-bg` · border 3px `#e0a83a` · radius 20 · shadow 8px8px0 `#e0a83a` | `warning-bg rounded-md` + `proposed:accent-amber` border + `proposed:shadow-modal-amber` |
| Spotlight question | Outfit 700 · 31px | `font-display` + `proposed:text-spotlight-q` (31/700) |
| Spotlight meta text | `#b45309` (amber-deep) | `proposed:signal-warning-text-deep` (`#b45309`) |

**Interpreter** — twin panels + right rail
| Part | Measured | Class / token |
|---|---|---|
| Translation panel | border 3px ink · radius 16 · paper · shadow 3px3px0 ink | `border-[3px] border-ink rounded-[16px] paper shadow-memphis-md` |
| INPUT header | bg `paper-soft` · dot mute-soft | `paper-soft` |
| OUTPUT header | bg `#eafaf0` · dot/label success | `proposed:signal-success-bg-soft` (`#eafaf0`) |
| Live line / faint line | ink / mute-soft | `text-ink` / `text-mute-soft` |
| Output-audio toggle (on) | track `success` · knob paper · border 2px ink | `bg-success border-2 border-ink` |
| Observer link field | mono 11.5 · paper · border 1.5 ink · radius 10 | `font-mono paper border-ink rounded-[10px]` |

**Transcript** — file list + detail
| Part | Measured | Class / token |
|---|---|---|
| File row (done) | border 2px ink · radius 14 · paper · shadow 2px2px0 `ink/12` | `border-2 border-ink rounded-sm paper` + `proposed:shadow-memphis-sm-faint` |
| File row (processing) | border `line` · bg `#faf7ff` (lav tint) | `border-line` + `proposed:pastel-lav-bg` |
| Status Done/Proc/Fail | success / `#6b4aa0`(lav) / `#b4443f`(err) chips | `proposed:signal-success-*` / `proposed:pastel-lav-text` / `proposed:signal-error-*` |
| Turn avatar (moderator) | bg sky · name `#2563a8` | `bg-widget-header-sky` + `proposed:accent-blue` |
| Turn avatar (participant) | bg `#ffe0ec` (rose tint) · name `#c2334f` | `proposed:amore-bg-soft` + `proposed:amore-deep` |
| AI-summary card | bg `#f6f2ff` (lav tint) | `proposed:pastel-lav-bg` |
| Theme count | `#8b5cf6` | `proposed:accent-violet` (Transcript progress accent, §S3) |

**AI UT** — screen monitor + review
| Part | Measured | Class / token |
|---|---|---|
| Monitor chrome | bg ink · titlebar `#2a262f` · border `#000` | `bg-ink` / `bg-ink-2` / `border-[--border-strong]` |
| Traffic lights | `#ff5f57 #febc2e #28c840` | **literal macOS chrome** — decorative, not tokens |
| REC dot / edge | `#ef4444` / `#ff9a9a` | `proposed:signal-rec` / `-soft` |
| Task card | border 2px ink · radius 14 · bg `#fff7f0` (peach tint) · shadow 2px2px0 ink | `border-2 border-ink rounded-sm shadow-memphis-sm` + `proposed:pastel-peach-bg` |
| Clip thumb | border 1.5 ink · radius 12 · shadow 2px2px0 ink | `border-ink rounded-sm shadow-memphis-sm` |
| Metric (estimated) | opacity 0.5 | `opacity-50` |

**Recruiting** — criteria + distribution + judged table
| Part | Measured | Class / token |
|---|---|---|
| Panel card | border 2px ink · radius 12 · paper · shadow 2px2px0 `ink/14` | `border-2 border-ink rounded-sm paper` + `proposed:shadow-memphis-sm-faint` |
| Criteria chip (required) | border 1.4 amore · `Required` amore | `border-amore` |
| Dist active cell | text `#c2334f` · bg `amore/12` · radius 6 | `proposed:amore-deep` + `bg-amore/12` |
| Fit High/Med/Low | `success` / `amore` / `mute-soft` dot+text+tint | `text-success` / `text-amore`(`proposed:amore-deep`) / `text-mute-soft` |
| Flag badge | text `#8a5a10` · bg `warning-bg` · border `#f0d78a` | `proposed:signal-warning-text` + `warning-bg` + `proposed:warning-line-amber` |
| Tab pill (active) | bg ink · #fff · radius 999 | `bg-ink text-white rounded-pill` |

**Desk** — scroll-spy nav + section cards
| Part | Measured | Class / token |
|---|---|---|
| Section card | border 3px ink · radius 14 · paper · shadow **4px4px0 ink** | `border-[3px] border-ink rounded-sm paper shadow-memphis-lg` |
| Section head tint | exec `#ffeef4` · find `#edf9f0` · quant `#fdf6e6` · rq `#f3eefe` · appx `#f2f2f3` | `proposed:pastel-*-bg` (rose/mint/sun/lav/neutral tint set) |
| RQ card | border 2px ink · radius 11 · shadow 2px2px0 `ink/12` | `border-2 border-ink rounded-[11px]` + `proposed:shadow-memphis-sm-faint` |
| Confidence 🟢/🟡 | success / `#e0a83a` | `text-success` / `proposed:accent-amber` |
| Quant value / tier T1-3 | `#c2334f` / success·amber·mute-soft | `proposed:amore-deep` / tier scale |
| "To explore" note | `warning-bg` · border `#f0d78a` · text `#8a5a10` | `warning-bg` + `proposed:warning-line-amber` + `proposed:signal-warning-text` |

## §F5 Existing-token map (drop-in, values already match)
| Raw in comp | Token / class |
|---|---|
| `#1d1b20` | `ink` |
| `#2a262f` | `ink-2` |
| `#5b5965` | `mute` |
| `#8a8693` | `mute-soft` |
| `#ffffff` / `#fff` | `paper` |
| `#f7f7f5` | `paper-soft` |
| `#ff5c8a` | `amore` |
| `#16a34a` | `success` |
| `#fff1e6` | `warning-bg` |
| `#cfe6ff` `#cdebd9` `#e7defe` `#ffd9be` `#ffe8a8` `#bfe9ef` | `bg-widget-header-{sky,mint,lav,peach,sun,cyan}` (§S3) |
| `rgba(29,27,32,0.10)` | `line` · `.06`→`line-soft` |
| `4px4px0 ink` | `shadow-memphis-lg` · `3px3px0`→`memphis-md` · `2px2px0`→`memphis-sm` |
| radius `14` / `24` / `999` | `rounded-sm` / `rounded-md` / `rounded-pill` |
| sizes `10 / 10.5 / 11.5 / 12.5 / 13 / 15 / 22` | `text-{xs,xs-soft,sm,md,lg,xl,3xl}` |

## §F6 proposed-tokens (⚠️ intentional new values — promote to DS, do not hardcode)
> Convention: `CONTEXT-PACK.md §5`. Each is a CD value with no existing DS equivalent; writer decides promotion vs. re-use.

**Color**
- `surface-canvas` `#fbfbf9` — fullview frame / neutral canvas bg (NOT `surface-accent` yellow)
- `amore-deep` `#c2334f` — destructive/emphasis crimson (End-session, Σ totals, active dist cell, med-fit)
- `signal-success-text` `#14713a` · `signal-success-bg` `#f4fbf6` · `signal-success-line` `#cdeed8` — Done badge/tint (a11y: keep dark text, do NOT snap to `#16a34a`)
- `signal-success-bg-soft` `#eafaf0` — Interpreter OUTPUT header
- `signal-rec` `#ef4444` · `signal-rec-soft` `#ff9a9a` — AI UT recording (distinct from amore)
- `accent-amber` `#e0a83a` · `signal-warning-text` `#8a5a10` · `signal-warning-text-deep` `#b45309` — spotlight / flags / confidence
- `warning-line-amber` `#f0d78a` — flag/note border (vs DS `warning-line` `#ffd9bf`)
- `signal-error-text` `#b4443f` · `signal-error-line` `#f0c0c0` — failed transcript
- `accent-violet` `#8b5cf6` · `pastel-lav-bg` `#f6f2ff/#faf7ff/#f3eefe` · `pastel-lav-text` `#6b4aa0` — Transcript/Desk lav family
- `accent-blue` `#2563a8` — moderator speaker name
- `pastel-peach-bg` `#fff7f0` `pastel-rose-bg` `#ffeef4` `pastel-mint-bg` `#edf9f0` `pastel-sun-bg` `#fdf6e6` `pastel-neutral-bg` `#f2f2f3` — desk section-head tints
- `line-empty` `#c9ccd2` (dashed empty state) · `text-faint` `#a3a7ad` (mono captions/placeholder) · `text-disabled` `#b3b7bd` (estimated metrics)
- `bg-widget-header-cyan` `#bfe9ef` — Desk (open decision: cyan vs unify-sky, see desk §6)

**Shadow**
- `shadow-fullview-frame` = `8px 8px 0 rgba(29,27,32,0.28)` (frame; vs solid `memphis-2xl`)
- `shadow-memphis-sm-faint` = `2px 2px 0 rgba(29,27,32,0.12)` (panel cards)
- `shadow-memphis-sm-crimson` = `2px 2px 0 #c2334f` · `shadow-modal-amber` = `8px 8px 0 #e0a83a`

**Radius (DS scale is sparse: 2/4/14/24/999)** — off-scale small radii used as raw `border-[Npx]`: `8` (nav item, chip) · `9` (close btn) · `10` (link field, footnote) · `11` (persona/RQ card) · `12` (panel/monitor) · `16` (translation panel). Promote as `radius-nav 8` / `radius-panel 12` / `radius-panel-lg 16` if a scale is wanted; otherwise raw `border-[Npx]` is acceptable per DS `border_width` note.

**Type**
- `text-fullview-title` = Outfit 800 / 22px / ls -0.5 (fullview header title; distinct from 29px card title)
- `text-spotlight-q` = Outfit 700 / 31px (spotlight question)
- off-scale body sizes `11 / 12 / 13.5 / 14 / 18 / 20 / 23 / 24` → nearest `text-*` or raw `text-[Npx]`

## §F7 ⚠️ contract notes (decisions the writer must confirm)
1. **Mono for technical labels.** DS says `font._no_mono_default` (production body is NOT mono), but the fullview intentionally uses `ui-monospace` for section labels, timestamps, IDs, badges, table headers. This is a CD decision → introduce `proposed:font-mono-label` (`ui-monospace`) scoped to technical captions. **Confirm** this is allowed, or map to `font-sans`.
2. **Fluid width.** Frame is 1400px proto; the app canvas/grid owns final W/H (per WIDGET-SHELL §S1a). Keep among-parts proportions (sidebar 240 fixed, twin panels flex:1, right rails fixed 300–340). Intrinsic styling (border/radius/shadow/tone) stays absolute.
3. **Sidebar = shared fullview chrome.** Build once; each screen supplies only its right-slot body + active index. Do not re-implement per widget (same anti-drift mandate as `<WidgetShell>`).
4. **States are static comps.** `Widget Fullview Comps.dc.html` covers 9 states (Probing live/spotlight · Interpreter · Transcript list/detail · AI UT live/review · Recruiting · Desk). Interaction (switch, dropdown, view-toggle) is disclosed by state, not wired — worker owns behavior.
