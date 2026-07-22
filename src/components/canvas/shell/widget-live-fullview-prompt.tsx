'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetLiveFullviewPrompt — 세션이 라이브로 시작된 뒤 위젯 카드 본문에
   노출하는 "전체보기 유도" 컴팩트 화면.

   왜: 프로빙·통역은 세션 시작 후 실제 진행(질문 스트림 / 자막 스트림)이
   전체보기(모달)에서 이뤄진다. 카드 본문에 세팅 폼이나 인라인 스트림을
   그대로 남기면 좁은 카드가 혼잡하고, 라이브 진행 위치가 모호해진다.
   대신 라이브 시엔 세팅/인라인을 접고 중앙에 "전체보기로 이동" 유도만
   보여준다.

   - 아이콘 박스 + heading = 전체보기 진입 affordance (클릭 → onFullview).
   - sub = 세션 시작 안내 + 진행 위치.
   - "← Back to setup" = 세팅 뷰로 비파괴 토글 (세션은 계속 — onBackToSetup).
   - 프레젠테이션 전용: 문구(heading/sub/backLabel)는 호출부가 주입 (위젯별
     probing/interpretation 카피 차이).

   세션 lifecycle 은 전혀 건드리지 않는다 — 카드 본문 표시만 담당.
   ──────────────────────────────────────────────────────────────────── */

import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { Button } from '@/components/ui/button';

export function WidgetLiveFullviewPrompt({
  onFullview,
  onBackToSetup,
  heading,
  sub,
  backLabel,
}: {
  // 아이콘/heading 클릭 → 위젯 전체보기 modal 열기.
  onFullview: () => void;
  // "← Back to setup" → 세팅 뷰 비파괴 토글 (세션 유지).
  onBackToSetup: () => void;
  heading: string;
  sub: string;
  backLabel: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
      {/* 아이콘 박스 + heading = 전체보기 진입 복합 CTA. 클릭 → onFullview.
          native <button> (아이콘 박스 + heading 복합) 이라 Button primitive
          variant 에 매핑되지 않음 — data-canvas-action 으로 canvas
          [data-canvas-body] cascade opt-out (Button/IconButton 과 동일). */}
      {/* eslint-disable-next-line react/forbid-elements -- 아이콘 박스+heading 복합 진입 CTA: Button variant 미매핑. data-canvas-action 으로 cascade opt-out. */}
      <button
        type="button"
        onClick={onFullview}
        data-canvas-action
        className="group flex flex-col items-center gap-3 rounded-sm px-4 py-2"
      >
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-md border border-line bg-paper-soft text-ink transition-colors group-hover:border-ink group-hover:bg-paper">
          <DuotoneIcon name="fullview" size={28} />
        </span>
        <span className="text-md font-semibold text-ink group-hover:underline">
          {heading}
        </span>
      </button>
      <p className="max-w-[280px] text-sm text-mute">{sub}</p>
      {/* Button primitive 이 data-canvas-action 을 자체 부여 → cascade opt-out 자동. */}
      <Button variant="link" size="sm" onClick={onBackToSetup}>
        {backLabel}
      </Button>
    </div>
  );
}
