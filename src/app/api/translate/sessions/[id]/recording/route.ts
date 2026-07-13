// AI 동시통역 — recording lifecycle for a session.
//
// GET    — read the most recent recording for a session (so the host UI
//          can render the locked/unlocked CTA on page reload).
// POST   — create / extend a `translate_recordings` row + return a
//          Supabase Storage signed upload URL. Two tracks are recorded:
//            kind=output  (default, legacy) → host's translated TTS,
//                          stored in `storage_key`
//            kind=input                     → host's source mic/tab audio,
//                          stored in `input_storage_key`
//          The first POST for a session inserts a fresh row; a follow-up
//          POST for the OTHER kind on the same session UPDATEs that row
//          rather than creating a new one. Net: one row per session with
//          both keys populated.
// PATCH  — finalize: the host PATCHes once both MediaRecorders have
//          stopped and both uploads have flushed. We stamp size_bytes
//          (sum of both) / duration_sec (longer of the two) and flip
//          status to 'uploaded' so the UI can show the locked CTA.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { spendCreditsAdminAmount, refundCredits } from '@/lib/credits';
import {
  translateCreditsForAudioSeconds,
  TRANSLATE_METERING,
  TRANSLATE_START_LUMP_CREDITS,
} from '@/lib/features';
import { deriveTranslateTickGenerationId } from '@/lib/translate-billing';

export const runtime = 'nodejs';
export const maxDuration = 30;

// `kind` defaults to 'output' so legacy clients (and the PR-B unit-test
// surface that still POSTs without a body) keep landing on `storage_key`.
const CreateBody = z
  .object({
    kind: z.enum(['input', 'output']).optional(),
  })
  .optional();

const FinalizeBody = z.object({
  recording_id: z.string().uuid(),
  size_bytes: z.number().int().nonnegative(),
  duration_sec: z.number().int().nonnegative(),
});

type SafeFnSession = {
  id: string;
  host_user_id: string;
  org_id: string;
};

