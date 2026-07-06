'use client';

import type { useTranslations } from 'next-intl';
import type { DeskJob } from '@/components/desk-job-provider';
import { AiJudgmentLog } from './ai-judgment-log';
import { DeskReportView } from './desk-report-view';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// 데스크 결과 진입점 — AI 판단 로그(항상 상단) + mode 별 보고서 본문.
// 지금은 모든 mode 가 markdown 리포트(DeskReportView) 하나로 렌더된다.
// market PR(D) 이 mode === 'market' 분기(TAM/SAM 데이터 세트 뷰)를 이
// 파일에 추가한다 — 다른 파일은 재편집하지 않는다 (충돌 매트릭스).
export function DeskResultView({ job, tDesk }: { job: DeskJob; tDesk: TDesk }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 pt-4">
        <AiJudgmentLog job={job} />
      </div>
      <DeskReportView job={job} tDesk={tDesk} />
    </div>
  );
}
