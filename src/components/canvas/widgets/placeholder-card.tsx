'use client';

/* ────────────────────────────────────────────────────────────────────
   PlaceholderBody — 아직 backend 가 없는 신규 canvas 위젯 (가이드라인 /
   AI 모더레이터 / PPT 보고서) 이 공유하는 "준비 중" 본문.

   WidgetShell 의 framed body 안쪽에 렌더 (dashboard 카드 + 전체보기 모달
   양쪽 동일). 각 위젯의 실제 도구 본문(input / 결과 / export 등)은 위젯별
   후속 spec 에서 이 컴포넌트를 교체한다. 색/타이포는 design-system 토큰만.
   ──────────────────────────────────────────────────────────────────── */

export function PlaceholderBody() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="text-4xl" aria-hidden>
        🚧
      </span>
      <p className="text-lg font-semibold text-ink">준비 중이에요</p>
      <p className="text-sm text-mute-soft">곧 서비스를 시작할 예정이에요</p>
    </div>
  );
}
