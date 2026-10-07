'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainBarHost — 체인 바의 캔버스 마운트 + 액션 배선.

   위치(CD §1.1 "캔버스 뷰포트 sticky top 16 · 가로 중앙 · z 50"):
   캔버스 surface 는 transform(translate3d + scale)으로 pan/zoom 되므로 그 안에
   `sticky` 를 두면 바가 캔버스와 함께 끌려가 "따라온다" 가 성립하지 않는다.
   그래서 **변환되지 않는 뷰포트 레이어**(canvas-board 의 relative 컨테이너)에
   absolute 로 얹는다 — 캔버스를 어디로 끌어도 바는 상단 16px 에 남는다(CD 의도
   그대로). z 는 토큰 `z-modal`(50) = CD 50, 피커 패널은 포털 + z-overlay 라 바
   위로 뜬다(done-when).

   좌우 빈 영역은 pointer-events-none 으로 비워 캔버스 pan 을 막지 않는다.

   프로젝트 피커 데이터(WRITER-ANSWERS §5): 기존 interviews 프로젝트 목록
   (`useInterviewV2Projects`) + 기존 생성 모달(`CreateProjectModal`) 재사용 —
   신규 API·신규 모달 0.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { usePaywall } from '@/components/paywall-provider';
import { ChainBar } from './chain-bar';
import { useWidgetChain } from './widget-chain-provider';

export function ChainBarHost({
  onOpenWidget,
}: {
  /** 위젯 전체보기 열기 — canvas-board 의 openFullview 를 그대로 받는다. */
  onOpenWidget: (widgetKey: string) => void;
}) {
  // 바깥 껍데기는 "체인이 있는가" 만 본다 — 체인 없는 캔버스(대다수)에서 프로젝트
  // 목록 fetch 를 돌리지 않으려고 피커 데이터 훅을 안쪽으로 내렸다.
  const { view } = useWidgetChain();
  if (!view) return null;
  return <ChainBarMounted onOpenWidget={onOpenWidget} />;
}

function ChainBarMounted({
  onOpenWidget,
}: {
  onOpenWidget: (widgetKey: string) => void;
}) {
  const { view, busy, approve, skip, cancel, resume, dismiss } =
    useWidgetChain();
  const { projects, create } = useInterviewV2Projects();
  const { showPaywall } = usePaywall();
  const [picked, setPicked] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (!view) return null;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-4 z-modal flex justify-center px-4">
        <div className="pointer-events-auto max-w-full">
          <ChainBar
            view={view}
            busy={busy}
            onApprove={(stepIndex) => {
              void approve(stepIndex, picked);
              setPicked(null);
            }}
            onSkip={(stepIndex) => void skip(stepIndex)}
            onCancel={() => void cancel()}
            onResume={() => void resume()}
            onTopUp={showPaywall}
            onOpen={onOpenWidget}
            onDismiss={dismiss}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            pickedProjectId={picked}
            onPickProject={setPicked}
            onCreateProject={() => setCreateOpen(true)}
          />
        </div>
      </div>

      {/* "+ 새 프로젝트" — 기존 생성 모달. 생성되면 그 프로젝트를 바로 선택해
          진행 버튼 잠금을 푼다(별도 스텝을 만들지 않는다 — B3). */}
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, description) => {
          const { project } = await create(name, description);
          if (project) {
            setPicked(project.id);
            setCreateOpen(false);
            return project.id;
          }
          return null;
        }}
      />
    </>
  );
}
