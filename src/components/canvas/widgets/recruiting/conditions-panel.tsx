'use client';

import { EmptyState } from '@/components/ui/empty-state';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';

// 리크루팅 fullview 상단 좌 위젯 — recruiting wizard 에서 정의한 참여자
// 조건(대상자 조건)을 chip 으로 요약 렌더한다.
//
// 데이터 소스(호스트 카드가 우선순위 결정 — recruiting-card.tsx):
//   1) fullview 에서 선택된 폼의 저장된 조건(recruiting_forms.criteria,
//      migration 20260703060414) — 옛 폼·refresh 후에도 노출
//   2) 없으면 wizard 의 실시간 state(onConditionsChange 로 lift)로 fallback
// brief 가 null 이면(둘 다 없음 — 아직 분석 전 신규 폼) 안내 EmptyState.
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
                  <span className="text-xs-soft uppercase tracking-[0.22em] text-mute-soft">
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
