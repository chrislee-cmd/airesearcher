// AI 동시통역 — issue a download for an unlocked session recording.
//
// One unlock charge unlocks all five formats keyed off the recording
// row:
//   - format=m4a-input   → AAC/MP4 audio of the host's SOURCE stream
//                          (mic or tab audio, no translated TTS),
//                          transcoded on-demand from `input_storage_key`
//   - format=m4a-output  → AAC/MP4 audio of the TRANSLATED TTS stream
//                          (no source mix), transcoded on-demand from
//                          `storage_key`
//   - format=zip-input   → ZIP containing source-language transcript
//                          (.txt + .docx, "원문" only — input rows)
//   - format=zip-output  → ZIP containing translated transcript
//                          (.txt + .docx, "통역본" only — realtime
//                          interpreter's output rows)
//   - format=zip-revised → ZIP containing post-hoc batch re-translation
//                          (.txt + .docx, "재번역" only — input rows'
//                          revised_text column populated by /revise).
//                          409 if the host hasn't triggered revision yet.
//
// The transcript zips are generated on-the-fly from `translate_messages`
// (no storage). The original webms are what we persist in
// `audio-uploads`; the m4a is regenerated on demand so we don't pay for
// storage twice. 402 if the recording row isn't downloadable yet
// (status not `uploaded`/`unlocked`). 410 + auto-refund on the m4a path
// when the storage object has been swept (past retention).
//
// Legacy back-compat: rows created BEFORE migration 0024 have
// `input_storage_key=NULL` and a single mixed webm at `storage_key`.
// For those rows:
//   - `m4a-output` (and the legacy alias `m4a`) returns the mixed file
//     and works end-to-end.
//   - `m4a-input` returns 404 with `error=input_audio_unavailable`.
//     The UI surfaces a localized message; no refund because the
//     transcript zips and output-m4a deliverables all still work for
//     that unlock.

import { NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits';
import {
  renderTranslateTranscriptDocx,
  renderTranslateTranscriptText,
  type TranscriptMessage,
  type TranscriptMeta,
} from '@/lib/translate-transcript';
import { transcodeWebmToM4a } from '@/lib/translate-audio';

export const runtime = 'nodejs';
// Transcode for a ~30 min session runs ~10–20 s on Vercel's Fluid
// Compute; bump the budget to keep headroom for the txt/docx fast
// paths too.
export const maxDuration = 120;

// Allowed download formats. Source-side artifacts (m4a-input 원문 audio,
// zip-input 원문 transcript) are intentionally NOT allowed: the source ASR
// is unreliable Korean (replacement chars / foreign-script intrusions /
// dropped syllables — no source-language hint is possible on the
// translations endpoint, see src/lib/openai-realtime.ts), so we don't ship
// it as a deliverable. The host console dropped the buttons; rejecting the
// formats here also closes direct-URL access. The downstream m4a-input /
// zip-input handler branches below are now unreachable (kept inert rather
// than risk-editing the transcode/zip paths the output formats share).
const FORMATS = new Set([
  'm4a-output',
  'zip-output',
  'zip-revised',
]);

type Format =
  | 'm4a-input'
  | 'm4a-output'
  | 'zip-input'
  | 'zip-output'
  | 'zip-revised';

// Filename stems for the kind-filtered transcript zips. Localized per
// host UI locale so the file the user sees on disk matches the button
// they clicked.
const ZIP_STEMS: Record<
  'ko' | 'en' | 'ja' | 'th',
  { input: string; output: string; revised: string }
> = {
  ko: { input: '원문', output: '통역본', revised: '재번역' },
  en: { input: 'source', output: 'translation', revised: 'revised' },
  ja: { input: '原文', output: '通訳', revised: '再翻訳' },
  th: { input: 'source', output: 'translation', revised: 'revised' },
};

// Legacy alias: pre-split clients (and any direct-link old URLs) request
// `format=m4a`. Treat as `m4a-output` so the persisted single mixed file
// keeps working without a redirect chain.
function normalizeFormat(raw: string): Format | null {
  if (raw === 'm4a') return 'm4a-output';
  if (FORMATS.has(raw)) return raw as Format;
  return null;
}

// Locale comes from the `Accept-Language` short prefix the console sends
// in a custom header — we don't have access to the request URL's locale
// segment here. Falls back to 'ko'.
function pickLocale(req: Request): TranscriptMeta['locale'] {
  const raw = req.headers.get('x-app-locale')?.toLowerCase() ?? '';
  if (raw === 'en' || raw === 'ja' || raw === 'th' || raw === 'ko') return raw;
  return 'ko';
}

// We split session lookup from revision_status lookup so the common
// path (zip-input / zip-output) keeps working even if the
// `revision_status` column hasn't been applied to prod yet (migration
// 20260627000000). Without this split, a missing column made the
// session select fail silently and the route returned a generic
// `session_not_found` 404 — which is exactly the symptom the host
// reported. See task pr-fix-translate-recordings-410-404.
async function loadTranscript(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
): Promise<{
  meta: Pick<TranscriptMeta, 'sourceLang' | 'targetLang' | 'startedAt'>;
  messages: TranscriptMessage[];
} | null> {
  const session = await admin
    .from('translate_sessions')
    .select('id, source_lang, target_lang, started_at')
    .eq('id', sessionId)
    .maybeSingle<{
      id: string;
      source_lang: string;
      target_lang: string;
      started_at: string | null;
    }>();
  if (session.error) {
    console.error('[translate-download] session lookup failed', {
      session_id: sessionId,
      error: session.error.message,
    });
    return null;
  }
  if (!session.data) return null;

  // Read in batches in case the session is very long. RPC isn't needed
  // — we're on service role.
  const PAGE = 1000;
  const messages: TranscriptMessage[] = [];
  let cursor: string | null = null;
  // PROJECT.md §7.5 resilience. PR-T2 (`speaker`) and PR-T3
  // (`revised_text`) added new columns; if those migrations haven't
  // been pushed to this environment, Postgres returns 42703 and we'd
  // silently return an empty transcript. Fall back to the base columns
  // so the host at least gets the source/target text.
  let useBaseCols = false;
  // Use ts-based cursor pagination to stay deterministic even when many
  // rows share the same second.
  // Most translate sessions stay under a few hundred lines; this loop is
  // effectively single-page.
  // We sort ascending by ts so the interleaved bilingual file reads in
  // the original speaking order.
  for (let i = 0; i < 50; i++) {
    let q = admin
      .from('translate_messages')
      .select(
        useBaseCols
          ? 'kind, text, lang, ts'
          : 'kind, text, lang, speaker, revised_text, ts',
      )
      .eq('session_id', sessionId)
      .order('ts', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('ts', cursor);
    const { data, error } = await q;
    if (error) {
      if (
        !useBaseCols &&
        error.code === '42703' &&
        /speaker|revised_text/.test(error.message)
      ) {
        console.warn('[translate-download] new columns missing — falling back to base SELECT', {
          session_id: sessionId,
          error: error.message,
        });
        useBaseCols = true;
        continue;
      }
      console.error('[translate-download] messages select failed', {
        session_id: sessionId,
        error: error.message,
      });
      break;
    }
    if (!data || data.length === 0) break;
    const rows = data as unknown as TranscriptMessage[];
    for (const row of rows) messages.push(row);
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].ts;
  }

  return {
    meta: {
      sourceLang: session.data.source_lang,
      targetLang: session.data.target_lang,
      startedAt: session.data.started_at,
    },
    messages,
  };
}

// Read `revision_status` separately so the column-not-found case only
// affects the zip-revised path (the only branch that needs it).
async function loadRevisionStatus(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
): Promise<'idle' | 'pending' | 'done' | 'failed' | null> {
  const { data, error } = await admin
    .from('translate_sessions')
    .select('revision_status')
    .eq('id', sessionId)
    .maybeSingle<{ revision_status: 'idle' | 'pending' | 'done' | 'failed' | null }>();
  if (error) {
    console.error('[translate-download] revision_status lookup failed', {
      session_id: sessionId,
      error: error.message,
    });
    return null;
  }
  return data?.revision_status ?? 'idle';
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: recordingId } = await ctx.params;
  const url = new URL(req.url);
  // Default fallback is `m4a-output` (the translated TTS file). Legacy
  // `?format=m4a` callers are silently rewritten to `m4a-output` so a
  // pre-PR-#183 saved URL keeps working against post-split rows AND
  // legacy single-file rows.
  const formatRaw = (url.searchParams.get('format') ?? 'm4a-output').toLowerCase();
  const format = normalizeFormat(formatRaw);
  if (!format) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from('translate_recordings')
    .select(
      'id, org_id, host_user_id, status, storage_key, input_storage_key, session_id',
    )
    .eq('id', recordingId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Host-only download — teammates need to ask the host to forward the
  // signed URL / file. Avoids leaking paid assets to org members who
  // didn't pay.
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Default-save: downloads are free once the recording is finalized
  // ('uploaded'). The 통역 시작 75-credit lump already covers save +
  // download, so there's no separate unlock charge. 'unlocked' is still
  // accepted for rows finalized under the old paid scheme. 'recording'
  // (still uploading) and 'failed' stay gated.
  if (row.status !== 'uploaded' && row.status !== 'unlocked') {
    return NextResponse.json({ error: 'locked' }, { status: 402 });
  }

  // ── m4a-input / m4a-output: download the persisted webm for the
  // requested track, transcode with ffmpeg, stream the resulting MP4-AAC
  // bytes. We can't use a signed URL because the file on storage is
  // webm/Opus and players will choke on a renamed container — we have
  // to actually re-mux + re-encode.
  if (format === 'm4a-input' || format === 'm4a-output') {
    // Pick the right storage key. For legacy rows (input_storage_key
    // NULL) `m4a-input` returns 404 — see the comment block at the top
    // of the file for the rationale (no refund: other deliverables
    // still satisfy the unlock).
    const storageKey =
      format === 'm4a-input' ? row.input_storage_key : row.storage_key;
    if (!storageKey) {
      return NextResponse.json(
        { error: 'input_audio_unavailable' },
        { status: 404 },
      );
    }

    const trackLabel = format === 'm4a-input' ? 'input' : 'output';

    const { data: blob, error: dlErr } = await admin.storage
      .from('audio-uploads')
      .download(storageKey);

    if (dlErr || !blob) {
      // 410 path: storage object is gone (swept or never finalized).
      // Refund so the host isn't out the credits. We only refund for
      // the `output` (legacy + canonical) path; if just the input track
      // is missing, the txt/docx/output deliverables still work, so we
      // surface a soft 410 without refund.
      if (format === 'm4a-input') {
        return NextResponse.json(
          { error: 'object_missing' },
          { status: 410 },
        );
      }
      const refund = await refundCredits(
        row.org_id,
        row.host_user_id,
        'translate',
        recordingId,
      );
      return NextResponse.json(
        { error: 'object_missing', refunded: refund.ok },
        { status: 410 },
      );
    }

    try {
      const webmBytes = new Uint8Array(await blob.arrayBuffer());
      const m4aBytes = await transcodeWebmToM4a(webmBytes);
      // Copy into a freshly-allocated ArrayBuffer so the Body type is a
      // plain ArrayBuffer the Web `BodyInit` union accepts under strict
      // TS (same pattern the docx branch uses below).
      const ab = new ArrayBuffer(m4aBytes.byteLength);
      new Uint8Array(ab).set(m4aBytes);
      return new NextResponse(ab, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Disposition': `attachment; filename="translate-${row.session_id}-${trackLabel}.m4a"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      console.error('[translate-download] transcode failed', err);
      return NextResponse.json(
        { error: 'transcode_failed' },
        { status: 500 },
      );
    }
  }

  // ── zip-input / zip-output / zip-revised: kind-filtered transcript
  // zips generated from translate_messages on the fly. Each zip bundles
  // the txt + docx render of one variant:
  //   zip-input   → source language rows verbatim ("원문")
  //   zip-output  → realtime interpreter's output rows ("통역본")
  //   zip-revised → input rows projected to virtual output rows whose
  //                 text is revised_text (the post-hoc batch translation
  //                 from /revise). 409 if revision never ran.
  const transcript = await loadTranscript(admin, row.session_id);
  if (!transcript) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }

  const locale = pickLocale(req);
  const meta: TranscriptMeta = {
    sessionId: row.session_id,
    sourceLang: transcript.meta.sourceLang,
    targetLang: transcript.meta.targetLang,
    startedAt: transcript.meta.startedAt,
    locale,
  };

  let filtered: TranscriptMessage[];
  let stem: string;
  let labelSuffix: string;

  if (format === 'zip-revised') {
    const revisionStatus = await loadRevisionStatus(admin, row.session_id);
    if (revisionStatus !== 'done') {
      return NextResponse.json(
        {
          error: 'revision_unavailable',
          revision_status: revisionStatus,
        },
        { status: 409 },
      );
    }
    // Project input rows to virtual output rows whose text is the
    // revised translation. Skip rows where revised_text is missing
    // (the model declined or the row was added after revision ran).
    filtered = transcript.messages
      .filter((m) => m.kind === 'input' && (m.revised_text ?? '').trim().length > 0)
      .map((m) => ({
        ...m,
        kind: 'output' as const,
        text: m.revised_text ?? '',
        lang: meta.targetLang,
      }));
    stem = ZIP_STEMS[locale].revised;
    labelSuffix = 'revised';
  } else {
    const kind: 'input' | 'output' = format === 'zip-input' ? 'input' : 'output';
    filtered = transcript.messages.filter((m) => m.kind === kind);
    stem = ZIP_STEMS[locale][kind];
    labelSuffix = kind;
  }

  const txt = renderTranslateTranscriptText(meta, filtered);
  const docx = await renderTranslateTranscriptDocx(meta, filtered);

  const docxBytes = new Uint8Array(docx.buffer, docx.byteOffset, docx.byteLength);
  // fflate works with Uint8Arrays. Copy the docx slice to detach it from
  // the Node Buffer pool so the zip output is a clean owned buffer.
  const docxCopy = new Uint8Array(docxBytes.byteLength);
  docxCopy.set(docxBytes);

  const zipped = zipSync({
    [`${stem}.txt`]: strToU8(txt),
    [`${stem}.docx`]: docxCopy,
  });

  const zipBuf = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(zipBuf).set(zipped);

  return new NextResponse(zipBuf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="translate-${row.session_id}-${labelSuffix}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
