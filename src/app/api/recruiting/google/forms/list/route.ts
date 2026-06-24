import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Returns all forms this user has published from the recruiting page,
// newest first. The UI uses the list to render one card per form with
// its own response panel.
//
// Resilience: the `sheet_url` / `sheet_id` columns were added in
// migration `20260624032912_recruiting_forms_sheet.sql`. Per
// PROJECT.md §7.5 supabase migrations don't auto-apply on deploy, so
// production rolls forward only after a manual `supabase db push`.
// When that lag hits, the wider select throws `42703 undefined_column`
// and the widget previously surfaced a 500 polled every 30 s (console
// spam + empty list). We now fall back to the column set guaranteed
// since 0013, with sheetUrl coerced to null, so the recruiting widget
// stays functional until the new columns land.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  type FormRow = {
    form_id: string;
    title: string | null;
    responder_uri: string | null;
    edit_uri: string | null;
    sheet_url?: string | null;
    created_at: string;
  };

  const full = await admin
    .from('recruiting_forms')
    .select('form_id,title,responder_uri,edit_uri,sheet_url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  let rows: FormRow[] = [];
  if (full.error) {
    if (full.error.code === '42703') {
      // sheet_url column not yet migrated — degrade to the legacy
      // column set so the widget renders existing forms with the
      // "시트 연결" CTA disabled.
      const legacy = await admin
        .from('recruiting_forms')
        .select('form_id,title,responder_uri,edit_uri,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (legacy.error) {
        console.error('forms_list_legacy_failed', legacy.error);
        return NextResponse.json({ error: legacy.error.message }, { status: 500 });
      }
      rows = (legacy.data ?? []) as FormRow[];
    } else {
      console.error('forms_list_failed', full.error);
      return NextResponse.json({ error: full.error.message }, { status: 500 });
    }
  } else {
    rows = (full.data ?? []) as FormRow[];
  }

  return NextResponse.json({
    forms: rows.map((r) => ({
      formId: r.form_id,
      title: r.title,
      responderUri: r.responder_uri,
      editUri: r.edit_uri,
      sheetUrl: r.sheet_url ?? null,
      createdAt: r.created_at,
    })),
  });
}
