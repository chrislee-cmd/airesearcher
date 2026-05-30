// AI 동시통역 — issue a download for an unlocked session recording.
//
// One unlock charge unlocks all three formats keyed off the recording
// row:
//   - format=webm  → 10-min signed URL into the `audio-uploads` bucket
//   - format=txt   → bilingual transcript streamed as text/plain
//   - format=docx  → bilingual transcript streamed as docx
//
// txt + docx are generated on-the-fly from `translate_messages` (no
// storage). 402 if the recording row isn't `unlocked`. 410 + auto-refund
// on the webm path when the storage object has been swept (past
// retention).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits';
import {
  renderTranslateTranscriptDocx,
  renderTranslateTranscriptText,
  type TranscriptMessage,
  type TranscriptMeta,
} from '@/lib/translate-transcript';

export const runtime = 'nodejs';
export const maxDuration = 30;

const DOWNLOAD_TTL_SECONDS = 600; // 10 minutes

const FORMATS = new Set(['webm', 'txt', 'docx']);

type Format = 'webm' | 'txt' | 'docx';

// Locale comes from the `Accept-Language` short prefix the console sends
// in a custom header — we don't have access to the request URL's locale
// segment here. Falls back to 'ko'.
function pickLocale(req: Request): TranscriptMeta['locale'] {
  const raw = req.headers.get('x-app-locale')?.toLowerCase() ?? '';
  if (raw === 'en' || raw === 'ja' || raw === 'th' || raw === 'ko') return raw;
  return 'ko';
}

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
  if (!session.data) return null;

  // Read in batches in case the session is very long. RPC isn't needed
  // — we're on service role.
  const PAGE = 1000;
  const messages: TranscriptMessage[] = [];
  let cursor: string | null = null;
  // Use ts-based cursor pagination to stay deterministic even when many
  // rows share the same second.
  // Most translate sessions stay under a few hundred lines; this loop is
  // effectively single-page.
  // We sort ascending by ts so the interleaved bilingual file reads in
  // the original speaking order.
  for (let i = 0; i < 50; i++) {
    let q = admin
      .from('translate_messages')
      .select('kind, text, lang, ts')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('ts', cursor);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    for (const row of data as TranscriptMessage[]) messages.push(row);
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].ts;
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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: recordingId } = await ctx.params;
  const url = new URL(req.url);
  const formatRaw = (url.searchParams.get('format') ?? 'webm').toLowerCase();
  if (!FORMATS.has(formatRaw)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }
  const format = formatRaw as Format;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from('translate_recordings')
    .select('id, org_id, host_user_id, status, storage_key, session_id')
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
  if (row.status !== 'unlocked') {
    return NextResponse.json({ error: 'locked' }, { status: 402 });
  }

  // ── webm: signed URL into audio-uploads ──
  if (format === 'webm') {
    const { data: signed, error: signedErr } = await admin.storage
      .from('audio-uploads')
      .createSignedUrl(row.storage_key, DOWNLOAD_TTL_SECONDS, {
        download: `translate-${row.session_id}.webm`,
      });

    if (signedErr || !signed?.signedUrl) {
      // 410 path: storage object is gone (swept or never finalized).
      // Refund so the host isn't out the credits.
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

    return NextResponse.json({
      download_url: signed.signedUrl,
      expires_in: DOWNLOAD_TTL_SECONDS,
    });
  }

  // ── txt / docx: generated from translate_messages on the fly ──
  const transcript = await loadTranscript(admin, row.session_id);
  if (!transcript) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }

  const meta: TranscriptMeta = {
    sessionId: row.session_id,
    sourceLang: transcript.meta.sourceLang,
    targetLang: transcript.meta.targetLang,
    startedAt: transcript.meta.startedAt,
    locale: pickLocale(req),
  };

  if (format === 'txt') {
    const text = renderTranslateTranscriptText(meta, transcript.messages);
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="translate-${row.session_id}.txt"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // format === 'docx'
  const buf = await renderTranslateTranscriptDocx(meta, transcript.messages);
  // Copy into a freshly-allocated ArrayBuffer so the Body type is a
  // plain ArrayBuffer (not a Node Buffer pool slice or
  // SharedArrayBuffer-tinted view that the Web `BodyInit` union
  // rejects under strict TS).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return new NextResponse(ab, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="translate-${row.session_id}.docx"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
