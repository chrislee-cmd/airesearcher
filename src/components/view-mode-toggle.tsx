'use client';

/* ────────────────────────────────────────────────────────────────────
   ViewModeToggle — 헤더의 캔버스 ⇄ 리스트 선호 스위치 (라이트/다크 톤).

   같은 /canvas 목적지 안에서 board ⇄ list 레이아웃을 in-place 스왑한다
   (라우트 이동 없음 → 라이브 세션 유지, ViewModeProvider 참고). 선호는
   낙관적으로 DB 에 저장돼 다음 방문·다른 기기에서도 유지된다.

   캔버스 목적지에서만 의미 있으므로 /canvas 경로에서만 노출한다 (다른
   라우트에선 렌더 0). 미인증 뷰엔 Topbar 가 이 컨트롤을 애초에 렌더하지
   않는다 (SignInButton 분기).
   ──────────────────────────────────────────────────────────────────── */

import { usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useViewMode } from '@/components/view-mode-provider';
import type { ViewMode } from '@/lib/supabase/user';

// 캔버스 = 3×3 격자 글리프, 리스트 = 가로줄 글리프. 장식이라 aria-hidden;
// 세그먼트 버튼은 자체 aria-label 로 라벨된다.
function CanvasGlyph() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4h10M3 8h10M3 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ViewModeToggle() {
  const pathname = usePathname();
  const { mode, setMode } = useViewMode();
  const t = useTranslations('Topbar.viewMode');

  // 캔버스 목적지에서만 노출 — 토글은 캔버스 뷰 개인화 컨트롤이라 다른
  // 라우트(projects/members 등)에선 의미가 없다.
  const onCanvas = pathname === '/canvas' || pathname.startsWith('/canvas/');
  if (!onCanvas) return null;

  const segments: { value: ViewMode; label: string; glyph: React.ReactNode }[] = [
    { value: 'canvas', label: t('canvas'), glyph: <CanvasGlyph /> },
    { value: 'list', label: t('list'), glyph: <ListGlyph /> },
  ];

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex items-center gap-0.5 rounded-full bg-ink/10 p-0.5"
    >
      {segments.map((seg) => {
        const active = mode === seg.value;
        return (
          // eslint-disable-next-line react/forbid-elements -- 세그먼트 토글은 Button/IconButton primitive 의 어떤 variant 와도 맞지 않는 라이트/다크 스위치 톤(pill 컨테이너 안 active 채움 + aria-pressed)이라 native <button>. 전용 SegmentedControl primitive 는 별 PR.
          <button
            key={seg.value}
            type="button"
            aria-label={seg.label}
            aria-pressed={active}
            title={seg.label}
            onClick={() => {
              if (!active) setMode(seg.value);
            }}
            className={`inline-flex h-6 w-7 items-center justify-center rounded-full transition-colors duration-[120ms] ${
              active
                ? 'bg-ink text-paper'
                : 'text-ink-2 hover:bg-ink/10'
            }`}
          >
            {seg.glyph}
          </button>
        );
      })}
    </div>
  );
}
