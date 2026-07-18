'use client';

/* ────────────────────────────────────────────────────────────────────
   Design Audit toggle — dev QA 전용 (프로덕션 비노출).

   globals.css 의 [data-theme="audit"] sentinel 블록을 활성/해제한다. audit 테마는
   Layer 1 raw 토큰을 전부 형광/극단으로 오염시켜, 토큰(var(--color-*)·
   shadow-memphis-*·radius/font 유틸)을 경유하는 요소는 전부 형광으로 변하고
   인라인 #hex·arbitrary shadow-[...]·rounded-[Npx] 같은 하드코드는 그대로 남아
   시각적으로 튀게 한다("안 변한 게 범인"). 627 정적 가드의 시각 QA 보조.

   프로덕션 무영향 가드 (이중):
     1. layout 에서 process.env.VERCEL_ENV !== 'production' 일 때만 렌더 →
        프로덕션 배포에선 `false && <DesignAuditToggle/>` 로 dead-code.
     2. 이 컴포넌트도 자체적으로 프로덕션 배포면 즉시 null 반환 + effect 스킵.
   → 프로덕션 유저에겐 절대 노출되지 않는다.

   왜 VERCEL_ENV 인가 (NODE_ENV 아님): Vercel preview 빌드도 next build 라
   NODE_ENV='production' 이다. NODE_ENV 가드는 preview 에서도 토글을 꺼버려
   preview QA(사용자 검증 경로)를 막는다. spec 의도 "dev/비프로덕션 한정" 은
   preview 를 포함하므로, 배포 환경을 실제로 구분하는 VERCEL_ENV 를 쓴다
   (production 배포에서만 비활성, preview + 로컬 dev 는 활성).

   토글 방법:
     - URL 쿼리 `?dstheme=audit` → 마운트 시 audit 활성 (리로드 생존).
     - 키보드 `Ctrl+Alt+D` → audit ⇄ pop 토글 (즉시).
   해제 시 기본 테마(pop)로 복귀. UI 없음(렌더 산출물 0) — 순수 side-effect.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';

const AUDIT = 'audit';
const DEFAULT = 'pop';
// 프로덕션 배포에서만 비활성. client 노출판 NEXT_PUBLIC_VERCEL_ENV 로 배포 환경
// 구분(로컬 dev·preview 는 undefined/'preview' → 활성). layout 의 server-side
// VERCEL_ENV 렌더 게이트가 1차 보호이고 이건 2차 방어.
const IS_ENABLED = process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production';

export function DesignAuditToggle() {
  useEffect(() => {
    if (!IS_ENABLED) return;

    const root = document.documentElement;

    // 1) URL 쿼리로 초기 활성 (?dstheme=audit / ?dstheme=pop). useSearchParams 대신
    //    window.location 직접 읽기 — Suspense 경계 요구를 피하는 client-only 경로.
    try {
      const param = new URLSearchParams(window.location.search).get('dstheme');
      if (param === AUDIT) root.dataset.theme = AUDIT;
      else if (param === DEFAULT) root.dataset.theme = DEFAULT;
    } catch {
      /* URL 파싱 실패 무시 — 기본 테마 유지 */
    }

    // 2) 키보드 토글 (Ctrl+Alt+D).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        root.dataset.theme = root.dataset.theme === AUDIT ? DEFAULT : AUDIT;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
