import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Removes the form from the user's recruiting_forms list. We do NOT
// delete the underlying Google Form — the user may still want to read
// or close it on their own; this endpoint is purely about hiding the
// card from the recruiting responses panel.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) {
    return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('recruiting_forms')
    .delete()
    .eq('form_id', formId)
    .eq('user_id', user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
