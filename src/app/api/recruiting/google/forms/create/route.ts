import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken } from '@/lib/google-oauth';
import { createGoogleForm } from '@/lib/google-forms';
import { surveySchema } from '@/lib/survey-schema';

export const maxDuration = 60;

const Body = z.object({ survey: surveySchema });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('user_google_oauth')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row?.refresh_token) {
    return NextResponse.json({ error: 'google_not_connected' }, { status: 412 });
  }

  let accessToken: string;
  try {
    const { access_token } = await refreshAccessToken(row.refresh_token);
    accessToken = access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  try {
    const result = await createGoogleForm(accessToken, parsed.data.survey);
    // Persist so the responses panel can render across refreshes and
    // the auto-poll knows which forms to fetch for this user.
    await admin.from('recruiting_forms').upsert({
      form_id: result.formId,
      user_id: user.id,
      title: parsed.data.survey.title || '',
      responder_uri: result.responderUri,
      edit_uri: result.editUri,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'forms_create_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
