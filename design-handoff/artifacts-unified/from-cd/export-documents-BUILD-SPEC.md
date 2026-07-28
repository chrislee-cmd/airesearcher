# EXPORT DOCUMENTS — BUILD-SPEC

> **Unsolicited addition.** The brief defers the export registry, so no document spec existed — `export_formats` says *which* formats, never what the file looks like. Without this, three features would each invent their own document. **CD SSOT:** `export-documents.dc.html` (4 frames). **Date:** 2026-07-28.
> **Read first:** `tokens.json` 2.0 (print type family + `geometry.page-letter`), `GEOMETRY.md §C`.
> **Not a print stylesheet.** These documents are generated server-side (docx/pdf library). This is a layout specification, not HTML to print.

---

## §1 Print translation — the screen system does not survive paper unchanged
This is the load-bearing section. Applying the Memphis screen system directly to a page produces an ink-heavy, unreadable document.

| Element | On screen | On paper | Why |
|---|---|---|---|
| Hard shadow | `shadow-memphis-*` | **dropped entirely** | offset shadows print as smudged grey slabs and spend toner on nothing |
| Frame border | 3px ink, radius 14–20 | **1.6px rule under section titles** | the page is already a frame; boxing content inside it wastes margin |
| Pastel band | full-width header band | **6 × 132px tone bar** | identity survives at a fraction of the ink and still sorts a printed stack |
| Status badge | tinted pill + dot | **text, in a metadata cell** | a printed page has no live status, and colour alone fails mono printing |
| Body type | 12.5–13.5px | **`text-print-body` 16 / 1.65** | paper is read at a longer distance than a screen |
| Mono captions | `font-mono-label` | **kept, 10–11px** | timestamps and IDs are scanned, not read — mono still earns its place |
| Disabled / estimated | 50% opacity | **`~` prefix + `mute` ink** | opacity is meaningless on paper |

**What survives untouched:** the pastel identity tone — once as the masthead bar, once per section marker. Enough to tell a transcript from a report at a glance; cheap enough not to drink toner.

---

## §2 Shared page anatomy (every feature, every format)
See `GEOMETRY.md §C` for measurements.

| Part | Contents | Pages |
|---|---|---|
| **Masthead** | tone bar → feature eyebrow + rule + product name → title (Outfit 800/30, 34 for a report cover) → subtitle | p1 only. **There is no separate title page.** |
| **Metadata strip** | hairline grid, 3–4 cells. Whatever a reader needs to trust the document: duration, speakers, source count, tier count, outcome, date. | p1 |
| **Content** | **single column.** Everything the screen put in a rail becomes a section in reading order. | all |
| **Section** | tone dot 11px + Outfit 800/19 title + 1.6px ink rule | all |
| **Running header** | 20 × 4 tone chip · document title · rule · feature name. Half the masthead's height; the title does not repeat at display size. | p2+ |
| **Footer** | 1px rule, then generated-date + product (left) and `N / total` (right). The only place the product name repeats. | all |

---

## §3 Per-document specs

### 3.1 Transcript — `.docx` / `.pdf` · tone `lav`
| Rule | Detail |
|---|---|
| Timestamp column, not inline | fixed **78px** column carries time + speaker; the utterance keeps a single left edge, so scanning down for a moment stays possible on paper where there is no search |
| Speaker as text, not colour | the screen tints avatars sky/rose; print **names** them. A photocopy must still identify who spoke. |
| Turns never split mid-sentence | a page break between turns is fine, inside one is not — keep-together on the block, not orphan control on the line |
| Speakers block earns page one | whoever reads a transcript cold needs the cast before the dialogue; it is short, so it costs nothing |
| **No AI summary in the transcript** | the summary is an interpretation, the transcript is a record. Mixing them lets a reader quote the machine as the participant. |
| File name is the title | researchers search by recording name; a prettier title breaks the only link back to the source audio |

### 3.2 `.srt` — no layout, only rules
Speaker in square brackets · **2 lines max** per cue · ~42 characters per line · no styling tags · same turn data as the `.docx`. One source, two renderings.

### 3.3 Desk report — `.docx` / `.pdf` · tone `aqua`
| Rule | Detail |
|---|---|
| Contents block — **and only here** | 10–20 pages with sections a reader jumps between. A transcript is linear and a UT report is four pages; neither earns one. |
| Numbered sections | numbers survive being quoted in an email ("see §3"), which is what happens to this document. Screen can rely on scroll-spy; paper cannot. |
| Every claim keeps its source cell | the tier column is **text** (T1/T2/T3), never a colour dot — a monochrome print must still tell a statistics body from a forum post |
| Gaps are printed, not hidden | the "still to explore" line ships. A report showing only what it found reads as more certain than it is. |
| Appendix is a list, not screenshots | title, publisher, date, tier, URL. Thumbnails would triple the page count and age badly. |

### 3.4 UT insight — `.pdf` · tone `peach`
| Rule | Detail |
|---|---|
| Clips become timestamps + quotes | video cannot print. Each moment ships as timestamp, verbatim quote, and observation — enough to find the clip in the app and to stand alone without it. |
| Estimates keep their tilde | screen dims inferred metrics to 50%; print gives them `~` and `mute` ink, and the section header says so outright |
| Quotes verbatim, in quote marks | these get pasted into decks; any paraphrase would travel as if the participant said it |
| Task outcome before findings | the first question asked of a UT report is whether the participant finished — answer it in the metadata strip, then explain |
| **One participant per document** | multi-participant synthesis is a different artefact with different claims; merging sessions implies a sample size this document does not have |

### 3.5 Recruiting — **no document**
A screener's output is a respondent table: `.csv`, which has no layout to design. Column order, the masked-contact rule and the header row belong in the export registry spec. If a printed shortlist is ever wanted it is a **new document** and needs its own design pass.

---

## §4 State matrix
Documents have no interaction states, but they do have content states the generator must handle:
| State | Treatment |
|---|---|
| Full document | as specified |
| Missing optional section (e.g. no themes) | **omit the section entirely** — never print an empty heading |
| Single-page document | masthead + content + footer; no running header |
| Very long transcript (100+ turns) | unchanged; pagination rules in `GEOMETRY.md §C` carry it |
| Estimated-only metrics | the whole metrics grid takes `~` and mute ink; the header note stays |
| Not drawn | KO-language variant (layout is identical; line-height may need +0.05 for Hangul), landscape, A4-native proofs |

---

## §5 ⚠️ contract-change
1. **`⚠️ contract-change:` the export registry needs per-format layout ownership.** These specs assume one generator per `kind × format`. Confirm the registry is structured that way rather than one generic "render deliverable to docx" path — a generic path cannot honour §3.
2. **`⚠️ contract-change:` documents need fields the list contract lacks.** `DeliverableRow` has no speakers, source tiers, task outcome, or clip list. The document generator reads the **full artifact**, not the row. Confirm that boundary.
3. **`⚠️ contract-change:` page size is a user preference.** Letter is the default here; A4 must be selectable (metric users). One flag, one generator — the layout does not fork.
4. **`⚠️ contract-change:` no watermark is specified.** The brief mentions watermarking for shared views. If exports need one, it is a footer treatment and I will design it — do not improvise one.
5. Fonts must be **embedded** (Outfit, Pretendard) or the document falls back to a system face and the type spec is void.

---

## §6 Open items
- Whether a cover page is ever wanted for a client-delivered desk report (currently: no, the masthead is the cover).
- KO/EN copy for masthead eyebrows and footers.
- Whether `.pdf` and `.docx` differ at all beyond the container — currently they do not, deliberately.
