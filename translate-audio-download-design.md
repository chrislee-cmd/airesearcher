# AI 동시통역 — Paid Audio + Transcript Download (PR-B)

> **PR #183 — revised 2026-05-30: split capture into source-only +
> translated-only.** The original mixed-audio design (single
> `MediaRecorder` mixing host source + TTS) is replaced by two
> independent recorders. One unlock now produces FOUR deliverables: two
> audio files plus the two transcripts. Pricing is unchanged (25
> credits flat, single charge, all four files).

Design doc for the recording-capture + paywalled download CTA layered on
top of the GA AI 동시통역 feature (PR #181 prompter view).

## Goal

After a finished `translate` session, the host can pay **25 credits flat**
to unlock four downloadables for that session:

1. **`.m4a` (source / input)** — host mic-or-tab source audio with no
   translated TTS mixed in. Captured client-side via a dedicated
   `MediaRecorder` as `audio/webm;codecs=opus` and transcoded on-demand
   to AAC/MP4 by the download endpoint.
2. **`.m4a` (translated / output)** — translated TTS only. Captured by
   a second dedicated `MediaRecorder` fed by the WebRTC remote-track
   audio that's also being republished into LiveKit.
3. **`.txt`** — bilingual transcript (input + output kinds interleaved
   by timestamp, `[hh:mm:ss] [원문]/[통역] …`).
4. **`.docx`** — the same transcript rendered through the existing
   `markdownToDocx`-style design-system template (Pretendard, 4px
   radius, editorial cover/eyebrow).

The raw webms are what we persist in storage; the m4a is regenerated
each request so we don't pay double storage cost for the small fraction
of sessions that get downloaded. `.txt` and `.docx` are generated
on-the-fly from `translate_messages` — no caching.

One unlock charge unlocks **all four formats** for that session — the
buyer doesn't get nickel-and-dimed per format.

Viewer side: a permanent "host-only" badge once the session ended. No
purchase path on the anon viewer.

## UI integration with PR #181 prompter

PR #181 shipped a **single-column prompter view** (`translate-console.tsx`
for host, `translate-viewer.tsx` for viewer). There is no longer a two-pane
source/translated layout to hang things off.

The download CTA is rendered as a **standalone panel that appears after
`stop()`** — below the prompter, above the page footer. States:

```
┌─────────────────────────────────────────────────┐
│  세션 산출물                                       │
│  오디오 + 전사록 다운로드 (잠김 · 25크레딧)            │
│  [잠금 해제하기]                                   │
└─────────────────────────────────────────────────┘
```

After unlock:

```
┌────────────────────────────────────────────────────────────────────┐
│  세션 산출물 · 잠금 해제됨                                            │
│  [원문 오디오 (.m4a)]  [통역 오디오 (.m4a)]                          │
│  [전사록 (.txt)]       [전사록 (.docx)]                              │
└────────────────────────────────────────────────────────────────────┘
```

`flex-wrap` keeps the four buttons readable on narrow screens — they
wrap into a 2×2 grid below ~640px wide.

The prompter layout itself is untouched. The TTS mute toggle stays
exactly where PR #181 placed it.

## Capture approach: client-side `MediaRecorder` (chosen)

Same trade-off as the original design:

| Option | Pros | Cons |
| --- | --- | --- |
| **Client `MediaRecorder`** | No infra. Reuses existing `audio-uploads` Supabase bucket + signed-URL pattern. Captures exactly what the host hears. | Host closes the tab → recording lost. We surface a "recording in progress" pill. |
| **LiveKit Cloud Egress** | Survives host tab crash. | New webhook receiver + S3 + Egress credentials + env-var matrix. Out of scope. |

