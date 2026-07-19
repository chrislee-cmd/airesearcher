// POST /api/ut/sessions/[id]/caption-token → { model, client_secret: { value, expires_at } }
//
// Mints a transcription-only OpenAI Realtime client_secret so the RESEARCHER
// can run LIVE CAPTIONS over the participant's screen while moderating (634).
// The researcher already subscribes to the participant's mic track via the
// viewer-token/LiveKit room (use-ut-remote-session); this route just hands the
// browser an ephemeral secret to tee that audio into OpenAI's streaming STT.
//
// Intentionally the SAME client_secret shape as /api/probing/sessions, MINUS:
//   - credit charge — live captions are a display-only moderation aid, not a
//     billable feature. The authoritative transcript stays the post-session
//     Scribe batch (633); this is best-effort UX and must never bill.
//   - DB rows — captions are volatile (spec §3: not persisted, no dual source).
//
// Language hint = session.input_language (633): the same explicit language
// contract the batch Scribe path uses, converted to the ISO-639-1 base code the
// realtime transcription config accepts. 'multi'/legacy-null → omit (autodetect).
//
// Moderated remote sessions only — unmoderated has no live watch pane (631), so
// no captions. Owner/super-admin gate via loadUtSession (the researcher is an
// authenticated user). Missing OpenAI key → 503 so the client hides captions
// gracefully without disrupting the live watch itself.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { loadUtSession } from '@/lib/ut/auth';
import { getLanguage } from '@/lib/transcripts/languages';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_TTL_SECONDS = 600;

// UI language code ("ko", "en", "zh-TW") → the ISO-639-1 base code the realtime
// transcription config expects (region subtags rejected). Mirrors the iso639
// helper in openai-realtime.ts.
function iso639(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { session } = gate;

  if (session.mode !== 'remote') {
    return NextResponse.json({ error: 'not_remote' }, { status: 400 });
  }
  // Live captions ride the live watch pane, which only exists for moderated
  // sessions. Unmoderated researchers only review after the fact (631).
  if (session.session_kind !== 'moderated') {
    return NextResponse.json({ error: 'not_moderated' }, { status: 400 });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    // Graceful: the client hides captions; the live screen watch is unaffected.
    return NextResponse.json({ error: 'missing_openai_key' }, { status: 503 });
  }

  const transcriptionModel =
    env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe';

  // Language hint from the session (633). getLanguage() resolves legacy-null and
  // stray 'multi' to the 'multi' entry → omit so OpenAI keeps auto-detecting.
  const langEntry = session.input_language
    ? getLanguage(session.input_language)
    : null;
  const language =
    langEntry && langEntry.code !== 'multi' ? iso639(langEntry.code) : null;

  // VAD tuning (637). KEY FACT (validated on preview): the Realtime transcription
  // session transcribes a segment only AFTER the VAD commits it on silence — there
  // is NO live partial transcript mid-speech. So silence_duration_ms is a
  // RESPONSIVENESS knob: a large window means continuous speech rarely commits and
  // almost nothing streams (a 1500ms trial nearly stopped captions). We therefore
  // keep the window SMALL (default 500ms) so every utterance commits promptly and
  // streams completely. The over-segmentation this causes ("저는 지금" / "어." on
  // separate lines) is fixed at the RENDER layer — ut-remote-body joins segments
  // into a flowing rolling transcript — not by widening the VAD. Env-tunable so
  // ops can trade responsiveness for fewer segments without a rebuild.
  //   - server_vad (default): fixed silence window (env: OPENAI_CAPTION_VAD_SILENCE_MS).
  //   - semantic_vad (opt-in): segments on semantic turn completion; same
  //     commit-gated tradeoff, so evaluate on preview before adopting.
  const vadSilenceMs = Number(env.OPENAI_CAPTION_VAD_SILENCE_MS) || 500;
  const turnDetection =
    env.OPENAI_CAPTION_VAD_MODE === 'semantic_vad'
      ? {
          type: 'semantic_vad' as const,
          eagerness: env.OPENAI_CAPTION_VAD_EAGERNESS,
        }
      : {
          type: 'server_vad' as const,
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: vadSilenceMs,
        };

  // Unified Realtime client_secrets — transcription-only mode. Same
  // endpoint/shape as translate + probing.
  const body = {
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model: transcriptionModel,
            ...(language ? { language } : {}),
          },
          turn_detection: turnDetection,
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    console.warn('[ut/caption-token] openai client_secret failed', {
      timeout: timedOut,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: timedOut ? 'openai_session_timeout' : 'openai_unreachable' },
      { status: 504 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `openai_session_failed_${res.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    client_secret?: { value?: string; expires_at?: number } | string;
    value?: string;
    expires_at?: number;
  };
  // OpenAI has returned two shapes here historically — absorb both.
  const cs = json.client_secret;
  const value = typeof cs === 'string' ? cs : cs?.value ?? json.value;
  const expires_at =
    typeof cs === 'object' && cs ? cs.expires_at : json.expires_at;
  if (!value || typeof value !== 'string') {
    return NextResponse.json(
      { error: 'openai_session_invalid_response' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    model: transcriptionModel,
    client_secret: {
      value,
      expires_at:
        expires_at ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS,
    },
  });
}
