import type { SupabaseClient } from '@supabase/supabase-js';

// OBS-3 리크루팅 라이프사이클 status FSM (migration 20260710145818).
// Single source of truth for the states a recruiting_forms row moves through:
//   published  → the Google Form was created + shared (create route)
//   extracting → persona-fit judging of responses is running (judgments route)
//   extracted  → judging finished for the current response set
//   error      → an extraction run failed
// 'draft' is reserved for a future server-side draft-save; no route emits it yet.
export type RecruitingFormStatus =
  | 'draft'
  | 'published'
  | 'extracting'
  | 'extracted'
  | 'error';

// Best-effort status transition. Callers must have already proven ownership of
// `formId` (create route: authed publish; judgments route: resolveFormAccess),
// so this writes with the service-role admin client and never gates the primary
// operation on the result.
//
// The write is tolerant of the status column not yet existing: a preview env
// can publish/judge before `supabase db push` lands this PR's migration (§7.5),
// which surfaces as Postgres 42703 or PostgREST PGRST204. We swallow that as a
// diagnostic breadcrumb instead of failing an otherwise-healthy publish/extract
// — mirroring the criteria-persist fallback in the create route.
export async function setRecruitingFormStatus(
  admin: SupabaseClient,
  formId: string,
  status: RecruitingFormStatus,
): Promise<void> {
  const { error } = await admin
    .from('recruiting_forms')
    .update({ status })
    .eq('form_id', formId);
  if (!error) return;
  const code = error.code;
  const msg = error.message ?? '';
  const missingColumn =
    code === '42703' || (code === 'PGRST204' && /status/.test(msg));
  if (missingColumn) {
    console.warn('recruiting_form_status_missing_column', formId, status);
  } else {
    console.error('recruiting_form_status_update_failed', formId, error);
  }
}
