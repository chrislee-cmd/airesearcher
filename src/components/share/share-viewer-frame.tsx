import { getTranslations } from 'next-intl/server';
import type { ShareResource } from '@/lib/share/viewer-resource';

// 공유 뷰어 read-only 프레임 — 사이드바·편집 컨트롤 없는 최소 헤더 + 메인
// 패널 슬롯. (app) 셸 밖이라 편집/드래그/자유검색 진입점이 아예 존재하지
// 않는다(결정 1·3).
//
// 실제 resource_type 별 리치 렌더(위젯/우측 패널)는 #476 이 이 슬롯을 대체.
// 이 PR 은 프레임 + 게이트까지라, 여기서는 로드된 페이로드를 read-only 텍스트로
// 방어적으로 표시한다.

/** 블록(jsonb, shape 미상)에서 표시 가능한 텍스트를 방어적으로 추출. */
function blockText(block: unknown): string {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return '';
  const b = block as Record<string, unknown>;
  for (const key of ['title', 'heading', 'text', 'content', 'body', 'summary']) {
    const v = b[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function ToplineBody({ blocks }: { blocks: unknown[] }) {
  const lines = blocks.map(blockText).filter((s) => s.trim().length > 0);
  if (lines.length === 0) return null;
  return (
    <div className="space-y-4">
      {lines.map((line, i) => (
        <p key={i} className="text-md leading-[1.75] text-ink">
          {line}
        </p>
      ))}
    </div>
  );
}

function PersonaBody({
  resource,
  labels,
}: {
  resource: Extract<ShareResource, { type: 'probing_persona' }>;
  labels: { goal: string; krq: string; hypotheses: string };
}) {
  return (
    <div className="space-y-6">
      {resource.researchGoal.trim() && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.goal}
          </h2>
          <p className="text-md leading-[1.75] text-ink">{resource.researchGoal}</p>
        </section>
      )}
      {resource.keyResearchQuestion.trim() && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.krq}
          </h2>
          <p className="text-md leading-[1.75] text-ink">
            {resource.keyResearchQuestion}
          </p>
        </section>
      )}
      {resource.hypotheses.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {labels.hypotheses}
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {resource.hypotheses.map((h, i) => (
              <li key={i} className="text-md leading-[1.7] text-ink">
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export async function ShareViewerFrame({
  resource,
}: {
  resource: ShareResource;
}) {
  const t = await getTranslations('ShareViewer');
  const title =
    resource.type === 'interview_topline'
      ? t('toplineTitle')
      : t('personaTitle');

  const hasContent =
    resource.type === 'interview_topline'
      ? resource.blocks.map(blockText).some((s) => s.trim().length > 0)
      : Boolean(
          resource.researchGoal.trim() ||
            resource.keyResearchQuestion.trim() ||
            resource.hypotheses.length > 0,
        );

  return (
    <main className="mx-auto w-full max-w-[860px] flex-1 px-5 pb-16 pt-10">
      <header className="mb-8 border-b border-line-soft pb-5">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-mute-soft">
          {t('eyebrow')}
        </span>
        <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-mute">{t('readOnlyHint')}</p>
      </header>

      <div className="border border-line bg-paper p-6 rounded-sm md:p-8">
        {hasContent ? (
          resource.type === 'interview_topline' ? (
            <ToplineBody blocks={resource.blocks} />
          ) : (
            <PersonaBody
              resource={resource}
              labels={{
                goal: t('personaGoal'),
                krq: t('personaKrq'),
                hypotheses: t('personaHypotheses'),
              }}
            />
          )
        ) : (
          <p className="text-md text-mute">{t('emptyContent')}</p>
        )}
      </div>
    </main>
  );
}
