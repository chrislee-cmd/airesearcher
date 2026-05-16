import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const maxDuration = 30;

// Super-admin-only. Returns all bank_transfer payments with status filter.
// Returns 404 for non-admins so the route's existence isn't probeable.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') ?? 'pending';

  const admin = createAdminClient();
  const query = admin
    .from('payments')
    .select(`
      id,
      org_id,
      user_id,
      bundle_id,
      credits,
      amount_krw,
      method,
      status,
      bank_reference,
      tax_invoice,
      created_at,
      paid_at,
      organizations ( name )
    `)
    .eq('method', 'bank_transfer')
    .order('created_at', { ascending: false })
    .limit(200);

  if (statusFilter !== 'all') {
    query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[admin/payments] query error', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payments: data ?? [] }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
