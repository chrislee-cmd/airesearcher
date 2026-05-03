'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth, useRequireAuth } from './auth-provider';

type Service = {
  key: string;
  name: string;
  region: string;
  href: string;
  tagline: string;
  highlights: string[];
  accent?: boolean;
};

const SERVICES: Service[] = [
  {
    key: 'proby',
    name: 'Proby',
    region: 'Korea',
    href: 'https://proby.io',
    tagline: '한국어 인터뷰에 최적화된 AI 모더레이터',
    highlights: ['한국어 음성 우선', '리서치 워크플로 통합', '국내 리크루팅 연동'],
    accent: true,
  },
  {
    key: 'listenlabs',
    name: 'Listen Labs',
    region: 'USA',
    href: 'https://listenlabs.ai',
    tagline: 'Voice-first AI moderator at scale',
    highlights: ['수백 명 동시 진행', 'YC-backed', '영문 인터뷰 강점'],
  },
  {
    key: 'outset',
    name: 'Outset',
    region: 'USA',
    href: 'https://outset.ai',
    tagline: 'AI-moderated qualitative research',
    highlights: ['B2B 리서치 사례 다수', '자동 테마 추출', '엔터프라이즈 도입'],
  },
  {
    key: 'conveo',
    name: 'Conveo',
    region: 'EU',
    href: 'https://conveo.ai',
    tagline: 'Conversational AI interviews',
    highlights: ['다국어 모더레이션', '브랜드/UX 인터뷰', '유럽 시장 강세'],
  },
];

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function ModeratorServicesCarousel() {
  const t = useTranslations('Moderator');
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const [statusMap, setStatusMap] = useState<Record<string, Status>>({});
  const tipTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateButtons = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanPrev(scrollLeft > 4);
    setCanNext(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateButtons();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateButtons, { passive: true });
    window.addEventListener('resize', updateButtons);
    return () => {
      el.removeEventListener('scroll', updateButtons);
      window.removeEventListener('resize', updateButtons);
    };
  }, [updateButtons]);

  useEffect(() => {
    const timers = tipTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const scrollByCard = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('[data-card]');
    const step = card ? card.offsetWidth + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  const submitInquiry = (service: Service) => {
    requireAuth(() => {
      void sendInquiry(service);
    });
  };

  async function sendInquiry(service: Service) {
    setStatusMap((m) => ({ ...m, [service.key]: 'sending' }));
    try {
      const res = await fetch('/api/moderator/inquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service: service.name }),
      });
      const next: Status = res.ok ? 'sent' : 'error';
      setStatusMap((m) => ({ ...m, [service.key]: next }));
    } catch {
      setStatusMap((m) => ({ ...m, [service.key]: 'error' }));
    }
    clearTimeout(tipTimers.current[service.key]);
    tipTimers.current[service.key] = setTimeout(() => {
      setStatusMap((m) => ({ ...m, [service.key]: 'idle' }));
    }, 3000);
  }

  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
        <div>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-mute-soft">
            {t('benchmarkLabel')}
          </p>
          <h2 className="mt-2 text-[20px] font-bold tracking-[-0.018em] text-ink-2">
            {t('benchmarkTitle')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('prev')}
            onClick={() => scrollByCard(-1)}
            disabled={!canPrev}
            className="flex h-8 w-8 items-center justify-center border border-line bg-paper text-[14px] text-ink-2 transition-colors duration-[120ms] hover:bg-paper-soft disabled:cursor-not-allowed disabled:opacity-30 [border-radius:4px]"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={t('next')}
            onClick={() => scrollByCard(1)}
            disabled={!canNext}
            className="flex h-8 w-8 items-center justify-center border border-line bg-paper text-[14px] text-ink-2 transition-colors duration-[120ms] hover:bg-paper-soft disabled:cursor-not-allowed disabled:opacity-30 [border-radius:4px]"
          >
            ›
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('benchmarkDescription')}
      </p>

      <div
        ref={trackRef}
        className="mt-6 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SERVICES.map((s) => {
          const status = statusMap[s.key] ?? 'idle';
          const sending = status === 'sending';
          const showTip = status === 'sent' || status === 'error';
          const tipText = status === 'error' ? t('inquiryError') : t('inquirySent');
          return (
            <div
              key={s.key}
              data-card
              className={`group relative flex w-[300px] shrink-0 snap-start flex-col border bg-paper p-5 [border-radius:4px] ${
                s.accent ? 'border-amore' : 'border-line'
              }`}
            >
              {s.accent && (
                <span className="absolute right-3 top-3 border border-amore bg-amore-bg px-2 py-[2px] text-[10px] font-medium tracking-[0.06em] text-amore [border-radius:2px]">
                  {t('thisService')}
                </span>
              )}
              <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-mute-soft">
                {s.region}
              </p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.01em] text-ink-2">
                {s.name}
              </h3>
              <p className="mt-2 text-[12.5px] leading-[1.65] text-mute">
                {s.tagline}
              </p>
              <ul className="mt-4 space-y-1.5 border-t border-line-soft pt-3">
                {s.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-start gap-2 text-[12px] leading-[1.55] text-ink-2"
                  >
                    <span className="mt-[7px] inline-block h-[3px] w-[3px] shrink-0 bg-mute" />
                    {h}
                  </li>
                ))}
              </ul>

              <div className="relative mt-5">
                <button
                  type="button"
                  onClick={() => submitInquiry(s)}
                  disabled={sending}
                  className="w-full border border-ink bg-ink px-3 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50 [border-radius:4px]"
                >
                  {sending ? t('inquirySending') : t('inquiry')}
                </button>
                {showTip && (
                  <div
                    role="status"
                    className={`absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border px-3 py-1.5 text-[11.5px] font-medium [border-radius:4px] ${
                      status === 'error'
                        ? 'border-warning-line bg-warning-bg text-warning'
                        : 'border-amore bg-amore-bg text-amore'
                    }`}
                  >
                    {tipText}
                  </div>
                )}
              </div>
              {user && (
                <p className="mt-2 text-[10.5px] tabular-nums text-mute-soft">
                  {t('inquiryFromHint', { email: user.email ?? '' })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
