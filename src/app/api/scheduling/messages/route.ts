import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfBatch,
  ownerOfCandidate,
  ownerAllowed,
  resolveBatchScope,
  resolveProjectScope,
} from '@/lib/scheduling/access';
import {
  isMessageScope,
  MAX_MESSAGE_LENGTH,
  SCHED_MESSAGE_COLUMNS,
  SCHED_MESSAGE_COLUMNS_NARROW,
  widenNarrowMessage,
  type MessageScope,
  type SchedMessage,
} from '@/lib/scheduling/messages';
import { isSolapiConfigured } from '@/lib/sms/solapi';
import { notifyBySms } from '@/lib/scheduling/sms-notify';

// SMS 알림 링크의 origin 을 요청에서 산출. Vercel 프록시 뒤에서는 request.url 이
// 내부 URL 일 수 있어 x-forwarded-* 를 우선한다. 링크는 공개 참여자 뷰
// (/schedule/<share_token>) 로 향한다.
function resolveOrigin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

// Recruiting-scheduling chat (PR3), admin side. Same gate as the other
// /api/scheduling/* routes: non-admins get 404 (route stays unobservable) and
// all reads/writes go through the service-role client after isSuperAdminEmail.
// Participant send/read is PR4 — this route only ever creates admin rows.

// Wide→narrow fallback for a `.or()`-filtered read: run the wide select, and if
// the broadcast-mode columns aren't present yet (preview DB predating the
// migration), retry with the narrow set and widen the rows. `narrowOrFilter`
// omits any batch_id predicate (which can't exist without the column). Returns
// the normalized messages or null on a genuine error.
async function readMessages(
  admin: ReturnType<typeof createAdminClient>,
  wideOrFilter: string,
  narrowOrFilter: string,
  limit: number,
): Promise<SchedMessage[] | null> {
  const wide = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS)
    .or(wideOrFilter)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!wide.error) return (wide.data ?? []) as unknown as SchedMessage[];

  const narrow = await admin
    .from('sched_messages')
    .select(SCHED_MESSAGE_COLUMNS_NARROW)
    .or(narrowOrFilter)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (narrow.error) return null;
  return (narrow.data ?? []).map((r) => widenNarrowMessage(r));
}

