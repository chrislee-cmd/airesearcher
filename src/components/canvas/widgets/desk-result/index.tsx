'use client';

import type { useTranslations } from 'next-intl';
import type { DeskJob } from '@/components/desk-job-provider';
import { AiJudgmentLog } from './ai-judgment-log';
import { DeskReportView } from './desk-report-view';
import { MarketDataset } from './market-dataset';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// 데스크 결과 진입점 — AI 판단 로그(항상 상단) + mode 별 보고서 본문.
// trend / custom 은 공용 markdown 리포트(DeskReportView), market 은 TAM/SAM
// 참고 데이터 뷰(MarketDataset — disclaimer + DeskReportView)로 분기한다.
// 이 파일의 mode branch 만 market PR 소유 (다른 파일은 재편집 X — 충돌 매트릭스).
export function DeskResultView({ job, tDesk }: { job: DeskJob; tDesk: TDesk }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 pt-4">
        <AiJudgmentLog job={job} />
      </div>
      {job.mode === 'market' ? (
        <MarketDataset job={job} tDesk={tDesk} />
      ) : (
        <DeskReportView job={job} tDesk={tDesk} />
      )}
    </div>
  );
}
