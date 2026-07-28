# SHARE VIEW SHELL — BUILD-SPEC

> **Surface B** of the unified-artifacts brief. **CD SSOT:** `share-shell.dc.html` (4 frames, 7 states). **Date:** 2026-07-28.
> **Read first:** `tokens.json` 2.0 + `TOKEN-DECISIONS.md`. Geometry in `GEOMETRY.md`. Sibling shell: `FULLVIEW-SHELL.md` — same "shell + body slot" philosophy, but this one is **public, unauthenticated and read-only**.
> **The one rule:** the shell does not know which feature it wraps. `if (feature === …)` anywhere in the chrome is a bug. Identity arrives as `tone`.

---

## §0 Shell props (typed — design against exactly this)
```ts
type ShareShellProps = {
  state: 'valid' | 'loading' | 'expired' | 'revoked' | 'not_found' | 'gated';
  title: string;              // deliverable title, rendered verbatim
  tone: 'sky'|'mint'|'lav'|'peach'|'sun'|'aqua';   // pastel identity; ignored on dead-end states
  sharedBy: string;
  sharedAt: string;           // ISO
  expiresAt: string | null;   // null → "no expiry"
  downloadable: boolean;
  children: ReactNode;        // the body slot — opaque to the shell
};
```
The shell renders **no feature copy**. "Transcript", "Desk research" etc. in the comp come from a tone→label map that lives *outside* the chrome and is passed in; if that is inconvenient, drop the eyebrow entirely rather than branching.

---

## §1 Class map (diff target)

### Frame
| Element | Spec | Token / class |
|---|---|---|
| Page frame | border 3px ink · radius 16 · `shadow-frame` · bg `surface-canvas` | `border-[3px] border-ink rounded-panel-lg shadow-frame surface-canvas` |
| Dead-end frame | same, `shadow-frame` at 24% | — |

### Masthead (`valid` / `gated` / `loading`)
| Element | Spec | Token / class |
|---|---|---|
| Band | border-b **3px** ink · pad 15/22 · bg `pastel.<tone>` | `border-b-[3px] border-ink bg-<tone>` |
| Brand mark | 24px · border 2px ink · radius 7 · `paper` · `shadow-memphis-xs` · "R" 12/800 | `border-2 border-ink rounded-xs paper shadow-memphis-xs` |
| Brand word | Outfit 800 · 12.5px · ls -0.2 | `font-display font-extrabold` |
| Read-only badge | `paper` · border 1.5 ink · pill · mono 10.5/700 · `shadow-memphis-sm` · `👁 READ-ONLY` | `paper border-ink rounded-pill font-mono-label shadow-memphis-sm` |
| Title | Outfit 800 · 23px · ls -0.5 · lh 1.25 · **wraps, never truncates** | `font-display font-extrabold` |
| Attribution | 11.5px `#3a3540` (ink on pastel) · "Shared by X · date" | — |
| Download | `paper` · border 1.5 ink · pill · 11.5/700 — only when `downloadable` | `paper border-ink rounded-pill` |
> Title **wraps**. A shared deliverable's name is the recipient's only context; truncating it to protect the layout is the wrong trade.

### Notice strip
| Element | Spec | Token / class |
|---|---|---|
| Strip | border-b `line` · `paper-soft` · pad 8/22 · 11.5px `mute` · 🔗 | `border-b border-line paper-soft text-sm text-mute` |
| Emphasis | expiry date or "no expiry" in `ink` bold | `text-ink font-bold` |
> Renders on `valid` and `gated` only. It is not conditional on having an expiry — "no expiry" is information the recipient needs.

### Body slot
| Element | Spec | Token / class |
|---|---|---|
| Container | `flex:1; min-height:0; overflow-y:auto` · `paper` · pad 18–20 / 22 | `paper` |
> The shell gives the slot **a scrolling container and padding, nothing else**. No max-width, no prose styling, no grid. The body owns its own layout — that is why the same chrome fits a turn stream and a sectioned report.

### Footer
| Element | Spec | Token / class |
|---|---|---|
| Bar | border-t 2px ink · `paper-soft` · pad 11/22 | `border-t-2 border-ink paper-soft` |
| Credit | 11px `mute-soft`, product name in `ink` bold | `text-sm text-mute-soft` |
| CTA | 11px/700 `amore-deep`, right-aligned — "Create your own →" | `text-amore-deep` |

