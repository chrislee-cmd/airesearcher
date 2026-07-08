// probing_sessions.persona_snapshot — 공유 시점 페르소나 스냅샷 저장
// (PR: probing-persona-share-snapshot-persist).
//
// PUT — 사용자가 프로빙 위젯에서 "공유" 를 누를 때(공유 생성/갱신 시점),
// probing-card 의 in-memory reflection(8+custom) + 생성 질문을 payload 로 받아
// 자기 probing_sessions row 의 persona_snapshot jsonb 에 저장한다. 이 스냅샷을
// 공유 뷰어(#476)가 read-only 로 로드해 페르소나 그리드 + 질문을 렌더한다.
//
// per-user single row(user_id UNIQUE) 라 update 로 충분 — 공유 버튼은
// research_context 가 저장돼 row(probingSessionId) 가 있을 때만 활성이므로
// 여기 도달하면 row 는 이미 존재한다. RLS(probing_sessions_own_update)가
// user_id gate. shape 계약은 src/lib/probing-persona-snapshot.ts 가 SSOT.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { probingPersonaSnapshotSchema } from '@/lib/probing-persona-snapshot';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function PUT(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = probingPersonaSnapshotSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // 자기 row 만 갱신 — RLS 가 user_id gate. row 없으면(공유 버튼이 비활성일
  // 흐름) update 는 no-op 로 빈 결과 → 404 로 알린다.
  const { data, error } = await supabase
    .from('probing_sessions')
    .update({
      persona_snapshot: parsed.data,
      snapshot_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select('id, snapshot_at')
    .maybeSingle();
  if (error) {
    console.error('[probing/persona-snapshot] update failed', error);
    return NextResponse.json({ error: 'snapshot_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'no_session' }, { status: 404 });
  }
  return NextResponse.json({ id: data.id, snapshot_at: data.snapshot_at });
}