Chrome desktop only (matches the tab-audio constraint that already lives
in PR #181's input-source picker).

### Capture graph (recording — two MediaRecorders)

`translate-console.tsx` already has a `MediaStreamDestinationNode`
(`audioDestRef`) used to republish the OpenAI translated TTS into LiveKit.
**We do NOT reuse that destination** — `MediaRecorder` reading the same
node the LiveKit publish reads has produced silent/glitchy `.webm` files
in testing.

Instead we add **two** dedicated `MediaStreamDestinationNode`s, one per
track. Each feeds its own `MediaRecorder`:

```
host source (mic or tab) ─┬─► OpenAI WebRTC publish
                          └─► recordInputDest  ──► MediaRecorder(input)  ──► chunks ──► Storage (input_storage_key)
translated TTS ─┬─► LiveKit publish
                └─► recordOutputDest ──► MediaRecorder(output) ──► chunks ──► Storage (storage_key)
```

Both recorders start in the SAME tick after the audio graph is wired so
the two webm timelines align within an audio frame. The destinations
are on the same `AudioContext` as the LiveKit-publish graph, so the
source nodes are created with `ctx.createMediaStreamSource` against the
same `stream` / `mic` — no cross-context re-emission tricks needed.

MIME: `audio/webm;codecs=opus`. Chunked uploads use `MediaRecorder`'s
`start(timeslice)` with `timeslice = 5000` (5s chunks). We accumulate
the `Blob` chunks in-browser and PUT each final `.webm` once to its
own signed upload URL on `stop()`. Streaming partial chunks would
require an S3 multipart-equivalent which Supabase Storage doesn't
expose — and the per-track file sizes (~1MB per minute at Opus
32kbps) make a single PUT cheap.

## Storage

Bucket: reuse `audio-uploads` (provisioned in migration 0004).

Path:
- `<host_user_id>/translate-recordings/<session_id>-<ts>-output.webm`
  (translated TTS) — stored in the existing `storage_key` column.
- `<host_user_id>/translate-recordings/<session_id>-<ts>-input.webm`
  (host source) — stored in the new `input_storage_key` column added
  by migration `0024_translate_recording_input_key.sql`.

The existing per-user RLS keyed on `(storage.foldername(name))[1] =
auth.uid()::text` covers upload and read; no new policy. Service role
bypasses for the signed download.

Retention: 30 days. Cron sweep is DEBT (out of scope).

`.txt` and `.docx` are **NOT** stored — they're generated on-the-fly from
`translate_messages` whenever the host clicks Download. Small payload,
deterministic from the source rows, no point caching.

Download is **always** served as a signed URL (10-minute TTL) for
`.webm` — never expose `storage.from().getPublicUrl()`. `.txt` / `.docx`
stream directly from the API route body.

## Pricing

**25 credits flat per session unlock.** Same charge unlocks all three
formats — the recording row is the unit of payment, not the format.

Rationale:
- The deliverable is conceptually a transcript (audio + bilingual text).
  Per PROJECT.md §11 the 전사록 (transcript) generator is 25 credits, so
  unlocking a translate transcript is priced the same. Consistent mental
  model across deliverable features.
- Flat pricing avoids gaming via stop+restart and matches how other
  "purchased deliverable" features in this product price.

Charged via `spendCreditsAdminAmount(orgId, userId, 'translate', 25,
generationId=recordingId)`. The existing partial-UNIQUE on
`credit_transactions` (migration 0021) makes the same recordingId
idempotent — duplicate unlock clicks won't double-charge.

Refunds: not offered on unlocks (consistent with other "purchased
deliverable" flows). Exception: 410 path (storage object missing past
sweep) auto-refunds the original charge via `credit_refund` RPC.

## Schema (migrations 0023 + 0024)

```sql
-- 0023_translate_recordings.sql
create table public.translate_recordings (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.translate_sessions(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  host_user_id    uuid not null references auth.users(id),
  storage_key     text not null,             -- OUTPUT (translated) webm path
  mime_type       text not null default 'audio/webm',
  size_bytes      bigint,
  duration_sec    integer,
  status          text not null default 'recording'
                  check (status in ('recording','uploaded','unlocked','failed')),
  unlocked_at     timestamptz,
  credits_spent   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 0024_translate_recording_input_key.sql
alter table public.translate_recordings
  add column input_storage_key text;          -- INPUT (source) webm path
```

`input_storage_key` is nullable so legacy rows (created before 0024)
keep working: the download endpoint treats `input_storage_key IS NULL`
as a "no separate source audio" signal and returns 404 +
`input_audio_unavailable` for that single format only. The remaining
three deliverables (m4a-output, txt, docx) still satisfy the unlock,
so no refund is issued.

Sizes / durations: each PATCH finalize merges into the row by SUM (for
`size_bytes`) and MAX (for `duration_sec`). The row stays the unit of
payment and there is no per-track child table.

`status='unlocked'` is the only state the download endpoint accepts for
ANY of the three formats — text exports key off the same row, so a host
who doesn't pay can't grab the transcript through a side door.

RLS:
- Org members can SELECT (so teammates see "host has paid for export" status).
- Host can INSERT/UPDATE their own rows.
- Service role bypasses for the unlock + download flow.

## API routes

| Route | Verb | Purpose |
| --- | --- | --- |
| `/api/translate/sessions/[id]/recording` | `GET`   | Read latest recording row for the session (re-renders CTA on reload). |
| `/api/translate/sessions/[id]/recording` | `POST`  | Body `{ kind: 'input' \| 'output' }` (default `output`). Creates or extends the row + returns a signed upload URL for that kind's webm. The first call creates the row, the second attaches the other key. |
| `/api/translate/sessions/[id]/recording` | `PATCH` | Finalize (called once per track): merges `size_bytes` (sum) + `duration_sec` (max) into the row and flips status → `uploaded`. |
| `/api/translate/recordings/[id]/unlock`  | `POST`  | Charge 25 credits, flip status → `unlocked`. Idempotent. |
| `/api/translate/recordings/[id]/download?format=m4a-input`  | `GET` | Downloads the input (source) `.webm` from `input_storage_key`, transcodes to AAC/MP4, streams. 402 if not unlocked. 404 + `input_audio_unavailable` if legacy row (no input key). 410 if object missing (no refund — other deliverables still satisfy the unlock). |
| `/api/translate/recordings/[id]/download?format=m4a-output` | `GET` | Downloads the output (translated) `.webm` from `storage_key`, transcodes to AAC/MP4, streams. 402 if not unlocked. 410 + refund if object missing. Legacy alias `?format=m4a` maps to this. |
| `/api/translate/recordings/[id]/download?format=txt`        | `GET` | Streams the bilingual transcript as `text/plain; charset=utf-8`. 402 if not unlocked. |
| `/api/translate/recordings/[id]/download?format=docx`       | `GET` | Streams the rendered `.docx`. 402 if not unlocked. |

All `runtime='nodejs'`, host-only (host_user_id match), maxDuration=30.

## UI states (host)

1. **Pre-session** — checkbox `오디오 + 전사록 저장 (다운로드 시 +25 크레딧)` (default on).
2. **Live** — small `● 녹음 중` pill next to the elapsed timer. Pill
   flips on once EITHER recorder is active and only flips off once
   BOTH have stopped.
3. **After stop + upload finalize** — locked CTA panel below the
   prompter: `원문/통역 오디오 + 전사록 다운로드 (잠김 · 25크레딧) [잠금 해제]`.
4. **After unlock** — four buttons in a `flex-wrap` row:
   `[원문 오디오 (.m4a)] [통역 오디오 (.m4a)] [전사록 (.txt)] [전사록 (.docx)]`
   + `잠금 해제됨` pill. On screens narrower than ~640px the row wraps
   into a 2×2 grid.

The recording state is restored from the `GET .../recording` endpoint on
mount, so a reload after stop still shows the CTA.

## UI states (viewer)

Single locked-only badge under the audio mode switcher, visible only when
the session has ended: `오디오 다운로드는 호스트만 가능` /
"Audio download is host-only". No purchase button.

## Text transcript format

### `.txt`

```
# Research-Canvas 동시통역 전사록
세션: <session_id>
날짜: 2026-05-30
원어: 한국어 → 번역: English

[00:00:03] [원문]   안녕하세요, 오늘 인터뷰에 참여해주셔서 감사합니다.
[00:00:05] [통역]   Hello, thank you for participating in today's interview.
[00:00:12] [원문]   먼저 간단한 자기소개를 부탁드리겠습니다.
[00:00:14] [통역]   First, could you please give us a brief self-introduction?
…
```

Tags localized per the host's UI locale: `[원문]`/`[통역]` (ko),
`[source]`/`[output]` (en/ja/th — keep English tags everywhere except ko
to avoid CJK in plain text on non-ko exports).

Timestamp `hh:mm:ss` is the offset from `started_at` (falls back to
absolute clock if `started_at` is null).

### `.docx`

Same content, rendered through a new helper
`src/lib/translate-transcript.ts → renderTranslateTranscriptDocx()`.
Reuses the design-system tokens from `src/lib/transcripts/docx.ts` (1px
amore accent, UPPERCASE eyebrow, Pretendard / Sarabun / Inter font
fallback for KO/TH/EN respectively).

## Failure modes

- Upload fails mid-session: row stays `recording`. Host sees `녹음 저장 실패`,
  CTA hidden. No charge.
- Host closes tab: MediaRecorder fires nothing further; finalize never runs.
  Row stays `recording` forever; sweep cron (DEBT) deletes it later.
- Unlock charge succeeds but storage object missing on webm download: 410
  Gone + auto-refund via `credit_refund` RPC. Text/docx still work because
  they don't depend on the storage object.

## Reused from prior worker

- `supabase/migrations/0023_translate_recordings.sql` — kept as-is.
- `POST /sessions/[id]/recording` and `PATCH ...recording` — kept as-is.
- `POST /recordings/[id]/unlock` — kept as-is.
- `GET /recordings/[id]/download` — **extended** to handle `?format=txt|docx`
  in addition to the original `.webm` signed-URL path.

## Out of scope (followups)

- LiveKit Egress fallback for crash-safe capture.
- Cron sweep of stale `recording` rows + 30-day expiry on `unlocked` blobs.
- Viewer-side purchase path (would need anon payments — not worth it yet).
- Translated-only or original-only export options.
- PDF export (docx is the editable format users want).
