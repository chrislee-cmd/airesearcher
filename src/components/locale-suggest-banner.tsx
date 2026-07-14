'use client';

/* ────────────────────────────────────────────────────────────────────
   LocaleSuggestBanner — 영어 디폴트 진입의 이탈 완충.

   글로벌 디폴트가 영어라, 한국어(·일본어·태국어) 브라우저 유저도 첫 방문은
   /en 으로 진입한다(자동 감지 off — src/proxy.ts). 그들이 "영어 서비스인 줄
   알고 이탈"하지 않도록, 브라우저 선호 언어가 지원 로케일이면 상단에 1회성
   제안 배너를 띄운다: "🇰🇷 한국어로 보시겠어요? [한국어로 보기] [Continue in
   English]".

   노출 조건 (행동 계약 4):
     - 현재 로케일이 en (영어 디폴트 뷰 위에서만 넛지)
     - navigator 선호 언어가 en 이 아니고 지원 로케일(ko/ja/th)
     - dismiss 마커 쿠키 없음 (닫거나 언어 선택하면 재노출 안 함)

   전부 client-only(useEffect 안에서 navigator·cookie 판독) — 크롤러는 영어
   본문만 보고, 배너는 SEO 에 영향 없다. 초기 렌더는 null 이라 hydration
   mismatch 도 없다.

   배너 문구는 의도적으로 타깃 언어로 하드코딩한다(messages/*.json 아님) —
   영어 디폴트 뷰 위에서 유일하게 허용되는 비영어 텍스트(계약 4). 대상 언어
   화자에게 그 언어로 말을 걸어야 넛지가 통한다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  hasCookie,
  markLocaleSuggestDismissed,
  persistLocalePreference,
  LOCALE_SUGGEST_DISMISS_COOKIE,
} from '@/lib/i18n/locale-preference';

// 지원 로케일별 넛지 카피 (타깃 언어로 하드코딩). "Continue in English" 는 머무는
// 액션이라 모든 언어에서 영어 그대로 둔다.
const SUGGESTIONS: Record<
  string,
  { flag: string; question: string; accept: string }
> = {
  ko: { flag: '🇰🇷', question: '한국어로 보시겠어요?', accept: '한국어로 보기' },
  ja: { flag: '🇯🇵', question: '日本語で表示しますか？', accept: '日本語で見る' },
  th: { flag: '🇹🇭', question: 'ดูเป็นภาษาไทยไหม?', accept: 'ดูภาษาไทย' },
};

function detectSuggested(): string | null {
  // navigator.languages 는 선호 순 정렬. 첫 지원 로케일을 고르되 en 이 먼저
  // 나오면(영어 선호) 넛지하지 않는다.
  const langs =
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? navigator.languages
      : [typeof navigator !== 'undefined' ? navigator.language : ''];
  for (const raw of langs) {
    const base = (raw || '').toLowerCase().split('-')[0];
    if (base === 'en') return null;
    if (SUGGESTIONS[base]) return base;
  }
  return null;
}

export function LocaleSuggestBanner() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [suggest, setSuggest] = useState<string | null>(null);

  useEffect(() => {
    // 영어 디폴트 뷰에서만 넛지.
    if (locale !== 'en') return;
    // 이미 닫았거나 언어를 명시 선택한 유저에겐 재노출 안 함.
    if (hasCookie(LOCALE_SUGGEST_DISMISS_COOKIE)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration navigator/cookie probe; initial render is null to avoid SSR mismatch
    setSuggest(detectSuggested());
  }, [locale]);

  if (!suggest) return null;
  const copy = SUGGESTIONS[suggest];

  const accept = () => {
    markLocaleSuggestDismissed();
    void persistLocalePreference(suggest);
    setSuggest(null);
    // next-intl 라우터가 NEXT_LOCALE 쿠키를 심고 해당 로케일로 이동 → 재방문 시
    // 그 언어로 진입(계약 2).
    router.replace(pathname, { locale: suggest });
  };

  const dismiss = () => {
    markLocaleSuggestDismissed();
    setSuggest(null);
  };

  return (
    <div className="fixed inset-x-0 top-0 z-toast flex justify-center px-4 pt-3">
      <div className="flex items-center gap-3 rounded-full border border-line bg-paper px-4 py-2 text-sm text-ink shadow-memphis-sm">
        <span className="whitespace-nowrap">
          <span aria-hidden className="mr-1">
            {copy.flag}
          </span>
          {copy.question}
        </span>
        <Button size="xs" variant="primary" onClick={accept}>
          {copy.accept}
        </Button>
        <Button size="xs" variant="ghost" onClick={dismiss}>
          Continue in English
        </Button>
      </div>
    </div>
  );
}
