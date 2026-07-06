'use client';

import { useMemo } from 'react';
import type { DeskJob } from '@/components/desk-job-provider';
import { isJudgmentEvent } from '@/lib/desk-orchestrator/types';

// AI 판단 로그 — orchestrator 가 progress.events 로 push 한 판단 라인
// (마커 🎯🔍🧠📰🚫 로 시작)만 골라 보고서 상단에 카드 형 표로 렌더한다.
// 항상 노출 (접기 X — 첫 iteration 결정). 판단 이벤트가 0줄이면(옛 custom
// job 등) 아무것도 그리지 않는다 — legacy 결과 화면 회귀 0.
//
// 소유권: 이 파일은 shell PR(C) 완결. market PR(D) 은 desk-result/index.tsx
// 의 mode branch 만, custom PR(E) 은 custom.ts 의 log 라인만 추가한다.
export function AiJudgmentLog({ job }: { job: DeskJob }) {
  const lines = useMemo(
    () => (job.progress?.events ?? []).filter(isJudgmentEvent),
    [job.progress?.events],
  );
  if (lines.length === 0) return null;

  return (
    <section className="mb-4 rounded-sm border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
        <span className="text-xs uppercase tracking-[.18em] text-amore">
          🧠 AI 판단 로그
        </span>
        <span className="text-xs text-mute-soft">{lines.length}건</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto px-4 py-3">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {lines.map((line, i) => {
              // 마커(첫 글자 emoji)와 본문을 분리해 2열 표로 — 스펙의
              // "카드 형 표" 렌더. 마커는 grapheme 단위가 아닌 시작 매칭이라
              // slice 대신 공백 첫 분리를 쓴다.
              const spaceIdx = line.indexOf(' ');
              const marker = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
              const body = spaceIdx > 0 ? line.slice(spaceIdx + 1) : '';
              return (
                <tr key={i} className="align-top">
                  <td className="w-8 py-1 pr-2 text-center" aria-hidden>
                    {marker}
                  </td>
                  <td className="py-1 leading-[1.7] text-ink-2">{body}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
