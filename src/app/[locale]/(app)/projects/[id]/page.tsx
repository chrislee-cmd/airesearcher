import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ActiveProjectSync } from '@/components/active-project-sync';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Projects');

  const supabase = await createClient();
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!project) notFound();

  const { data: gens } = await supabase
    .from('generations')
    .select('id, feature, created_at, output')
    .eq('project_id', id)
    .order('created_at', { ascending: false });

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
        {(!gens || gens.length === 0) ? (
          <div className="mt-3 border border-line bg-paper-soft p-6 text-[12.5px] text-mute [border-radius:4px]">
            아직 이 프로젝트에 등록된 산출물이 없습니다.
          </div>
        ) : (
          <ul className="mt-3 border border-line bg-paper [border-radius:4px]">
            {gens.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between border-t border-line-soft px-5 py-3 first:border-t-0"
              >
                <div>
                  <div className="text-[12.5px] text-ink-2">{g.feature}</div>
                  <div className="mt-0.5 text-[11px] text-mute-soft tabular-nums">
                    {new Date(g.created_at).toISOString().replace('T', ' ').slice(0, 16)}
                  </div>
                </div>
                <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
                  #{g.id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