### Dead-end states (`expired` / `revoked` / `not_found`)
| Element | Spec | Token / class |
|---|---|---|
| Band | bg **`surface-disabled`** — **no feature tone** | `surface-disabled` |
| Status badge | `paper` · border 1.5 `ink/24` · pill · mono 10/700 `mute-soft` (+ dot on expired) | `rounded-pill text-mute-soft` |
| Icon tile — expired | 70px · border 3px ink · radius 19 · `paper-soft` · `shadow-memphis-lg` · ⏳ | `border-[3px] border-ink shadow-memphis-lg paper-soft` |
| Icon tile — not-found | 70px · **2.5px dashed `line-empty`** · `surface-canvas` · 🔗 | `border-[2.5px] border-dashed border-line-empty` |
| Headline | Outfit 800 · 21px · ls -0.4 | `font-display font-extrabold` |
| Body | 13px/1.65 `mute` · max-w 360 · centred | `text-lg text-mute` |
| Secondary action | `paper` · border 1.5 `ink/20` · pill · 12/600 `mute` | — |
> **CD decision — dead ends drop the tone.** Keeping a pastel band on an expired link makes it read as a working page that happens to be a different colour. Neutral says "there is nothing here" before any copy is read. The solid tile signals *was valid, now closed*; the dashed tile signals *never resolved*.

### Email gate (`gated`)
| Element | Spec | Token / class |
|---|---|---|
| Band | tone **kept** + badge `🔒 RESTRICTED` | `bg-<tone>` |
| Icon tile | 62px · border 3px ink · radius 17 · bg `pastel.<tone>` · `shadow-memphis-lg` · ✉ | — |
| Field | max-w 330 · border 2px ink · **radius 22** · pad 11/16 · 13px | `border-2 border-ink rounded-field paper` |
| Submit | full-width · `bg-ink text-paper` · pill · 14/800 · `shadow-memphis-md` @30% | `bg-ink text-paper rounded-pill` |
| Privacy note | 🛈 + 11px `mute-soft`, left-aligned under the form | `text-sm text-mute-soft` |
| **Wrong address** | inline error **under the field** — `error-text`, 11.5px: "This email isn't on the list." Field border → `error`. **Never a new screen.** | `text-error-text border-error` |
> The gate keeps its tone: the link *is* valid, the visitor just has not proven who they are.

---

## §2 proposed-tokens
**None.** All values resolve to `tokens.json` 2.0.

---

## §3 State matrix (all STATIC — build each)
| # | Frame | State | Notes |
|---|---|---|---|
| B0 | — | **anatomy** | shell-owns vs slot-owns diagram + props table. Documentation frame, not a screen. |
| B1 | 760×780 | **valid · transcript body** | tone `lav` · expiry present · turn stream in the slot |
| B2 | 760×780 | **valid · desk body** | tone `aqua` · "no expiry" · sectioned report + quant table in the slot. **Chrome is byte-identical to B1** — this frame exists to prove it. |
| B3a | 568×560 | **loading** | chrome paints fully; title/attribution are skeleton bars; slot skeletons ladder 1 → 0.26 |
| B3b | 568×560 | **expired** | neutral band · ⏳ solid tile · date of expiry · Request access |
| B3c | 568×560 | **not-found** | neutral band · dashed 🔗 tile · echoes the token path in mono |
| B3d | 568×560 | **email gate** | tone kept · 6-line form · privacy note |
> `revoked` reuses B3b with one string swap ("…has been revoked"). Not drawn separately — same layout, and drawing it would imply otherwise.
> Not drawn: password gate (if it ever exists), body-level error (the slot failed while the shell is valid), mobile <480.

---

## §4 Interaction disclaimer
Static comps. Worker owns token resolution and routing to the right state, gate submission and allow-list check, download dispatch, body mounting, and any body-internal controls. **Feature-specific body controls are explicitly not the shell's business** — the interpreter observer's audio channel bar, for example, lives in the slot, not in this chrome.

---

## §5 ⚠️ contract-change
1. **`⚠️ contract-change:` `not_found` and `deleted` are one screen.** CD decision: a public page must not confirm whether a token ever existed. Both render B3c. If product wants "this was deleted" as distinct copy, that is an information-disclosure decision — raise it, don't implement it silently.
2. **`⚠️ contract-change:` tone→eyebrow label map.** The masthead shows a feature word ("Transcript"). To keep the shell feature-blind this must arrive as a prop, not be derived inside. Confirm where that map lives.
3. **`⚠️ contract-change:` `downloadable` ≠ `export_formats`.** The share header shows a single Download control; the library exposes a format list. If a shared page should offer multiple formats, `downloadable: boolean` is insufficient and needs to become the same `export_formats: string[]`.
4. **`⚠️ contract-change:` attribution exposes a name.** "Shared by 김연구" appears on an unauthenticated page. Confirm that is intended (it is normal for share links, but it is a PII decision, not a design one).
5. The interpreter observer (`Interpreter Observer View.dc.html`) currently owns its own chrome. Converging it onto this shell means its header, read-only badge and footer are **replaced**; its caption panels and channel bar move into the slot unchanged.

---

## §6 Open items
- Whether the footer CTA ("Create your own →") is acceptable on a client-facing share page, or needs to be suppressible per share.
- Mobile: masthead likely stacks title above the download control; the slot is already single-column.
- Watermarking: the brief mentions it for the footer. Nothing is drawn — needs a decision on whether it is text, a mark, or applied to exports only.
