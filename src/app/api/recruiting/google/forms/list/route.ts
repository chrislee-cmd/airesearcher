import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Returns all forms this user has published from the recruiting page,
// newest first. The UI uses the list to render one card per form with
// its own response panel.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('recruiting_forms')
    .select('form_id,title,responder_uri,edit_uri,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    forms: (data ?? []).map((r) => ({
      formId: r.form_id,
      title: r.title,
      responderUri: r.responder_uri,
      editUri: r.edit_uri,
      createdAt: r.created_at,
    })),
  });
}
