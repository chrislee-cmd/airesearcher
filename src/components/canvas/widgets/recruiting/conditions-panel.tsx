'use client';

import { EmptyState } from '@/components/ui/empty-state';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';

// 리크루팅 fullview 상단 좌 위젯 — recruiting wizard 에서 정의한 참여자
// 조건(대상자 조건)을 chip 으로 요약 렌더한다.
//
// 데이터 소스: 조건은 서버에 form 별로 저장되지 않고 wizard 의 React state
// 에만 존재하므로(§recruiting_forms 테이블에 criteria 컬럼 없음), 카드가
// wizard 의 onConditionsChange 콜백으로 lift 한 값을 prop 으로 받는다.
// brief 가 null 이면(아직 조건 분석 전) 안내 EmptyState 를 띄운다.
export function RecruitingConditionsPanel({
  brief,
}: {
  brief: EditableBrief | null;
}) {
  const criteria = brief?.criteria ?? [];
  const summary = brief?.summary?.trim() ?? '';

  return (
    <section className="flex h-full min-h-0 flex-col rounded-sm border-[2px] border-ink bg-paper shadow-[2px_2px_0_black]">
      <header className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-ink/15 px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">🎯 참여자 조건</h3>
        {criteria.length > 0 && (
          <span className="text-xs-soft tabular-nums text-mute-soft">
            {criteria.length}개
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {criteria.length === 0 ? (
          <EmptyState
            tone="subtle"
            title="아직 정의된 조건이 없습니다"
            description="카드 본문에서 자료를 분석하면 참여자 조건이 여기에 요약됩니다."
          />
        ) : (
          <div className="space-y-3">
            {summary && (
              <p className="text-sm leading-[1.6] text-mute">{summary}</p>
            )}
            <ul className="flex flex-wrap gap-2">
              {criteria.map((c, i) => (
                <li
                  key={i}
                  className={
                    c.required
                      ? 'flex items-center gap-1.5 rounded-xs border border-amore bg-paper px-2.5 py-1 text-sm text-ink'
                      : 'flex items-center gap-1.5 rounded-xs border border-line bg-paper px-2.5 py-1 text-sm text-ink-2'
                  }
                  title={c.detail || undefined}
                >
                  <span className="text-xs-soft uppercase tracking-[0.04em] text-mute-soft">
                    {c.category}
                  </span>
                  <span className="font-medium">{c.label}</span>
                  {c.required && (
                    <span className="text-xs text-amore">필수</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
