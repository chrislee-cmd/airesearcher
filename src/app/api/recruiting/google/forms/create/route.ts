import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { refreshAccessToken, hasSheetsScope } from '@/lib/google-oauth';
import {
  ADMIN_REAUTH_ERROR,
  adminReauthErrorBody,
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';
import { decryptStoredRefreshToken } from '@/lib/crypto/oauth-token-store';
import { createGoogleForm } from '@/lib/google-forms';
import { createGoogleSheet } from '@/lib/share/google-sheets';
import { surveySchema, type Survey } from '@/lib/survey-schema';
import { applyStandardBlocks } from '@/lib/recruiting/survey-postprocess';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';
import { setRecruitingFormStatus } from '@/lib/recruiting/form-status';

export const maxDuration = 60;

// The wizard sends the analysed 대상자 조건 alongside the survey so we can
// persist it per-form (fullview 조건 panel reads it back). Optional because
// a survey can be published without a fresh brief (hand-edited flows) and
// older wizard builds omit it — persistence is then skipped.
const Body = z.object({
  survey: surveySchema,
  criteria: recruitingBriefSchema.shape.criteria.optional(),
  summary: z.string().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Admin-proxy mode: every publish lands in GOOGLE_ADMIN_EMAIL's Drive
  // regardless of who clicked "발행". The user never needs to OAuth.
  // When the admin env is unset (local dev, untouched preview) we fall
  // through to the legacy per-user OAuth path so old worktrees keep
  // working without an env migration.
  const adminProxy = await isAdminProxyConfigured();

  let accessToken: string;
  let ownerEmail: string | null = null;
  // Sheets scope is implicit for the admin (consent granted up-front
  // when the refresh token was minted with full SHARE_SCOPES). For the
  // legacy per-user path we still gate on the stored scope string.
  let canCreateSheet = false;

  if (adminProxy) {
    try {
      accessToken = await getAdminAccessToken();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'admin_token_refresh_failed';
      // DB + env admin tokens both exhausted → surface a clean reauth code
      // (never the raw Google invalid_grant) so the client can render the
      // friendly banner + operator self-service CTA.
      if (msg === ADMIN_REAUTH_ERROR) {
        return NextResponse.json(adminReauthErrorBody(user.email), {
          status: 503,
        });
      }
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    ownerEmail = getAdminEmail();
    canCreateSheet = true;
  } else {
    const { data: row } = await admin
      .from('user_google_oauth')
      .select('refresh_token, scope')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!row?.refresh_token) {
      return NextResponse.json(
        { error: 'google_not_connected' },
        { status: 412 },
      );
    }
    try {
      const refreshToken = await decryptStoredRefreshToken(
        admin,
        row.refresh_token,
        { user_id: user.id },
      );
      const { access_token } = await refreshAccessToken(refreshToken);
      accessToken = access_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    canCreateSheet = hasSheetsScope(row.scope);
  }

  // applyStandardBlocks is idempotent — the wizard runs it on the streamed
  // survey too, but we re-apply here so any caller (or any future surface
  // that calls /create directly) cannot publish a form without the standard
  // 인적사항 section, the contact-phone notice, and the privacy-consent gate
  // the recruiting flow promises.
  const survey = applyStandardBlocks(parsed.data.survey);

  try {
    const result = await createGoogleForm(accessToken, survey);
    // Best-effort: create a companion Google Sheet seeded with the
    // form's question titles as headers when the user has the Sheets
    // scope. The Google Forms API does not expose a way to attach an
    // existing Sheet as the form's response destination, so this Sheet
    // is a standalone artifact — recruiting flows still rely on the
    // Forms responses API for the live data, but the widget surfaces
    // this URL as a one-click "응답 시트" CTA. Failures are swallowed:
    // the form is published either way, and the widget shows the
    // "시트 연결" fallback button when sheet_url stays null.
    let sheetUrl: string | null = null;
    let sheetId: string | null = null;
    if (canCreateSheet) {
      try {
        const headers = sheetHeaders(survey);
        const sheet = await createGoogleSheet(
          accessToken,
          `${survey.title || '리서치 설문'} — 응답`,
          [headers],
        );
        sheetUrl = sheet.url;
        sheetId = sheet.spreadsheetId;
      } catch {
        // ignore — keep null and let the UI offer "시트 연결" later
      }
    }
    // Stamp org_id at creation so the dashboard's recruiting count
    // attributes new forms to the user's active org. Older rows can
    // remain null — they show up under "unfiled" until backfilled.
    // getActiveOrg() reads cookies + DB; a transient failure here used
    // to bubble up and trash a successful Google publish, so we tolerate
    // it and persist with org_id=null.
    let activeOrgId: string | null = null;
    try {
      const org = await getActiveOrg();
      activeOrgId = org?.org_id ?? null;
    } catch (orgErr) {
      console.error('forms_create_active_org_failed', orgErr);
    }
    // Two-stage persist: prefer the full row (with sheet_url/sheet_id
    // from migration 20260624032912). When those columns aren't yet
    // applied in this environment, Postgres throws 42703; we fall back
    // to the legacy column set so the published form still lands in
    // recruiting_forms and shows up in the list. Without this fallback
    // the Google Form would be created but invisible to the widget,
    // which the user sees as a stuck "발행중" round-trip.
    const baseRow = {
      form_id: result.formId,
      user_id: user.id,
      org_id: activeOrgId,
      title: survey.title || '',
      responder_uri: result.responderUri,
      edit_uri: result.editUri,
    };
    const fullRow = {
      ...baseRow,
      sheet_url: sheetUrl,
      sheet_id: sheetId,
      owner_email: ownerEmail,
    };
    const upsert = await admin.from('recruiting_forms').upsert(fullRow);
    if (upsert.error) {
      // Postgres native column-not-found is 42703, but supabase-js routes
      // through PostgREST which catches it at the schema-cache layer and
      // surfaces PGRST204 with a "Could not find the 'X' column" message
      // (observed in prod when migration 20260624032912 hadn't landed).
      // Match either code, narrowed to the new columns by message so we
      // don't swallow unrelated PGRST204s. owner_email is the freshest
      // addition (this PR's migration) — preview envs may publish before
      // db push lands, so retry without it as well.
      const errMsg = upsert.error.message ?? '';
      const code = upsert.error.code;
      const isMissingOwnerEmail =
        code === '42703' ||
        (code === 'PGRST204' && /owner_email/.test(errMsg));
      const isMissingSheetColumn =
        code === '42703' ||
        (code === 'PGRST204' && /sheet_(url|id)/.test(errMsg));
      if (isMissingOwnerEmail && !isMissingSheetColumn) {
        const { owner_email: _omit, ...withoutOwnerEmail } = fullRow;
        void _omit;
        const retry = await admin
          .from('recruiting_forms')
          .upsert(withoutOwnerEmail);
        if (retry.error) {
          console.error('forms_create_persist_failed', retry.error);
        }
      } else if (isMissingSheetColumn) {
        const retry = await admin.from('recruiting_forms').upsert(baseRow);
        if (retry.error) {
          console.error('forms_create_persist_failed', retry.error);
        }
      } else {
        console.error('forms_create_persist_failed', upsert.error);
      }
    }
    // Best-effort, additive: stamp the analysed 조건/요약 onto the row so
    // the fullview 조건 panel can render them for this form later (and
    // across refresh / other forms). Kept as a *separate* update so the
    // criteria columns (migration 20260703060414) never entangle with the
    // publish upsert's own fallback — if they aren't applied yet Postgres
    // throws 42703 / PostgREST PGRST204 and we simply skip, leaving the
    // published form fully functional. Criteria then backfill on the next
    // publish once the migration lands.
    // Signals to the client whether the analysed 조건/요약 actually landed on
    // the row. Defaults true (incl. the hand-edited flow that ships no
    // criteria — nothing to persist, nothing failed). Flipped to false on any
    // update failure so the fullview can surface a "재발행" banner instead of
    // silently showing an empty 조건 panel. The publish itself still succeeds.
    let criteriaPersisted = true;
    if (parsed.data.criteria && parsed.data.criteria.length > 0) {
      const meta = await admin
        .from('recruiting_forms')
        .update({
          criteria: parsed.data.criteria,
          summary: parsed.data.summary ?? null,
        })
        .eq('form_id', result.formId);
      if (meta.error) {
        criteriaPersisted = false;
        const code = meta.error.code;
        const msg = meta.error.message ?? '';
        const isMissingCriteria =
          code === '42703' ||
          (code === 'PGRST204' && /criteria|summary/.test(msg));
        if (isMissingCriteria) {
          // Diagnosis breadcrumb (not a hard failure): the publish still
          // succeeded — we just couldn't stamp criteria because migration
          // 20260703060414 isn't applied in this environment. A form
          // published now will show an empty 조건 panel until the column
          // lands + a backfill runs. Logging this distinguishes 원인 1
          // (column truly missing → this fires in prod) from 원인 2 (column
          // present, only *older* rows are null → this never fires). Promoting
          // it to a user-facing error is deferred to a separate spec so a
          // migration lag never breaks an otherwise-healthy publish.
          console.warn(
            'forms_create_criteria_persist_missing_column',
            result.formId,
          );
        } else {
          console.error('forms_create_criteria_persist_failed', meta.error);
        }
      }
    }
    // OBS-3 lifecycle FSM: mark the form 'published'. New rows already default
    // to 'published' (migration 20260710145818), so this is only load-bearing
    // for a *re-publish* (upsert onto an existing form_id that may have moved
    // to extracting/extracted/error) — it resets the funnel state to the truth
    // that a fresh Google Form was just created. Best-effort: never fails the
    // publish (tolerant of the status column not yet applied — §7.5).
    await setRecruitingFormStatus(admin, result.formId, 'published');
    return NextResponse.json({ ...result, sheetUrl, criteriaPersisted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'forms_create_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Flatten the survey's questions in form order, mirroring the column
// order the Forms response API returns. Section titles are dropped
// because the responses sheet only needs question columns.
function sheetHeaders(survey: Survey): string[] {
  const headers = ['응답시각'];
  for (const section of survey.sections) {
    for (const q of section.questions) {
      headers.push(q.title);
    }
  }
  return headers;
}
