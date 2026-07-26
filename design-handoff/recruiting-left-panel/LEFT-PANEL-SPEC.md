# RECRUITING · RESPONSES — Left panel spec (List sources / 참여자 조건 / 분포)

> **Scope:** ONLY the **left column of the Recruiting fullview ① 응답 tab** — the three stacked cards: `LIST SOURCES` → `참여자 조건` → `분포`. Nothing else on the screen. **Date:** 2026-07-26. **CD SSOT:** `Recruiting Journey Fullview.dc.html`, frame N1, left pane.
> Inline hex below is render-only — bind to the tokens named in each row. Reuse `FULLVIEW-SHELL.md §F5–F6`; do not mint duplicates.

## Column container
| Prop | Value | Token / class |
|---|---|---|
| Width | **400px fixed**, `flex-shrink:0` | `w-[400px] shrink-0` |
| Divider | `border-right: 2px solid ink` | `border-r-2 border-ink` |
| Padding · gap | `16px` · `gap:15px`, `flex-direction:column` | `p-4 gap-[15px]` |
| Scroll | `overflow-y:auto` (custom 8px thumb `#d6d9df`) | `.sc` |
| Card shell (all 3) | border **2px ink** · radius **12** · `paper` · shadow **`2px 2px 0 rgba(29,27,32,.12)`** · `flex-shrink:0` | `border-2 border-ink rounded-sm paper` + `proposed:shadow-memphis-sm-faint` |
| Card head rule | `border-bottom: 1.5px solid rgba(29,27,32,.12)` | `border-line` @1.5 |

---

## ① LIST SOURCES (compact — 2 sources only)
**Head** — `padding: 8px 13px`, flex row, gap 8
| Part | Value | Token |
|---|---|---|
| Label `LIST SOURCES` | mono **9.5px / 700**, `letter-spacing .12em`, uppercase, `#8a8693` | `proposed:font-mono-label text-mute-soft` |
| Right status `6명 등록됨` | 10.5px `#8a8693`, `margin-left:auto` | `text-mute-soft` |

**Body** — `padding: 9px 11px`, `flex-col`, `gap:7px`
| Row | Value | Token |
|---|---|---|
| Upload row | **1.5px dashed ink** · radius 10 · `padding 7px 10px` · flex, gap 8 | `border-[1.5px] border-dashed border-ink rounded-[10px]` |
| Sheets row | **1.5px solid `rgba(29,27,32,.16)`** · radius 10 · same padding | `border-[1.5px] border-line` |
| Row icon | 14px emoji (📄 / 📗) | — |
| Row title | **12px / 700** ink | `text-ink font-bold` |
| Row sub | 10px `#8a8693`; Sheets sub is **mono** `#a3a7ad` + `truncate` | `text-mute-soft` / `font-mono text-faint` |
| Upload button `찾아보기` | border 1.4px ink · radius **7** · `padding 3px 9px` · 10.5px/700 ink · paper · `flex-shrink:0` | `border-ink rounded-[7px] paper` |
| Sheets button `Import` | **ink fill** · white · radius 7 · `padding 3px 10px` · 10.5px/700 | `bg-ink text-white rounded-[7px]` |
> Height ≈ **110px**. Deliberately a compact list, **not** cards — it must not compete with 참여자 조건. **`Link from responses` source is removed** (upload + Sheets only).

---

## ② 참여자 조건
**Head** — `padding: 11px 14px`, flex, gap 8: 🎯 (14px) · `참여자 조건` **13px / 700** ink · count `8개` mono 11px `#8a8693`.

**Body** — `padding: 13px 14px`
| Part | Value | Token |
|---|---|---|
| Summary text | **12.5px**, `line-height 1.6`, `#5b5965`, `margin-bottom 11px` | `text-mute` |
| Chip wrap | `flex-wrap`, `gap:7px` | — |
| Chip | radius **999** · `padding 5px 10px` · 11.5px · paper · flex, gap 6 | `rounded-pill paper` |
| — required | border **1.4px `amore` `#ff5c8a`** | `border-amore` |
| — optional | border 1.4px `rgba(29,27,32,.14)` | `border-line` |
| Chip category | mono **8.5px**, `.12em`, uppercase, `#8a8693` (인구/직업/경험/지역/성향/기기) | `font-mono text-mute-soft` |
| Chip value | **600** ink | `text-ink` |
| Chip `필수` flag | 9.5px / 700 `amore` — required chips only | `text-amore` |

---

## ③ 분포 (gender × age crosstab)
**Head** — `padding: 11px 14px`, flex, gap 8: 📊 · `분포` **13px / 700** · `총 24` mono 11px `#8a8693` · right: **질문 필터 ▾** pill (11px/600 `#5b5965`, border 1.4px `line`, radius 999, `padding 3px 10px`).

**Table** — `padding: 6px 14px 13px`, `border-collapse`, **mono 12px**
| Part | Value | Token |
|---|---|---|
| `th` | mono **9–10px**, `.1em`, uppercase, `#a3a7ad`, `border-bottom 1px line`; corner `성별\연령` left-aligned, age cols right-aligned; `Σ` col **800 ink** | `font-mono text-faint` |
| Row label (여성/남성) | **Pretendard 12.5px / 600** `#2a262f` (breaks the mono table on purpose) | `text-ink-2` |
| Cell (normal) | right-aligned, `padding 7px 8px`, **500** `#2a262f`; zero → `·` in `#c9ccd2` | `text-ink-2` / `proposed:line-empty` |
| **Cell (active filter)** | `#c2334f` **800** on `rgba(255,92,138,.12)`, radius 6 | `proposed:amore-deep` + `bg-amore/12` |
| Row Σ | **800** ink | `text-ink` |
| Foot row | `border-top 1.5px rgba(29,27,32,.15)`; col totals **800** ink; grand total **800 `#c2334f`** | `proposed:amore-deep` |

**Active-filter line** — `margin-top 9px`, flex, gap 6, wrap
| Part | Value | Token |
|---|---|---|
| Label `활성 필터:` | 10px `#8a8693` | `text-mute-soft` |
| Filter chip `여성·30s ✕` | 10.5px / 700 `#c2334f` · bg `rgba(255,92,138,.1)` · border 1px `amore` · radius 999 · `padding 2px 8px` | `proposed:amore-deep` + `border-amore` |
| `모두 지우기` | 10px `#8a8693`, underlined | `text-mute-soft underline` |

---

## States (this panel only)
| State | Treatment |
|---|---|
| Populated | as above |
| **No published form** | 참여자 조건 body → placeholder text; 분포 → dashed `line-empty` box, "Publish a form to see the gender · age distribution here." (`text-mute-soft`, centered) |
| No filter active | omit the active-filter line entirely; no cell highlight |
| List sources empty | rows unchanged; head status reads `0명 등록됨` |

## ⚠️ Notes
1. Crosstab counts are **fixed at 100% of responses** — question filters highlight cells, they never change the numbers (existing contract).
2. `LIST SOURCES` sits **above 참여자 조건** by design (intake first, then criteria, then distribution) and must stay compact — it is a utility strip, not a feature card.
3. Cell highlight ↔ active-filter chip are the same state; clicking a cell toggles the chip (behavior is worker-owned).
