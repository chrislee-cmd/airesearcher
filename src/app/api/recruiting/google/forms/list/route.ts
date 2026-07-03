import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { RecruitingBrief } from '@/lib/recruiting-schema';

type Criterion = RecruitingBrief['criteria'][number];

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
    criteria?: Criterion[] | null;
    summary?: string | null;
    created_at: string;
  };

  // Tiered select so a not-yet-applied column never blanks the whole
  // list. `criteria`/`summary` land in migration 20260703060414 and
  // `sheet_url` in 20260624032912; production may roll forward at
  // different times (§7.5 migrations don't auto-apply). We try the
  // widest set first and step down one migration at a time on 42703 so
  // that, e.g., a stale `criteria` column doesn't also cost us the
  // `sheet_url` CTA.
  const order = { ascending: false } as const;
  const byUser = (cols: string) =>
    admin
      .from('recruiting_forms')
      .select(cols)
      .eq('user_id', user.id)
      .order('created_at', order);

  let rows: FormRow[] | null = null;
  const full = await byUser(
    'form_id,title,responder_uri,edit_uri,sheet_url,criteria,summary,created_at',
  );
  if (!full.error) {
    rows = (full.data ?? []) as unknown as FormRow[];
  } else if (full.error.code === '42703') {
    // criteria/summary not yet migrated — keep sheet_url CTA working.
    const mid = await byUser(
      'form_id,title,responder_uri,edit_uri,sheet_url,created_at',
    );
    if (!mid.error) {
      rows = (mid.data ?? []) as unknown as FormRow[];
    } else if (mid.error.code === '42703') {
      // sheet_url also missing — degrade to the legacy column set so the
      // widget still renders existing forms (CTA disabled).
      const legacy = await byUser(
        'form_id,title,responder_uri,edit_uri,created_at',
      );
      if (legacy.error) {
        console.error('forms_list_legacy_failed', legacy.error);
        return NextResponse.json(
          { error: legacy.error.message },
          { status: 500 },
        );
      }
      rows = (legacy.data ?? []) as unknown as FormRow[];
    } else {
      console.error('forms_list_failed', mid.error);
      return NextResponse.json({ error: mid.error.message }, { status: 500 });
    }
  } else {
    console.error('forms_list_failed', full.error);
    return NextResponse.json({ error: full.error.message }, { status: 500 });
  }

  return NextResponse.json({
    forms: rows.map((r) => ({
      formId: r.form_id,
      title: r.title,
      responderUri: r.responder_uri,
      editUri: r.edit_uri,
      sheetUrl: r.sheet_url ?? null,
      criteria: r.criteria ?? null,
      summary: r.summary ?? null,
      createdAt: r.created_at,
    })),
  });
}
