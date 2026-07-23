'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewSidebar — 풀뷰 V2 공유 셸의 좌측 위젯 네비게이션 (240px).

   fresh 빌드 (design-handoff/FULLVIEW-SHELL.md §F2). 레거시 `sidebar-nav.tsx`
   와 별개 컴포넌트 — 위젯이 전부 V2 로 전환된 뒤 레거시는 별도 PR 로 제거
   (supersede). 여기서는 레거시를 편집·재사용하지 않는다.

   - 전달받은 순서대로 위젯을 세로 나열.
   - 활성 항목 = border-2 ink · fv-radius-nav(8) · paper · shadow-memphis-sm.
   - idle 항목 = 투명 border · text-mute-soft.
   - status dot 10px = per-widget 파스텔(`--widget-header-bg-<accent>`, §S3).
   - 배지(§F7 확정 소스 = `useWidgetStateOf`): running→LIVE(amore fill·mono·
     pulse) · done→DONE(mint·success-text). CD 정적 comps 는 happy-path 만
     그리므로 idle/error 는 배지 없음 — error 스타일은 CD 확정 시 후속.
   - locked(준비중) 위젯 = 중립 배지 + dim, 라이브 위젯과 시각 구분.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  resolveWidgetLabel,
  type WidgetContent,
  type WidgetStateInfo,
} from '../widget-types';
import { useWidgetStateOf } from '../shell/widget-state-context';

// LIVE/DONE/locked 배지 radius — CD §F2 측정값 6px. 승격 fv radius 세트
// (fv-radius-nav 8 ~ panel-lg 16, §F6(B)) 밖의 off-scale 값이라 매칭 토큰이
// 없다. §F6(B) 가 off-scale radius 를 raw rounded-[Npx] 로 두는 규약과 동일.
// design-allow-hardcoded -- CD §F2 배지 radius 6 (승격 fv radius 스케일 8~16 밖, 매칭 토큰 없음)
const NAV_BADGE_RADIUS = 'rounded-[6px]';

// 항목의 라이브 배지 — running→LIVE, done→DONE (§F2/§F7). 그 외(idle/error)
// 는 배지 없음. LIVE 는 amore fill + pulse 도트, DONE 은 mint + success-text.
function NavBadge({ widgetKey }: { widgetKey: string }) {
  const state = useWidgetStateOf(widgetKey);
  if (state.kind === 'running') {
    return (
      <span
        key={badgeKey(state)}
        className={`pop-in inline-flex shrink-0 items-center gap-1 ${NAV_BADGE_RADIUS} border-[1.5px] border-amore bg-amore px-1.5 py-0.5 font-mono-label text-xs font-extrabold tracking-[0.06em] text-white`}
        aria-live="polite"
      >
        <span
          aria-hidden
          className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-white"
        />
        LIVE
      </span>
    );
  }
  if (state.kind === 'done') {
    return (
      <span
        key={badgeKey(state)}
        className={`pop-in inline-flex shrink-0 items-center gap-1 ${NAV_BADGE_RADIUS} border-[1.5px] border-ink bg-mint px-1.5 py-0.5 font-mono-label text-xs font-extrabold tracking-[0.06em] text-success-text`}
      >
        DONE
      </span>
    );
  }
  return null;
}

// state.kind 변경 시 key remount → .pop-in 재생 (reduced-motion 은 globals.css
// 가 독립 존중). idle/error 는 NavBadge 가 null 이라 여기 도달 안 함.
function badgeKey(state: WidgetStateInfo): string {
  return state.kind;
}

// locked(준비중) 위젯 배지 — 중립 토큰만. 라이브 위젯 자리(배지)를 재사용:
// locked 위젯은 idle 이라 NavBadge 가 null → 자리 충돌 없음.
function LockedBadge() {
  const t = useTranslations('Shell');
  return (
    <span
      className={`inline-flex shrink-0 items-center ${NAV_BADGE_RADIUS} border-[1.5px] border-line-soft bg-paper-soft px-1.5 py-0.5 font-mono-label text-xs font-semibold text-mute-soft`}
      aria-label={t('locked')}
    >
      {t('locked')}
    </span>
  );
}

export function FullviewSidebar({
  widgets,
  activeKey,
  onSwitch,
  lockedKeys,
  footnote,
}: {
  widgets: WidgetContent[];
  activeKey: string | null;
  onSwitch: (key: string) => void;
  // 준비중(gated) 위젯 key 목록. 비었으면 전부 라이브 → 회귀 0.
  lockedKeys?: string[];
  // 옵션: 사이드바 하단 안내 카드 본문 (예: "위젯 전환해도 세션 유지"). i18n
  // 카피는 소비처가 주입 (신규 키 없이 로케일 안전). 미지정 시 미렌더.
  footnote?: ReactNode;
}) {
  const t = useTranslations('Shell');
  const tRoot = useTranslations();
  const locked =
    lockedKeys && lockedKeys.length > 0 ? new Set(lockedKeys) : null;
  return (
    <nav
      aria-label={t('navLabel')}
      className="flex w-[240px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r-2 border-ink bg-paper-soft px-3 py-3.5"
    >
      <div className="px-2 pb-2 pt-1 font-mono-label text-xs font-bold tracking-[1px] text-faint">
        {t('navLabel')}
      </div>
      {widgets.map((w) => {
        const active = w.key === activeKey;
        const isLocked = locked?.has(w.key) ?? false;
        return (
          // eslint-disable-next-line react/forbid-elements -- 좌측 nav 항목은 Button primitive 의 어떤 variant 와도 맞지 않는 rich 레이아웃(status dot + 라벨 + 라이브 배지 + Memphis 활성 박스)이라 native <button> 사용. 전용 nav primitive 는 별 PR (레거시 sidebar-nav 와 동일 선례).
          <button
            key={w.key}
            type="button"
            onClick={() => onSwitch(w.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center justify-between gap-2 rounded-[var(--fv-radius-nav)] border-2 px-3 py-2.5 text-left transition-colors ${
              active
                ? 'border-ink bg-paper shadow-memphis-sm'
                : 'border-transparent hover:bg-paper'
            }`}
          >
            <span
              className={`flex min-w-0 flex-1 items-center gap-2 ${
                // locked 행은 dim — 라이브 위젯과 시각 구분 (active 여도 유지).
                isLocked && !active ? 'opacity-60' : ''
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink/30"
                style={{
                  background: `var(--widget-header-bg-${w.meta.accent})`,
                }}
                aria-hidden
              />
              <span
                className={`truncate text-lg ${
                  active
                    ? 'font-bold text-ink'
                    : 'font-medium text-mute-soft'
                }`}
              >
                {resolveWidgetLabel(tRoot, w.meta)}
              </span>
            </span>
            {isLocked ? <LockedBadge /> : <NavBadge widgetKey={w.key} />}
          </button>
        );
      })}
      {footnote ? (
        <div className="mt-auto rounded-[var(--fv-radius-field)] border border-line bg-paper px-3 py-2.5 text-sm leading-[1.5] text-mute-soft">
          {footnote}
        </div>
      ) : null}
    </nav>
  );
}
