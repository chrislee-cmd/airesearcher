import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const maxDuration = 30;

// Marks a bank-transfer payment as paid and grants credits.
// Authorized for: (a) super-admins, or (b) org members with role >= 'admin'.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from('payments')
    .select('id, org_id, method, status')
    .eq('id', id)
    .single();
  if (!payment) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (payment.method !== 'bank_transfer') {
    return NextResponse.json({ error: 'wrong_method' }, { status: 400 });
  }

  const superAdmin = isSuperAdminEmail(user.email);
  if (!superAdmin) {
    // Fall back to org-level admin check.
    const { data: roleCheck } = await supabase.rpc('has_org_role', {
      p_org: payment.org_id,
      p_min: 'admin',
    });
    if (!roleCheck) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const { error } = await admin.rpc('grant_credits_from_payment', {
    p_payment_id: payment.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
