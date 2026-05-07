import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getProjectArtifacts, type ProjectArtifact } from '@/lib/projects';
import { ActiveProjectSync } from '@/components/active-project-sync';

const FEATURE_TO_SIDEBAR_KEY: Record<ProjectArtifact['feature'], string | null> = {
  report: 'reports',
  interview: 'interviews',
  transcript: 'transcripts',
  desk: 'desk',
  scheduler: 'scheduler',
  recruiting: 'recruiting',
  generation: null,
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Projects');
  const tSidebar = await getTranslations('Sidebar');

  const supabase = await createClient();
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!project) notFound();

  const org = await getActiveOrg();
  const artifacts = org ? await getProjectArtifacts(org.org_id, id) : [];

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <ActiveProjectSync id={project.id} name={project.name} />
      <div className="border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {project.name}
        </h1>
      </div>
      {project.description && (
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {project.description}
        </p>
      )}

      <div className="mt-8">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('items')}
        </h2>
        {artifacts.length === 0 ? (
          <div className="mt-3 border border-line bg-paper-soft p-6 text-[12.5px] text-mute [border-radius:4px]">
            아직 이 프로젝트에 등록된 산출물이 없습니다.
          </div>
        ) : (
          <ul className="mt-3 border border-line bg-paper [border-radius:4px]">
            {artifacts.map((a) => {
              const sidebarKey = FEATURE_TO_SIDEBAR_KEY[a.feature];
              const featureLabel = sidebarKey ? tSidebar(sidebarKey) : a.feature;
              return (
                <li
                  key={`${a.feature}:${a.id}`}
                  className="flex items-center justify-between border-t border-line-soft px-5 py-3 first:border-t-0"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
                        {featureLabel}
                      </span>
                      {a.status && a.status !== 'done' && (
                        <span className="text-[10.5px] uppercase tracking-[0.14em] text-amore">
                          {a.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
                      {a.title}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-mute-soft tabular-nums">
                    {new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
