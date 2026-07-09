import { getTranslations } from 'next-intl/server';
import type { ShareResource } from '@/lib/share/viewer-resource';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { ReadonlyToplineBlocks } from '@/components/interviews-v2/topline-blocks';
import { SharePersonaLive } from './share-persona-live';

// 공유 뷰어 read-only 프레임 — 사이드바·편집 컨트롤 없는 최소 헤더 + 메인
// 패널 슬롯. (app) 셸 밖이라 편집/드래그/자유검색 진입점이 아예 존재하지
// 않는다(결정 1·3).
//
// resource_type 별 리치 렌더(#476):
//   - interview_topline → 탑라인 보고서 블록(topline-blocks 재사용, 편집/
//     드래그/재생성/자유검색 없음). 자유검색은 공유 대상 아님.
//   - probing_persona → 리서치 컨텍스트(goal/KRQ/가설) + 페르소나 그리드
//     (PersonaPanel 재사용) + 생성 질문 리스트. 데이터는 #493 스냅샷.

// 프로빙 리서치 컨텍스트 — probing_sessions row 에 있는 goal/KRQ/가설. 스냅샷
// 유무와 무관하게 항상 있으면 표시(페르소나 그리드의 헤더 맥락).
function ResearchContextBody({
  resource,
  labels,
}: {
  resource: Extract<ShareResource, { type: 'probing_persona' }>;
  labels: { goal: string; krq: string; hypotheses: string };
}) {
  const hasAny =
    resource.researchGoal.trim() ||
    resource.keyResearchQuestion.trim() ||
    resource.hypotheses.length > 0;
  if (!hasAny) return null;
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

function PersonaBody({
  resource,
  labels,
}: {
  resource: Extract<ShareResource, { type: 'probing_persona' }>;
  labels: {
    goal: string;
    krq: string;
    hypotheses: string;
    grid: string;
    questions: string;
    questionsEmpty: string;
    snapshotMissing: string;
  };
}) {
  // 실시간화: 초기 = #493 스냅샷(mid-join 즉시 표시), 그 위에
  // probing-live:<sessionId> broadcast 를 구독해 live 재렌더(client). 스냅샷
  // 미저장/미지원/미채움 상태는 라이브 래퍼가 방어적 안내로 그리다가 첫 live
  // delta 에 콘텐츠로 전환한다(결정 2 유지).
  return (
    <div className="space-y-8">
      <ResearchContextBody resource={resource} labels={labels} />
      <SharePersonaLive
        sessionId={resource.sessionId}
        initialSnapshot={resource.snapshot}
        labels={{
          grid: labels.grid,
          questions: labels.questions,
          questionsEmpty: labels.questionsEmpty,
          snapshotMissing: labels.snapshotMissing,
        }}
      />
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

  // 인터뷰 탑라인은 정적 스냅샷이라 빈 상태를 안내로 막는다. 프로빙 페르소나는
  // 실시간화(broadcast) 대상이라 초기 스냅샷이 비어 있어도 항상 PersonaBody 를
  // 마운트해야 한다 — 그래야 mid-join 후 도착하는 live delta 로 채워진다(빈→라이브
  // 전환은 SharePersonaLive 가 방어적으로 처리).
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
        {resource.type === 'interview_topline' ? (
          resource.blocks.length > 0 ? (
            <ReadonlyToplineBlocks blocks={resource.blocks as ToplineBlock[]} />
          ) : (
            <p className="text-md text-mute">{t('emptyContent')}</p>
          )
        ) : (
          <PersonaBody
            resource={resource}
            labels={{
              goal: t('personaGoal'),
              krq: t('personaKrq'),
              hypotheses: t('personaHypotheses'),
              grid: t('personaGrid'),
              questions: t('personaQuestions'),
              questionsEmpty: t('personaQuestionsEmpty'),
              snapshotMissing: t('personaSnapshotMissing'),
            }}
          />
        )}
      </div>
    </main>
  );
}
