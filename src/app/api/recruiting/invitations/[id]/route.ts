import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const maxDuration = 30;

// PATCH /api/recruiting/invitations/[id]
// Super-admin-only status update as the request is fulfilled (sent / declined /
// archived) with an optional note. Returns 404 for non-admins so the route
// isn't probeable (same pattern as the GET listing).
const Body = z.object({
  status: z.enum(['sent', 'declined', 'archived']),
  admin_note: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const update: {
    status: 'sent' | 'declined' | 'archived';
    processed_at: string;
    admin_note?: string | null;
  } = {
    status: parsed.data.status,
    processed_at: new Date().toISOString(),
  };
  if (parsed.data.admin_note !== undefined) {
    update.admin_note = parsed.data.admin_note;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('recruiting_invitations')
    .update(update)
    .eq('id', id)
    .select('id, status, admin_note, processed_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No row matched the id.
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[recruiting/invitations/[id]] update error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invitation: data });
}
