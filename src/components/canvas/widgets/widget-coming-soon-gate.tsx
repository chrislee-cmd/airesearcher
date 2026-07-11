'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetComingSoonGate — 일반(비-unlimited) 계정에서 OPEN 셋
   (probing/translate/quotes) 외의 canvas 위젯 body 를 대체하는 "준비중"
   게이트. canvas-board 가 lockedKeys 에 든 위젯의 ExpandedBody 를 이 컴포넌트
   로 치환한다 (unlimited 계정은 lockedKeys 가 비어 회귀 0).

   - 카피: "준비중입니다" + 위젯 라벨 반영 한 줄 + 수요 신호 버튼 2개.
   - 버튼(휘발성): "빨리 만들어주세요"(want) / "이건 굳이 없어도 될것 같아요"(skip).
     클릭 시 createClient() → auth.getUser() → widget_interest_votes upsert
     (user_id, widget_key) → 감사 토스트 + 선택 표시. 재투표는 덮어쓰기 허용.
   - 색/타이포는 design-system 토큰만. dashed 박스는 기존 placeholder 관례 재사용.

   전체보기(fullview): 카드 body 만 채우면 공유 전체보기 모달의 우측 slot 이
   텅 비어 "완성 안 된 느낌" (#572 갭). ComingSoonBody 관례대로 이 게이트가
   자기 key 일 때 준비중 hero(+동일 수요투표)를 renderInSlot 으로 slot 에
   portal 한다 — 카드는 항상 마운트돼 있으므로 세션 걱정 없이 안전.

   집계 대시보드(수요 리포트)는 후속 spec — 이 컴포넌트는 캡처까지만 담당.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/lib/supabase/client';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';

type Vote = 'want' | 'skip';

export function WidgetComingSoonGate({
  widgetKey,
  label,
  orgId,
}: {
  widgetKey: string;
  label: string;
  /** 활성 org id (있으면 집계 컨텍스트로 저장, nullable). */
  orgId?: string | null;
}) {
  const { push } = useToast();
  const { renderInSlot, close } = useFullview(widgetKey);
  const [selected, setSelected] = useState<Vote | null>(null);
  const [submitting, setSubmitting] = useState<Vote | null>(null);

  const vote = useCallback(
    async (choice: Vote) => {
      if (submitting) return;
      setSubmitting(choice);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        push('로그인 후 이용해 주세요', { tone: 'warn' });
        setSubmitting(null);
        return;
      }

      // upsert — (user_id, widget_key) unique 라 재투표 시 want↔skip 덮어쓰기.
      const { error } = await supabase.from('widget_interest_votes').upsert(
        {
          user_id: user.id,
          org_id: orgId ?? null,
          widget_key: widgetKey,
          vote: choice,
        },
        { onConflict: 'user_id,widget_key' },
      );

      setSubmitting(null);
      if (error) {
        push('잠시 후 다시 시도해 주세요', { tone: 'warn' });
        return;
      }
      setSelected(choice);
      push('의견 감사합니다 🙏', { tone: 'amore' });
    },
    [submitting, orgId, widgetKey, push],
  );

  // want/skip 버튼 + 안내문 — 카드 body 와 전체보기 hero 가 공유(동일 vote
  // 핸들러·selected 상태). 재투표 시 want↔skip 덮어쓰기.
  const voteCluster = (
    <>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <Button
          variant={selected === 'want' ? 'primary' : 'secondary'}
          size="md"
          onClick={() => vote('want')}
          disabled={submitting !== null}
          className="w-full"
        >
          {selected === 'want' ? '✓ 빨리 만들어주세요' : '빨리 만들어주세요'}
        </Button>
        <Button
          variant={selected === 'skip' ? 'primary' : 'ghost'}
          size="md"
          onClick={() => vote('skip')}
          disabled={submitting !== null}
          className="w-full"
        >
          {selected === 'skip'
            ? '✓ 이건 굳이 없어도 될것 같아요'
            : '이건 굳이 없어도 될것 같아요'}
        </Button>
      </div>

      {selected && (
        <p className="text-xs text-mute-soft">
          의견을 반영했어요. 다시 눌러 바꿀 수 있어요.
        </p>
      )}
    </>
  );

  return (
    <>
      {/* 카드 body — 짧은 준비중 + 수요투표 (기존 그대로) */}
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden>
          🚧
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-ink">준비중입니다</p>
          <p className="text-sm text-mute-soft">
            <strong className="text-ink-2">{label}</strong> 는 아직 준비 중이에요.
            이 도구가 필요하신가요?
          </p>
        </div>
        {voteCluster}
      </div>

      {/* 전체보기 slot — locked 위젯이 current 면 빈 패널 대신 준비중 hero.
          renderInSlot 은 isCurrent && slot 있을 때만 portal (아니면 null). */}
      {renderInSlot(
        <WidgetFullviewPanel title={label} subtitle="준비 중" onClose={close}>
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 p-10 text-center">
            <span className="text-6xl" aria-hidden>
              🚧
            </span>
            <h2 className="text-3xl font-bold text-ink">준비중입니다</h2>
            <p className="text-lg leading-relaxed text-ink-2">
              <strong className="text-ink">{label}</strong> 는 아직 준비 중이에요.
              이 도구가 필요하신가요? 의견을 남겨주시면 우선순위에 반영할게요.
            </p>
            {voteCluster}
          </div>
        </WidgetFullviewPanel>,
      )}
    </>
  );
}
