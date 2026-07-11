// 프로빙 세션 녹음 메타 row insert (#554).
//
// 클라이언트(use-realtime-transcription)가 종료 시 blob 을 probing-session-audio
// 버킷에 직접 업로드(storage self-upload RLS)한 뒤, 이 라우트로 메타 row 를
// 남긴다. org_id 는 서버에서만 신뢰 가능(getActiveOrg = 쿠키 기반)하므로
// 클라이언트가 아니라 여기서 해석해 넣는다. 서비스 롤이 아니라 유저 세션
// supabase 클라이언트로 insert 해 RLS(own_insert)를 그대로 통과시킨다.
//
// 비블로킹 부가물: 이 insert 가 실패해도 세션 종료·다운로드(signed URL)는
// 스토리지만으로 동작한다. 클라이언트는 실패를 toast 로만 표면화한다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    session_id?: unknown;
    storage_key?: unknown;
    mime?: unknown;
    size_bytes?: unknown;
    duration_seconds?: unknown;
  };

  const sessionId =
    typeof body.session_id === 'string' && UUID_RE.test(body.session_id)
      ? body.session_id
      : null;
  const storageKey =
    typeof body.storage_key === 'string' ? body.storage_key : null;
  if (!sessionId || !storageKey) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  // storage_key 는 반드시 이 유저의 prefix 로 시작해야 한다 (버킷 RLS 와
  // 정합 — forged key 로 타 유저 파일을 참조하는 row 를 못 만들게).
  if (!storageKey.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'forbidden_key' }, { status: 403 });
  }

  const mime = typeof body.mime === 'string' ? body.mime : 'audio/webm';
  const sizeBytes =
    typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes)
      ? Math.round(body.size_bytes)
      : null;
  const durationSeconds =
    typeof body.duration_seconds === 'number' &&
    Number.isFinite(body.duration_seconds)
      ? Math.round(body.duration_seconds)
      : null;

  const { data: row, error } = await supabase
    .from('probing_session_recordings')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      session_id: sessionId,
      storage_key: storageKey,
      mime,
      size_bytes: sizeBytes,
      duration_seconds: durationSeconds,
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.warn('[probing/recordings] insert failed', {
      session_id: sessionId,
      error: error.message,
    });
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ id: row.id, created_at: row.created_at });
}
