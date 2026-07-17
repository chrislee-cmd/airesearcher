'use client';

/* ────────────────────────────────────────────────────────────────────
   /status 다크 모드 셸 — 사용자 토글(localStorage) + FOUC 최소 초기화.

   공개 read-only 대시보드(/status)는 (app) 밖 독립 라우트라 이 셸 래퍼에만
   data-status-theme 을 얹어 다크를 스코프한다(전역 <html data-theme="pop"> 불변,
   다른 라우트 불변). 실제 다크 팔레트는 globals.css 의 [data-status-theme="dark"]
   스코프 블록이 --color-* 를 재선언해 하위 카드/차트/텍스트로 cascade 시킨다.

   토글은 클라이언트 로컬만(공개 URL 이 read-only — 서버 write·URL 파라미터 아님).
   기기별 localStorage['status-theme'] 로 유지되어 벽 모니터/개인 기기가 각자
   기억한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChromeButton } from './ui/chrome-button';

const STORAGE_KEY = 'status-theme';
const ROOT_ID = 'status-theme-root';

type Theme = 'light' | 'dark';

// FOUC 방지 — 셸 루트가 파싱되는 즉시(페인트 전) 실행되어 저장 테마를 루트 요소에
// 바로 반영한다. React useState 초기화도 같은 값을 읽으므로 hydration 후 재플립이
// 없다(SSR 기본값 'light' 와의 attribute 차이는 suppressHydrationWarning 로 무시).
// SPA 네비게이션 시엔 실행 안 되지만 그 경우 전체 리로드가 없어 flash 자체가 없다.
const INIT_SCRIPT = `(function(){try{var el=document.currentScript.parentElement;var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light'){el.setAttribute('data-status-theme',t);}}catch(e){}})();`;

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  // INIT_SCRIPT 가 이미 루트에 반영한 값을 우선 채택(hydration 정합).
  const attr = document.getElementById(ROOT_ID)?.getAttribute('data-status-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage 접근 불가(프라이빗 모드 등) → light */
  }
  return 'light';
}

export function StatusThemeShell({ children }: { children: ReactNode }) {
  const t = useTranslations('StatusTheme');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* 저장 실패해도 이번 세션 토글은 유지 */
      }
      return next;
    });
  }, []);

  const isDark = theme === 'dark';

  return (
    <div
      id={ROOT_ID}
      data-status-theme={theme}
      suppressHydrationWarning
      className="min-h-screen px-2 py-6"
    >
      {/* 페인트 전 테마 반영용 blocking init (FOUC 방지) */}
      <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      <div className="mx-auto mb-4 flex max-w-[1400px] justify-end">
        <ChromeButton
          size="sm"
          onClick={toggle}
          aria-label={isDark ? t('toLight') : t('toDark')}
          title={isDark ? t('toLight') : t('toDark')}
        >
          {isDark ? t('light') : t('dark')}
        </ChromeButton>
      </div>
      {children}
    </div>
  );
}