async function loadHostSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 } as const;

  const { data, error } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, org_id')
    .eq('id', sessionId)
    .maybeSingle<SafeFnSession>();
  if (error) return { error: error.message, status: 500 } as const;
  if (!data) return { error: 'not_found' as const, status: 404 } as const;
  if (data.host_user_id !== user.id) {
    return { error: 'forbidden' as const, status: 403 } as const;
  }
  return { supabase, user, session: data } as const;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  // Parse body (or query string) for `kind`. Tolerates empty bodies and
  // legacy `?kind=` callers. Default = 'output' to preserve back-compat
  // with the pre-split single-file recorder code path.
  let kind: 'input' | 'output' = 'output';
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get('kind');
    if (fromQuery === 'input' || fromQuery === 'output') {
      kind = fromQuery;
    }
  } catch {}
  try {
    const body = await req.json().catch(() => undefined);
    const parsed = CreateBody.safeParse(body);
    if (parsed.success && parsed.data?.kind) kind = parsed.data.kind;
  } catch {}

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { user, session } = gate;

  const org = await getActiveOrg();
  if (!org || org.org_id !== session.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // The host ownership + org gates above (loadHostSession + getActiveOrg)
  // are the authorization boundary. The actual row write + signed-URL
  // mint go through the service role so a prod RLS drift on
  // translate_recordings (PROJECT.md §7.5 — migrations don't auto-apply)
  // can't silently turn every reserve into `reserve_failed`. This mirrors
  // the /messages + /download routes, which already write via admin for
  // exactly this resilience reason.
  const admin = createAdminClient();

  // Storage path under the host's prefix so the existing per-user RLS on
  // storage.objects (audio-uploads bucket) covers the upload + read. We
  // tag the kind into the filename so the two webm files for one session
  // are visually distinguishable in the bucket.
  const ts = Date.now();
  const storageKey = `${user.id}/translate-recordings/${sessionId}-${ts}-${kind}.webm`;

  // Look for an existing in-flight or finalized row for this session.
  // If one exists, we attach this second track to it rather than
  // creating a parallel row.
  const existing = await admin
    .from('translate_recordings')
    .select('id, status, storage_key, input_storage_key')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    console.error('[translate/recording] existing-row lookup failed', {
      session_id: sessionId,
      error: existing.error.message,
    });
    return NextResponse.json(
      { error: 'recording_lookup_failed', detail: existing.error.message },
      { status: 500 },
    );
  }

  // Only attach to a row that's still mid-flight (status='recording').
  // An already-uploaded or unlocked row belongs to a previous recording
  // attempt — start fresh.
  let recordingId: string;
  if (existing.data && existing.data.status === 'recording') {
    const patch: Record<string, string> = {};
    if (kind === 'output') patch.storage_key = storageKey;
    else patch.input_storage_key = storageKey;
    const upd = await admin
      .from('translate_recordings')
      .update(patch)
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (upd.error || !upd.data) {
      console.error('[translate/recording] row update failed', {
        session_id: sessionId,
        kind,
        error: upd.error?.message,
      });
      return NextResponse.json(
        {
          error: 'recording_update_failed',
          detail: upd.error?.message ?? 'no row returned',
        },
        { status: 500 },
      );
    }
    recordingId = upd.data.id;
  } else {
    const insertPayload: Record<string, string> = {
      session_id: sessionId,
      org_id: session.org_id,
      host_user_id: user.id,
      mime_type: 'audio/webm',
      status: 'recording',
      // storage_key is NOT NULL in the schema. For an input-first POST
      // (rare — current console POSTs output first), seed the column
      // with a placeholder under the host's prefix; the follow-up
      // output POST will overwrite it.
      storage_key:
        kind === 'output'
          ? storageKey
          : `${user.id}/translate-recordings/${sessionId}-${ts}-output-pending.webm`,
    };
    if (kind === 'input') insertPayload.input_storage_key = storageKey;

    const insert = await admin
      .from('translate_recordings')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insert.error || !insert.data) {
      console.error('[translate/recording] row insert failed', {
        session_id: sessionId,
        kind,
        error: insert.error?.message,
      });
      return NextResponse.json(
        {
          error: 'recording_create_failed',
          detail: insert.error?.message ?? 'no row returned',
        },
        { status: 500 },
      );
    }
    recordingId = insert.data.id;
  }

  const { data: signed, error: signedErr } = await admin.storage
    .from('audio-uploads')
    .createSignedUploadUrl(storageKey);
  if (signedErr || !signed) {
    console.error('[translate/recording] signed upload URL mint failed', {
      session_id: sessionId,
      kind,
      bucket: 'audio-uploads',
      error: signedErr?.message,
    });
    return NextResponse.json(
      {
        error: 'storage_unavailable',
        detail: signedErr?.message ?? 'no signed url returned',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    recording_id: recordingId,
    kind,
    storage_key: storageKey,
    upload_url: signed.signedUrl,
    token: signed.token,
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;
  const parsed = FinalizeBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { recording_id, size_bytes, duration_sec } = parsed.data;

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { user } = gate;
  // Service-role finalize for the same §7.5 RLS-drift resilience as POST.
  // The host ownership check below (row.host_user_id === user.id) is the
  // authorization boundary, not the table RLS.
  const admin = createAdminClient();

  // Defensive: only allow finalize on the host's own row, attached to
  // this session.
  const { data: row, error: readErr } = await admin
    .from('translate_recordings')
    .select('id, status, host_user_id, session_id, org_id')
    .eq('id', recording_id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id || row.session_id !== sessionId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'unlocked') {
    // Already paid — don't let a stale finalize overwrite the paid state.
    return NextResponse.json({ ok: true });
  }

  // Aggregate finalize: PATCH is called once per track with that track's
  // own size + duration. We keep the row's stored fields equal to the
  // SUM of sizes and the MAX (longest) of durations so the row is
  // self-describing without joining a per-track table.
  // Fetch current values to merge.
  const current = await admin
    .from('translate_recordings')
    .select('size_bytes, duration_sec, credits_spent')
    .eq('id', recording_id)
    .maybeSingle<{
      size_bytes: number | null;
      duration_sec: number | null;
      credits_spent: number | null;
    }>();
  const prevSize = current.data?.size_bytes ?? 0;
  const prevDur = current.data?.duration_sec ?? 0;
  const prevCredits = current.data?.credits_spent ?? 0;
  const nextSize = prevSize + size_bytes;
  const nextDur = Math.max(prevDur, duration_sec);

  const { error } = await admin
    .from('translate_recordings')
    .update({
      size_bytes: nextSize,
      duration_sec: nextDur,
      status: 'uploaded',
    })
    .eq('id', recording_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── 종료 시 실오디오 정산·보정 (하이브리드 C, docs/pricing-scheme.md §6) ──
  // 진행 중엔 /start(start lump) + /heartbeat(10분 tick)가 wall-clock 기준으로
  // 낙관적 차감을 해뒀다(우측 상단 실시간 count-down). finalize 는 duration_sec
  // 가 확정되는 유일한 지점이라, 여기서 **실오디오 기준 최종 청구(target)** 와
  // **진행 중 이미 차감된 누적(charged)** 을 비교해 정산한다:
  //
  //   target  = translateCreditsForAudioSeconds(duration_sec)  // 실오디오 최종 청구
  //   charged = translate_sessions.credits_charged             // start lump + Σ tick
  //   target > charged  → 부족분(remainder)을 recording_id 로 추가 과금(실오디오
  //                        floor 상향 등 언더차지 보정)
  //   target < charged  → 초과 tick 들을 높은 tick 부터 환불(좀비/침묵 보정) 후,
  //                        floor 잔여분이 있으면 recording_id 로 소액 top-up
  //
  // 결과적으로 세션의 순-차감 = target (실오디오 기준). 좀비/침묵 세션은 진행
  // 중 wall-clock 으로 낙관 차감됐다가 여기서 실오디오 기준으로 환불돼 E1 의
  // "좀비 무영향" 마진 불변식이 최종 결과에서 유지된다.
  //
  // 멱등: charge/refund 모두 deterministic generation_id + partial UNIQUE 로
  // 멱등. target>0 이면 첫 finalize 가 credits_spent(=target)>0 을 stamp 해
  // prevCredits<=0 가드가 재진입을 막고, target==0(순수 좀비)이면 재진입해도
  // 환불이 멱등이라 잔액 왕복이 없다. PATCH 는 트랙당 최대 2회 호출되지만
  // first-PATCH-wins(prevCredits 가드) + 멱등으로 정산은 1회다.
  //
  // best-effort: 세션은 이미 실시간 통역을 전달했으므로, 추가 과금이 잔액
  // 부족이어도 finalize(status='uploaded')는 되돌리지 않는다(로그만).
  // download 라우트의 410 refund 는 recording_id charge(= 정산 remainder)를
  // 환불한다 — 진행 중 heartbeat 차감은 별도 tick genId 라 그대로 유지된다.
  if (prevCredits <= 0) {
    const target = translateCreditsForAudioSeconds(nextDur);

    // 진행 중 누적 차감액(start lump + Σ tick). service-role 로 채워지는 관측/
    // 정산 기준 컬럼(0022). 없으면 0(구세션/미과금 — #1001 이전 동작과 동일).
    const { data: sess } = await admin
      .from('translate_sessions')
      .select('credits_charged')
      .eq('id', sessionId)
      .maybeSingle<{ credits_charged: number | null }>();
    const charged = sess?.credits_charged ?? 0;

    const block = TRANSLATE_METERING.blockCredits;
    const lump = TRANSLATE_START_LUMP_CREDITS;

    // 초과분 환불: 유지할 최상위 tick(keepUpToTick) 위의 tick 들을 되돌린다.
    // target==0(순수 좀비) → keepUpToTick=-1(start lump tick 0 까지 환불).
    // target>0 → keepUpToTick=floor((target-lump)/block) (metered target 은
    // lump+j×block 형태라 정확히 떨어짐; floor-지배 target 의 소수 잔여는 아래
    // remainder top-up 이 흡수).
    const highestTick = Math.max(0, Math.round((charged - lump) / block));
    const keepUpToTick = target <= 0 ? -1 : Math.floor((target - lump) / block);
    let retained = charged;
    if (keepUpToTick < highestTick) {
      for (let n = highestTick; n > keepUpToTick; n--) {
        const genId = deriveTranslateTickGenerationId(sessionId, n);
        // best-effort — gap/미과금 tick 은 not_found 로 무해하게 스킵, 재진입은 멱등.
        await refundCredits(row.org_id, row.host_user_id, 'translate', genId);
      }
      retained = keepUpToTick < 0 ? 0 : lump + keepUpToTick * block;
    }

    // 순-차감을 정확히 target 으로 맞추는 잔여 과금(언더차지/floor 잔여).
    // generation_id = recording_id (download 410 refund 와 정합).
    const remainder = target - retained;
    if (remainder > 0) {
      const spend = await spendCreditsAdminAmount(
        row.org_id,
        row.host_user_id,
        'translate',
        remainder,
        recording_id,
      );
      if (!spend.ok) {
        console.warn('[translate/recording] reconcile top-up failed', {
          session_id: sessionId,
          recording_id,
          duration_sec: nextDur,
          target,
          charged,
          retained,
          remainder,
          reason: spend.reason,
        });
      }
    }

    // 최종 청구액을 stamp + unlock. target==0(좀비)이면 credits_spent 는 0 으로
    // 남고 unlocked_at 도 찍지 않는다(청구 없음 → 잠금해제 대상 아님).
    const stamp: { credits_spent: number; unlocked_at?: string } = {
      credits_spent: target,
    };
    if (target > 0) stamp.unlocked_at = new Date().toISOString();
    await admin
      .from('translate_recordings')
      .update(stamp)
      .eq('id', recording_id);
  }

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;

  const gate = await loadHostSession(sessionId);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  // Read via service role so a translate_recordings RLS drift can't make
  // a real recording read back as "이 세션에는 녹음이 없습니다". The gate
  // above already verified the caller hosts this session.
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('translate_recordings')
    .select('id, status, size_bytes, duration_sec, credits_spent, unlocked_at, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recording: data?.[0] ?? null });
}