// GET — list messages for the admin chat panel.
//   ?batch=<id>          → global broadcast + this batch's group broadcast +
//                          every private thread for that batch's candidates
//   ?candidate_id=<id>   → one private thread
//   (neither)            → broadcast only (global + every group)
export async function GET(request: Request) {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batch');
  const candidateId = url.searchParams.get('candidate_id');

  const admin = createAdminClient();

  // Single private thread. No batch_id predicate, so wide and narrow filters
  // match; readMessages still handles the column-absent select fallback.
  if (candidateId) {
    if (!access.superadmin) {
      const owner = await ownerOfCandidate(admin, candidateId);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }
    const filter = `candidate_id.eq.${candidateId}`;
    const messages = await readMessages(admin, filter, filter, 5000);
    if (!messages) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Whole batch: global broadcast (batch_id null) + THIS batch's group broadcast
  // (batch_id = batchId) + private threads for this batch's candidates. The batch
  // filter keeps other groups' announcements out of this scope. Two-step .in()
  // rather than a PostgREST embed — sched_messages and sched_batches have no
  // direct FK (§7.10).
  if (batchId) {
    if (!access.superadmin) {
      const owner = await ownerOfBatch(admin, batchId);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }
    const { data: candRows, error: candErr } = await admin
      .from('sched_candidates')
      .select('id')
      .eq('batch_id', batchId)
      .limit(2000);
    if (candErr) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    const candidateIds = (candRows ?? []).map((c) => c.id as string);
    const privateClause =
      candidateIds.length > 0
        ? `,candidate_id.in.(${candidateIds.join(',')})`
        : '';

    // Resolve the project this batch belongs to so the 전체 broadcast (batch_id
    // null) can be scoped to it — the fix for the cross-project leak (a global
    // broadcast previously OR-ed in for EVERY project). A project belongs to one
    // org, so scoping to project_id transitively isolates orgs too; we therefore
    // do NOT AND an org_id predicate onto the read (a stored org_id that ever
    // diverged from the viewing batch's would hide an in-project message —
    // conservative regression-0 choice; org_id is still recorded on writes for a
    // future hardened filter). When project_id can't be resolved (preview DB
    // predating the column), the clause degrades to the legacy unscoped global.
    const batchScope = await resolveBatchScope(admin, batchId);
    const globalScope = batchScope?.project_id
      ? `,project_id.eq.${batchScope.project_id}`
      : '';

    // Wide: THIS project's global + this-group broadcasts + private threads.
    // Narrow (preview DB without batch_id): every broadcast + private — group /
    // project scoping simply can't apply until the columns exist, which is
    // acceptable for the preview.
    const wideFilter =
      `and(candidate_id.is.null,batch_id.is.null${globalScope}),` +
      `and(candidate_id.is.null,batch_id.eq.${batchId})` +
      privateClause;
    const narrowFilter = `candidate_id.is.null${privateClause}`;
    const messages = await readMessages(admin, wideFilter, narrowFilter, 10000);
    if (!messages) {
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
    }
    return NextResponse.json(
      { messages },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Broadcast only (global + every group). Global/group broadcasts carry no
  // owner link, so an unscoped read would leak other tenants' announcements —
  // an org member must scope by batch. Return empty here (super-admin unchanged).
  if (!access.superadmin) {
    return NextResponse.json(
      { messages: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const filter = 'candidate_id.is.null';
  const messages = await readMessages(admin, filter, filter, 5000);
  if (!messages) {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { messages },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — admin sends a message.
//   { scope: 'broadcast', body, is_announcement?, batch_id? }
//        → candidate_id null. is_announcement (default true) picks banner vs
//          bubble; batch_id (default null) picks 전체 vs 그룹별 reach.
//   { scope: 'private', candidate_id, body }
//        → 1:1 thread (is_announcement/batch_id ignored — always announcement/global).
export async function POST(request: Request) {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const scope: MessageScope = isMessageScope(b.scope) ? b.scope : 'broadcast';
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'empty_body' }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'body_too_long' }, { status: 400 });
  }

  // Enforce the scope↔candidate_id invariant in code (the DB CHECK backstops).
  let candidateId: string | null = null;
  if (scope === 'private') {
    candidateId = typeof b.candidate_id === 'string' ? b.candidate_id : '';
    if (!candidateId) {
      return NextResponse.json({ error: 'candidate_required' }, { status: 400 });
    }
  }

  // Broadcast axes. Private always renders as an announcement to its one
  // candidate (batch is meaningless there), so only read them for broadcast.
  const isAnnouncement =
    scope === 'broadcast' ? b.is_announcement !== false : true;
  const batchId =
    scope === 'broadcast' && typeof b.batch_id === 'string' && b.batch_id
      ? b.batch_id
      : null;

  // SMS 알림 opt-in(발송 시 체크박스). notify_sms=true 면 메시지 저장 성공 후
  // 서버가 대상 후보의 전화번호로 알림 문자를 발송한다. sms_context_batch_id 는
  // 전체 reach(batch_id null)에서 프로젝트를 특정하기 위한 컨텍스트 batch(타일
  // batchId) — 메시지 row 에는 반영되지 않는다.
  const notifySms = b.notify_sms === true;
  const smsContextBatchId =
    typeof b.sms_context_batch_id === 'string' && b.sms_context_batch_id
      ? b.sms_context_batch_id
      : null;

  const admin = createAdminClient();

  // A global broadcast (batch_id null) reaches every tenant's participants, so
  // an org member must target a batch they own — super-admin keeps the global.
  if (!access.superadmin && scope === 'broadcast' && !batchId) {
    return NextResponse.json({ error: 'batch_required' }, { status: 400 });
  }

  // For private, confirm the candidate exists (clean 404 vs. FK error) + scope.
  // Capture the candidate's batch so the message can be anchored to its project.
  let candidateBatchId: string | null = null;
  if (scope === 'private') {
    const { data: candidate } = await admin
      .from('sched_candidates')
      .select('id, batch_id')
      .eq('id', candidateId)
      .maybeSingle();
    if (!candidate) {
      return NextResponse.json(
        { error: 'candidate_not_found' },
        { status: 404 },
      );
    }
    candidateBatchId = (candidate.batch_id as string | null) ?? null;
    if (!access.superadmin) {
      const owner = await ownerOfCandidate(admin, candidateId!);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json(
          { error: 'candidate_not_found' },
          { status: 404 },
        );
      }
    }
  }

  // For a group send, confirm the batch exists (clean 400 vs. FK error) + scope.
  if (batchId) {
    const { data: batch } = await admin
      .from('sched_batches')
      .select('id')
      .eq('id', batchId)
      .maybeSingle();
    if (!batch) {
      return NextResponse.json({ error: 'batch_not_found' }, { status: 400 });
    }
    if (!access.superadmin) {
      const owner = await ownerOfBatch(admin, batchId);
      if (!ownerAllowed(access, owner)) {
        return NextResponse.json({ error: 'batch_not_found' }, { status: 400 });
      }
    }
  }

  // 전체 broadcast + SMS: 프로젝트를 특정하는 컨텍스트 batch 의 소유권을 확인한다
  // (임의 batch 를 넣어 타 테넌트 프로젝트로 문자를 뿌리는 것 방지). 그룹 broadcast
  // 는 batchId 자체가 위에서 검증되고, private 는 candidate 소유권이 검증됐다.
  let smsContextAllowed = smsContextBatchId;
  if (notifySms && scope === 'broadcast' && !batchId && smsContextBatchId) {
    const owner = await ownerOfBatch(admin, smsContextBatchId);
    if (!access.superadmin && !ownerAllowed(access, owner)) {
      smsContextAllowed = null; // 소유 아님 → 전체 SMS 스킵(메시지 저장은 진행).
    }
  }

  // Anchor the message to its project (+ org) so reads can scope it — the fix
  // for the cross-project/-account leak. Derive server-side from the batch or
  // the candidate's batch; the 전체 broadcast (batch_id null) has no server
  // anchor, so the client passes the current project_id, which we verify the
  // caller owns (org member: project owner in scope; super-admin: any). An
  // unverifiable / absent project_id leaves the anchor null (degrades to the
  // legacy global, but the read filter then excludes it from other projects).
  let projectId: string | null = null;
  let orgId: string | null = null;
  if (scope === 'private' && candidateBatchId) {
    const bs = await resolveBatchScope(admin, candidateBatchId);
    projectId = bs?.project_id ?? null;
    orgId = bs?.org_id ?? null;
  } else if (batchId) {
    const bs = await resolveBatchScope(admin, batchId);
    projectId = bs?.project_id ?? null;
    orgId = bs?.org_id ?? null;
  } else {
    const claimed =
      typeof b.project_id === 'string' && b.project_id ? b.project_id : null;
    if (claimed) {
      const ps = await resolveProjectScope(admin, claimed);
      if (ps && (access.superadmin || ownerAllowed(access, ps.owner_user_id))) {
        projectId = claimed;
        orgId = ps.org_id;
      }
    }
  }

  const baseRow = {
    candidate_id: candidateId,
    scope,
    // PR3 is admin-only; participant send is PR4.
    sender_role: 'admin' as const,
    sender_user_id: access.userId,
    body: text,
  };

  const wide = await admin
    .from('sched_messages')
    .insert({
      ...baseRow,
      is_announcement: isAnnouncement,
      batch_id: batchId,
      project_id: projectId,
      org_id: orgId,
    })
    .select(SCHED_MESSAGE_COLUMNS)
    .single();

  let data = wide.data;
  let error = wide.error;

  // Preview DB predating the broadcast-mode columns — retry with the pre-modes
  // row. The message degrades to a global announcement (banner, everyone); the
  // migration restores full mode fidelity once applied.
  if (error) {
    const narrow = await admin
      .from('sched_messages')
      .insert(baseRow)
      .select(SCHED_MESSAGE_COLUMNS_NARROW)
      .single();
    data = narrow.data
      ? (widenNarrowMessage(narrow.data) as unknown as typeof data)
      : null;
    error = narrow.error;
  }

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  // SMS 알림 후처리 — 메시지 저장이 성공한 뒤에만, best-effort 로. 어떤 실패도
  // 위 저장을 되돌리지 않는다(하드 제약). 규제 메모: 일정 안내는 정보성 메시지라
  // 광고 표기·080 수신거부 불요. per-candidate 수신거부 플래그는 백로그(스팸 신고
  // 대비 후속).
  const smsFields: Record<string, unknown> = {};
  if (notifySms) {
    if (!isSolapiConfigured()) {
      smsFields.smsSkipped = 'not_configured';
    } else {
      const outcome = await notifyBySms(admin, {
        scope,
        // 문구 {공지|메시지}: broadcast 공지만 '공지', 그 외(broadcast 채팅·private)
        // 는 '메시지'.
        announcementWord: scope === 'broadcast' && isAnnouncement,
        candidateId,
        messageBatchId: batchId,
        contextBatchId: smsContextAllowed,
        origin: resolveOrigin(request),
      });
      if (outcome.status === 'sent') {
        smsFields.smsSent = outcome.smsSent;
        smsFields.smsFailed = outcome.smsFailed;
      } else {
        smsFields.smsSkipped = outcome.reason;
        smsFields.smsTargetCount = outcome.targetCount;
      }
    }
  }

  return NextResponse.json(
    { message: data, ...smsFields },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
