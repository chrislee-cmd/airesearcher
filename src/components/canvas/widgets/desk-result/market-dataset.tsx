'use client';

import type { useTranslations } from 'next-intl';
import type { DeskJob } from '@/components/desk-job-provider';
import { DeskReportView } from './desk-report-view';

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

// 시장조사 mode 결과 뷰 — TAM/SAM "참고 데이터 세트". 이 mode 의 핵심 결정
// (수치 자동 계산 X, 출처 강제, 사용자 판단)을 화면 최상단 disclaimer 로
// 못 박은 뒤, 실제 보고서(출처가 붙은 TAM/SAM 근거 데이터)는 공용
// DeskReportView 로 렌더한다 — 섹션 파싱/원자료 목록/차트/형식이탈 fallback
// 등 견고성 로직을 그대로 재사용하기 위함이다.
//
// 소유권: 이 파일 + desk-result/index.tsx 의 mode branch 만 market PR 소유.
export function MarketDataset({ job, tDesk }: { job: DeskJob; tDesk: TDesk }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 pt-4">
        <div className="rounded-sm border border-warning-line bg-warning-bg px-4 py-3 text-sm text-ink-2">
          <span className="font-semibold">⚠️ TAM/SAM 참고 데이터</span>
          <p className="mt-1 leading-[1.6] text-mute">
            아래 시장 규모 수치는 확정값이 아니라 출처가 명시된 참고
            데이터입니다. 각 수치의 근거(통계·공시·기사)를 직접 확인한 뒤
            TAM/SAM 을 판단하세요. 근거를 확보하지 못한 항목은 “데이터 확보
            실패”로 표기됩니다.
          </p>
        </div>
      </div>
      <DeskReportView job={job} tDesk={tDesk} />
    </div>
  );
}
