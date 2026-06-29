import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  refreshAccessToken,
  hasResponsesScope,
} from '@/lib/google-oauth';
import {
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';
import { getFormResponses } from '@/lib/google-forms';
import {
  filterConsentedRows,
  findConsentColumn,
  partitionContactColumns,
  stripContactAnswers,
} from '@/lib/recruiting/contact-filter';

export const maxDuration = 60;

// Pulls the current responses for a single form. Caller proves
// ownership by being the user_id linked to the form row in
// recruiting_forms; we never let one user read another's responses.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });
  const url = new URL(req.url);
  const countOnly = url.searchParams.get('count_only') === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  // Pull owner_email alongside ownership so we can decide between the
  // admin token (forms published under chris.lee) and the requesting
  // user's OAuth token (legacy per-user publishes). Both paths still
  // enforce user_id ownership — admin proxy never lets one user see
  // another user's recruit responses just because chris.lee technically
  // owns every sheet.
  // owner_email may not exist yet in older environments (schema-cache
  // PGRST204). Try the wide select first; on a column-missing error,
  // fall back to the legacy lookup so the page doesn't 500.
  let ownerEmail: string | null = null;
  let ownershipFound = false;
  const wide = await admin
    .from('recruiting_forms')
    .select('form_id, owner_email')
    .eq('form_id', formId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (wide.data) {
    ownershipFound = true;
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
      .select('form_id')
      .eq('form_id', formId)
      .eq('user_id', user.id)
      .maybeSingle();
    ownershipFound = !!narrow.data;
  }
  if (!ownershipFound) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  }

  // owner_email is the routing key: when it matches the configured
  // admin email we know the form lives in the admin Drive, so we must
  // fetch with the admin token (the user has no OAuth row at all in
  // admin-proxy mode). Older rows have owner_email=null and were
  // published by the requesting user's own OAuth — fall back to the
  // per-user token so legacy responses keep loading.
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
      .select('refresh_token,scope')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!oauth?.refresh_token) {
      return NextResponse.json(
        { error: 'google_not_connected' },
        { status: 412 },
      );
    }
    if (!hasResponsesScope(oauth.scope)) {
      return NextResponse.json(
        { error: 'reconsent_required' },
        { status: 412 },
      );
    }
    try {
      const { access_token } = await refreshAccessToken(oauth.refresh_token);
      accessToken = access_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  try {
    const result = await getFormResponses(accessToken, formId);
    // Compliance gate: drop rows where the respondent did not consent
    // (or where the form lacks a consent column — legacy forms published
    // before the consent gate landed will return null here and pass
    // through unchanged so old data stays visible).
    const consentColumn = findConsentColumn(result.columns);
    const consentedRows = filterConsentedRows(result.rows, consentColumn);
    if (countOnly) {
      return NextResponse.json({
        count: consentedRows.length,
        total: result.rows.length,
      });
    }
    // Privacy: strip contact columns (phone number / email) before the
    // payload reaches the browser. The attendee-review modal also filters
    // them visually, but the server-side strip is the authoritative cut
    // — never trust that the client filter alone is sufficient. Also
    // hide the consent column itself — every visible row is "동의합니다"
    // by construction so the column carries no recruiter-useful signal.
    const { visible, hiddenQuestionIds } = partitionContactColumns(result.columns);
    if (consentColumn) hiddenQuestionIds.add(consentColumn.questionId);
    const visibleColumns = consentColumn
      ? visible.filter((c) => c.questionId !== consentColumn.questionId)
      : visible;
    const rows = stripContactAnswers(consentedRows, hiddenQuestionIds);
    return NextResponse.json({
      ...result,
      columns: visibleColumns,
      rows,
      total: result.rows.length,
      consented: consentedRows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
