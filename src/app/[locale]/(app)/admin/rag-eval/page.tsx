import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { createAdminClient } from '@/lib/supabase/admin';
import { AdminRagEval, type EvalProject } from '@/components/admin-rag-eval';

// Super-admin 전용 — RAG 품질 평가 하네스. 비-admin 은 notFound() 로 존재를
// 감춘다(다른 admin 페이지와 동일).
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  const org = await getActiveOrg();
  let projects: EvalProject[] = [];
  if (org?.org_id) {
    // 활성 org 의 인터뷰 프로젝트 목록(선택지). service-role 로 조회 — 페이지
    // 자체가 super-admin gate 뒤라 안전.
    const admin = createAdminClient();
    const { data } = await admin
      .from('interview_projects')
      .select('id, name')
      .eq('org_id', org.org_id)
      .order('updated_at', { ascending: false });
    projects = (data ?? []).map((p) => ({ id: String(p.id), name: String(p.name ?? '') }));
  }

  return <AdminRagEval projects={projects} />;
}
