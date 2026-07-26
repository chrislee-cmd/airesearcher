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
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // pill 축(interview_projects) 프로젝트 스코핑. `?project_id=` 가 오면 그
  // 프로젝트에 stamp 된 폼만(`interview_project_id` = migration 20260726070359)
  // 돌려준다 — 이게 "새 프로젝트 = 빈 상태" 를 보장한다. 미지정이면 기존 동작
  // (user 전체) 그대로라 다른 호출부(단독 위젯 등) 회귀 0.
  const projectId =
    new URL(request.url).searchParams.get('project_id')?.trim() || null;

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
  const byUser = (cols: string, filterProject: boolean) => {
    let q = admin
      .from('recruiting_forms')
      .select(cols)
      .eq('user_id', user.id);
    if (projectId && filterProject) {
      q = q.eq('interview_project_id', projectId);
    }
    return q.order('created_at', order);
  };

  // interview_project_id 컬럼(migration 20260726070359)이 아직 prod 에 안 붙은
  // 환경에서는 그 컬럼으로 filter 하면 42703/PGRST204 로 목록 전체가 깨진다.
  // 그 경우만 감지해 필터 없이 재시도(=오늘 동작으로 graceful degrade) — 발행
  // 폼이 안 보이는 500 회귀를 막는다(§7.5 마이그 lag 방어).
  const isMissingProjectCol = (e: { code?: string; message?: string } | null) =>
    !!e &&
    (e.code === '42703' ||
      (e.code === 'PGRST204' && /interview_project_id/.test(e.message ?? '')));

  type TieredResult =
    | { rows: FormRow[] }
    | { missingProjectCol: true }
    | { error: { code?: string; message?: string } };

  const tieredLoad = async (filterProject: boolean): Promise<TieredResult> => {
    const full = await byUser(
      'form_id,title,responder_uri,edit_uri,sheet_url,criteria,summary,created_at',
      filterProject,
    );
    if (!full.error) return { rows: (full.data ?? []) as unknown as FormRow[] };
    // 필터가 걸린 상태에서 42703 이면 project 컬럼 미적용일 수 있으니 우선 감지.
    if (filterProject && isMissingProjectCol(full.error)) {
      return { missingProjectCol: true };
    }
    if (full.error.code === '42703') {
      // criteria/summary not yet migrated — keep sheet_url CTA working.
      const mid = await byUser(
        'form_id,title,responder_uri,edit_uri,sheet_url,created_at',
        filterProject,
      );
      if (!mid.error) return { rows: (mid.data ?? []) as unknown as FormRow[] };
      if (filterProject && isMissingProjectCol(mid.error)) {
        return { missingProjectCol: true };
      }
      if (mid.error.code === '42703') {
        // sheet_url also missing — degrade to the legacy column set so the
        // widget still renders existing forms (CTA disabled).
        const legacy = await byUser(
          'form_id,title,responder_uri,edit_uri,created_at',
          filterProject,
        );
        if (!legacy.error) {
          return { rows: (legacy.data ?? []) as unknown as FormRow[] };
        }
        if (filterProject && isMissingProjectCol(legacy.error)) {
          return { missingProjectCol: true };
        }
        return { error: legacy.error };
      }
      return { error: mid.error };
    }
    return { error: full.error };
  };

  const first = await tieredLoad(!!projectId);
  // 컬럼 미적용이면 필터 없이 재시도(오늘 동작, 회귀 0). 재시도는 filterProject
  // =false 라 다시 missingProjectCol 을 낼 수 없다 → {rows}|{error} 만 남는다.
  const out =
    'missingProjectCol' in first ? await tieredLoad(false) : first;
  if ('missingProjectCol' in out) {
    // 이론상 도달 불가(위 재시도가 필터를 껐으므로). 방어적으로 빈 목록.
    return NextResponse.json({ forms: [] });
  }
  if ('error' in out) {
    console.error('forms_list_failed', out.error);
    return NextResponse.json({ error: out.error.message }, { status: 500 });
  }
  const rows = out.rows;

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
