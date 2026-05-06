import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  refreshAccessToken,
  hasResponsesScope,
} from '@/lib/google-oauth';
import { getFormResponses } from '@/lib/google-forms';

export const maxDuration = 60;

// Pulls the current responses for a single form. Caller proves
// ownership by being the user_id linked to the form row in
// recruiting_forms; we never let one user read another's responses.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: ownership } = await admin
    .from('recruiting_forms')
    .select('form_id')
    .eq('form_id', formId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!ownership) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  }

  const { data: oauth } = await admin
    .from('user_google_oauth')
    .select('refresh_token,scope')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!oauth?.refresh_token) {
    return NextResponse.json({ error: 'google_not_connected' }, { status: 412 });
  }
  if (!hasResponsesScope(oauth.scope)) {
    return NextResponse.json({ error: 'reconsent_required' }, { status: 412 });
  }

  let accessToken: string;
  try {
    const { access_token } = await refreshAccessToken(oauth.refresh_token);
    accessToken = access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  try {
    const result = await getFormResponses(accessToken, formId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
