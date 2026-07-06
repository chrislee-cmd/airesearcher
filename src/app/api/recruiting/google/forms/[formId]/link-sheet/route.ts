import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  GoogleInvalidGrantError,
  refreshAccessToken,
  hasSheetsScope,
} from '@/lib/google-oauth';
import { GOOGLE_REAUTH_URL } from '@/lib/recruiting/form-access';
import {
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';
import { createGoogleSheet } from '@/lib/share/google-sheets';
import { getFormResponses } from '@/lib/google-forms';

export const maxDuration = 60;

// Creates a companion Google Sheet for an already-published form and
// stores its URL on the form row. Used as the fallback when (a) the
// form was published before this feature shipped, or (b) the original
// publish call couldn't create a sheet because the user hadn't yet
// granted the Sheets scope. The Sheet is seeded with the question
// titles + every response currently in the form so the user lands on
// a populated spreadsheet rather than a blank header row.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) {
    return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  // owner_email may be missing pre-migration. Try wide select then fall
  // back so the link-sheet button stays functional through the deploy
  // window where the new column hasn't propagated yet.
  let form: { form_id: string; title: string | null; sheet_url: string | null } | null = null;
  let ownerEmail: string | null = null;
  const wide = await admin
    .from('recruiting_forms')
    .select('form_id, title, sheet_url, owner_email')
    .eq('form_id', formId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (wide.data) {
    form = {
      form_id: wide.data.form_id,
      title: wide.data.title ?? null,
      sheet_url: wide.data.sheet_url ?? null,
    };
    ownerEmail =
      (wide.data as { owner_email?: string | null }).owner_email ?? null;
  } else if (wide.error) {
    const code = wide.error.code;
    const msg = wide.error.message ?? '';
    const isMissingOwnerEmail =
      code === '42703' ||
      (code === 'PGRST204' && /owner_email/.test(msg));
    if (!isMissingOwnerEmail) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const narrow = await admin
      .from('recruiting_forms')
      .select('form_id, title, sheet_url')
      .eq('form_id', formId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (narrow.data) {
      form = {
        form_id: narrow.data.form_id,
        title: narrow.data.title ?? null,
        sheet_url: narrow.data.sheet_url ?? null,
      };
    }
  }
  if (!form) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  }
  if (form.sheet_url) {
    // Idempotent — return existing URL when already linked.
    return NextResponse.json({ sheetUrl: form.sheet_url });
  }

  // Mirror the create endpoint's routing: admin-proxy forms get linked
  // sheets in the admin Drive; legacy per-user publishes keep using
  // the requesting user's OAuth token.
  const adminEmail = getAdminEmail();
  const useAdminToken =
    isAdminProxyConfigured() &&
    ownerEmail !== null &&
    adminEmail !== null &&
    ownerEmail === adminEmail;

  let accessToken: string;
  if (useAdminToken) {
    try {
      accessToken = await getAdminAccessToken();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'admin_token_refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } else {
    const { data: oauth } = await admin
      .from('user_google_oauth')
      .select('refresh_token, scope')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!oauth?.refresh_token) {
      return NextResponse.json(
        { error: 'google_not_connected' },
        { status: 412 },
      );
    }
    if (!hasSheetsScope(oauth.scope)) {
      return NextResponse.json(
        { error: 'reconsent_required' },
        { status: 412 },
      );
    }
    try {
      const { access_token } = await refreshAccessToken(oauth.refresh_token);
      accessToken = access_token;
    } catch (e) {
      // Revoked/expired refresh_token → user must reconnect. share=1 because
      // linking a sheet needs the Sheets scope superset.
      if (e instanceof GoogleInvalidGrantError) {
        return NextResponse.json(
          {
            error: 'google_reauth_required',
            message: 'Google 재연결이 필요합니다',
            reauth_url: `${GOOGLE_REAUTH_URL}?share=1`,
          },
          { status: 401 },
        );
      }
      const msg = e instanceof Error ? e.message : 'refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  try {
    // Pull live form schema + responses so the new Sheet reflects what
    // the user already has. If response fetch fails (e.g. missing
    // responses scope on an older connection), seed with headers only.
    let headers: string[] = ['응답시각'];
    let rows: string[][] = [];
    try {
      const live = await getFormResponses(accessToken, formId);
      headers = ['응답시각', ...live.columns.map((c) => c.title)];
      rows = live.rows.map((r) => [
        r.lastSubmittedTime,
        ...live.columns.map((c) => r.answers[c.questionId] ?? ''),
      ]);
    } catch {
      // headers-only is fine — sheet is still useful as a target.
    }

    const sheet = await createGoogleSheet(
      accessToken,
      `${form.title || '리서치 설문'} — 응답`,
      [headers, ...rows],
    );
    const { error: upErr } = await admin
      .from('recruiting_forms')
      .update({ sheet_url: sheet.url, sheet_id: sheet.spreadsheetId })
      .eq('form_id', formId)
      .eq('user_id', user.id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    return NextResponse.json({ sheetUrl: sheet.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sheet_link_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
