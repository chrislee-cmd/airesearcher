import { getTranslations } from 'next-intl/server';
import type { ShareResource } from '@/lib/share/viewer-resource';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { ReportBody } from '@/components/interviews-v2/report/report-blocks';
import { SharePersonaLive } from './share-persona-live';

// 공유 뷰어 read-only 프레임 — 사이드바·편집 컨트롤 없는 최소 헤더 + 메인
// 패널 슬롯. (app) 셸 밖이라 편집/드래그/자유검색 진입점이 아예 존재하지
// 않는다(결정 1·3).
//
// resource_type 별 리치 렌더(#476):
//   - interview_topline → 리디자인 블록 렌더러(report/ReportBody 재사용 — #594
//     인앱 읽기모드와 SSOT 공유, 드리프트 0). 편집/드래그/재생성/자유검색 없음.
//     citation 은 CitationResolveProvider 미주입 → 칩만 렌더·팝오버 미동작(공개
//     뷰어는 인증 필요한 /chunks/resolve 미접근, 소프트 의존 폴백 — 에러 UI 0).
//   - probing_persona → 리서치 컨텍스트(goal/KRQ) + 페르소나 그리드
//     (PersonaPanel 재사용) + 생성 질문 리스트. 데이터는 #493 스냅샷.

// 프로빙 리서치 컨텍스트 — probing_sessions row 에 있는 goal/KRQ. 스냅샷
// 유무와 무관하게 항상 있으면 표시(페르소나 그리드의 헤더 맥락).
// (옛 "가설" 은 은퇴 — probing-hypotheses-retire-ghost-injection.)
function ResearchContextBody({
  resource,
  labels,
}: {
  resource: Extract<ShareResource, { type: 'probing_persona' }>;
  labels: { goal: string; krq: string };
}) {
  const hasAny =
    resource.researchGoal.trim() || resource.keyResearchQuestion.trim();
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
    grid: string;
    questions: string;
    questionsEmpty: string;
    snapshotMissing: string;
    inject: string;
    thinking: string;
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
          inject: labels.inject,
          thinking: labels.thinking,
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
  const isProbing = resource.type === 'probing_persona';
  const title = isProbing ? t('personaTitle') : t('toplineTitle');

  // 프로빙 협업 뷰는 3컬럼 위젯 그리드 + 우패널이라 탑라인(정적 보고서)보다 넓은
  // 컨테이너가 필요하다. 탑라인은 기존 narrow 카드 유지.
  // 프로빙은 뷰어가 질문을 주입할 수 있으므로 "읽기 전용" 대신 협업 힌트를 쓴다.
  return (
    <main
      className={`mx-auto w-full flex-1 px-5 pb-16 pt-10 ${
        isProbing ? 'max-w-[1400px]' : 'max-w-[860px]'
      }`}
    >
      <header className="mb-8 border-b border-line-soft pb-5">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-mute-soft">
          {t('eyebrow')}
        </span>
        <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-mute">
          {isProbing ? t('personaCollabHint') : t('readOnlyHint')}
        </p>
      </header>

      {resource.type === 'interview_topline' ? (
        resource.blocks.length > 0 ? (
          // 인앱 읽기 캔버스(bg-surface-canvas)와 동일 서피스 위에 리디자인 블록을
          // 그린다 — 블록의 rose/paper 정체성이 인앱과 같은 대비로 읽힌다. 프레임
          // 컨벤션(감싸는 카드·1px border)은 유지하고 본문만 리스킨(결정 4).
          // metaRight 는 빈 문자열: 공유 리소스(viewer-resource)는 blocks+generatedAt
          // 만 노출하고 인앱이 쓰는 "분석 문서 수(n=N)" 데이터가 없다 — 없는 값을
          // 지어내지 않고 exec 우측 메타 슬롯만 비운다(보수적, PR 본문 명시).
          <div className="rounded-sm border border-line bg-surface-canvas px-6 py-8">
            <ReportBody
              blocks={resource.blocks as ToplineBlock[]}
              metaRight=""
            />
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-paper p-6 md:p-8">
            <p className="text-md text-mute">{t('emptyContent')}</p>
          </div>
        )
      ) : (
        <PersonaBody
          resource={resource}
          labels={{
            goal: t('personaGoal'),
            krq: t('personaKrq'),
            grid: t('personaGrid'),
            questions: t('personaQuestions'),
            questionsEmpty: t('personaQuestionsEmpty'),
            snapshotMissing: t('personaSnapshotMissing'),
            inject: t('personaInjectHint'),
            thinking: t('personaThinking'),
          }}
        />
      )}
    </main>
  );
}
