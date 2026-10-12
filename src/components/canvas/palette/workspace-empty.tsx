'use client';

/* ────────────────────────────────────────────────────────────────────
   WorkspaceEmpty — 빈 작업면 (P3a).

   CD SSOT: `canvas-modular/full/README.md` §7 P3a + 장면 P3a.

   빈 상태 카드 하나(540 · 1px `--line` · radius 16)와 "+ 새 체인". 체인 요약
   pill 없음. **옛 그리드 자리표시(3×3 윤곽)를 그리지 않는다** — 그리드는
   이 PR 에서 퇴역했고, 윤곽만 남기면 "위젯이 사라졌다" 는 오해를 오히려
   굳힌다.

   화면 고정이다(캔버스 transform 밖). CD 는 캔버스 영역 안의 고정 좌표에
   그렸는데, 캔버스 안에 두면 팬·줌에 안내문이 화면 밖으로 밀려 **아무것도
   없는 작업면에서 안내가 사라지는** 상태가 생긴다. 안내는 캔버스 내용이
   아니므로 화면에 고정한다(장면 좌표를 그대로 쓰지 않는 §8-7 의 규칙).

   취소 드롭을 막지 않도록 카드는 `pointer-events-none` 이고 CTA 만 살린다 —
   빈 작업면에 놓는 것은 §5 대로 **취소**이고 카드가 그 판정을 가로채면
   안내 라벨이 안 뜬다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';

export function WorkspaceEmpty({ onNewChain }: { onNewChain: () => void }) {
  const t = useTranslations('Canvas.workspace');
  const tChain = useTranslations('Chain');

  return (
    <div
      data-workspace-empty
      style={{ width: 540, gap: 12, padding: '36px 34px' }}
      className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-panel-lg border border-soft-line bg-soft-surface text-center"
    >
      <span
        aria-hidden
        style={{ width: 60, height: 60 }}
        className="flex items-center justify-center rounded-modal bg-soft-fill"
      >
        <EmptyGlyph />
      </span>
      <span
        style={{ fontFamily: 'var(--font-display)' }}
        className="text-3xl font-bold tracking-tight text-ink"
      >
        {t('emptyTitle')}
      </span>
      <span
        style={{ maxWidth: 400 }}
        className="text-lg leading-relaxed text-soft-mute"
      >
        {t('emptyBody')}
      </span>
      {/* 이 카드는 레인이 없고 체인 조회가 끝난 상태에서만 렌더되므로(보드가
          `!lane && !hydrating` 로 게이트) CTA 에 잠금 상태가 없다 — 잠금 표시는
          툴바가 소유한다(파일럿 = 레인 1개). */}
      {/* eslint-disable-next-line react/forbid-elements -- CD 빈 상태 CTA 는 ink 면 pill(10/20 패딩 · 13.5/600)로 툴바 "+ 새 체인" 과 같은 전용 chrome 이다. Button primitive 의 size variant 와 불일치하고 §7.11 로 override 가 불확정 — chain-toolbar 와 동일 선례. */}
      <button
        type="button"
        data-workspace-empty-cta
        onClick={onNewChain}
        style={{ padding: '10px 20px', marginTop: 4 }}
        className="pointer-events-auto inline-flex items-center rounded-pill bg-ink text-lg font-semibold text-soft-surface hover:bg-soft-ink-hover focus-visible:outline-none focus-visible:shadow-soft-focus-ring"
      >
        {tChain('toolbar.newChain')}
      </button>
    </div>
  );
}

/**
 * 빈 작업면 글리프 — CD `canvas-modular-full.dc.html` IP `empty` 경로 그대로
 * (패널 + 오른쪽 화살표 = "왼쪽에서 꺼내 온다"). 듀오톤 세트에 없는 글리프라
 * 세트 규격(viewBox 24 · stroke 1.8 · round cap/join)으로 둔다(§10 "아이콘은
 * duotone 세트에 없으면 세트 규격으로 추가").
 */
function EmptyGlyph() {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-ink-2)"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x={3} y={4} width={6} height={16} rx={1.5} fill="var(--color-paper)" />
      <path d="M13 12h7M17 8l4 4-4 4" />
    </svg>
  );
}
