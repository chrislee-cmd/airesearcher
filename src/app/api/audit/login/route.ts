import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

// Records login_success / login_failure audit events fired by the
// email/password client form. We deliberately ignore client-supplied
// user_id / email — the server reads the just-set Supabase session
// cookies via getUser() instead. For login_failure (no session yet),
// we accept the attempted email but mark it as untrusted in metadata.

type Body = {
  event_type: 'login_success' | 'login_failure';
  email?: string;
  reason?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (
    body.event_type !== 'login_success' &&
    body.event_type !== 'login_failure'
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (body.event_type === 'login_success') {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) {
      // Client claimed success but cookies say otherwise — log as failure.
      await logAudit({
        event_type: 'login_failure',
        actor_email: body.email ?? null,
        metadata: { reason: 'no_session_on_server', client_claimed: 'success' },
        request,
      });
      return NextResponse.json({ ok: true });
    }
    await logAudit({
      event_type: 'login_success',
      user_id: user.id,
      actor_email: user.email ?? null,
      metadata: { method: 'password' },
      request,
    });
  } else {
    await logAudit({
      event_type: 'login_failure',
      actor_email: body.email ?? null,
      metadata: {
        method: 'password',
        reason: body.reason ?? 'unknown',
        // The email is unverified at failure time — anyone can hit this
        // endpoint with any address. Stored as a lead, not as identity.
        email_unverified: true,
      },
      request,
    });
  }

  return NextResponse.json({ ok: true });
}
