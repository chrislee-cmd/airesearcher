'use client';

/* ────────────────────────────────────────────────────────────────────
   ComingSoonBody — 아직 backend 가 없는 신규 canvas 위젯 (가이드라인 /
   AI 모더레이터 / PPT 보고서) 의 "준비 중" 본문. 옛 PlaceholderBody 대체.

   - 카드 안: 짧은 "🚧 준비 중이에요" (옛 그대로, dim 처리와 병존).
   - 전체보기: 친절한 hero (icon + 기능 소개 + "곧 만나요" 배너) 를
     renderInSlot 으로 공유 모달 slot 에 portal. portal 은 dim wrapper
     밖(모달 DOM)에 그려지므로 fullview 는 자동으로 정상 opacity.

   각 위젯의 실제 도구 본문(input / 결과 / export 등)은 위젯별 후속 spec
   에서 이 컴포넌트를 교체한다. 색/타이포는 design-system 토큰만.
   ──────────────────────────────────────────────────────────────────── */

import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';

type ComingSoonBodyProps = {
  /** FullviewShell 의 currentKey 와 매칭되는 위젯 key. */
  widgetKey: string;
  /** 전체보기 패널 헤더 타이틀 (위젯 라벨). */
  label: string;
  icon: string;
  title: string;
  description: string;
  features: string[];
};

export function ComingSoonBody({
  widgetKey,
  label,
  icon,
  title,
  description,
  features,
}: ComingSoonBodyProps) {
  const { renderInSlot, close } = useFullview(widgetKey);

  return (
    <>
      {/* 카드 안 — 짧은 "준비 중" (옛 PlaceholderBody 그대로) */}
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="text-4xl" aria-hidden>
          🚧
        </span>
        <p className="text-lg font-semibold text-ink">준비 중이에요</p>
        <p className="text-sm text-mute-soft">곧 서비스를 시작할 예정이에요</p>
      </div>

      {/* 전체보기 — 친절한 hero */}
      {renderInSlot(
        <WidgetFullviewPanel title={label} subtitle="준비 중" onClose={close}>
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 p-10 text-center">
            <span className="text-6xl" aria-hidden>
              {icon}
            </span>
            <h2 className="text-3xl font-bold text-ink">{title}</h2>
            <p className="text-lg leading-relaxed text-ink-2">{description}</p>

            <div className="mt-4 w-full rounded-xs border-2 border-line-soft bg-paper-soft p-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-mute">
                준비 중인 기능
              </h3>
              <ul className="flex flex-col gap-2 text-left">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink-2">
                    <span className="mt-1 text-amore" aria-hidden>
                      ✦
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2">
              <p className="text-lg font-semibold text-amore">
                🚀 빨리 준비해서 곧 만나 뵐 예정입니다
              </p>
              <p className="text-xs text-mute-soft">
                기능이 준비되면 별도 공지 없이 자동으로 활성됩니다
              </p>
            </div>
          </div>
        </WidgetFullviewPanel>,
      )}
    </>
  );
}
