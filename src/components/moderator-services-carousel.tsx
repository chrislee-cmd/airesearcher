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

const AUTO_ROLL_MS = 5000;

export function ModeratorServicesCarousel() {
  const t = useTranslations('Moderator');
  const { user } = useAuth();
  const requireAuth = useRequireAuth();
  const [statusMap, setStatusMap] = useState<Record<string, Status>>({});
  const tipTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const timers = tipTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SERVICES.length);
    }, AUTO_ROLL_MS);
    return () => clearInterval(id);
  }, [paused]);

  const goTo = useCallback((i: number) => {
    setIndex(((i % SERVICES.length) + SERVICES.length) % SERVICES.length);
  }, []);

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

  const s = SERVICES[index];
  const status = statusMap[s.key] ?? 'idle';
  const sending = status === 'sending';
  const showTip = status === 'sent' || status === 'error';
  const tipText = status === 'error' ? t('inquiryError') : t('inquirySent');

  return (
    <section
      className="mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className={`relative grid grid-cols-1 gap-0 border bg-paper md:grid-cols-[280px_1fr] [border-radius:4px] ${
          s.accent ? 'border-amore' : 'border-line'
        }`}
        aria-live="polite"
      >
        {s.accent && (
          <span className="absolute right-3 top-3 border border-amore bg-amore-bg px-2 py-[2px] text-[10px] font-medium tracking-[0.06em] text-amore [border-radius:2px]">
            {t('thisService')}
          </span>
        )}

        <div className="flex flex-col justify-center border-b border-line-soft p-6 md:border-b-0 md:border-r">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-mute-soft">
            {s.region}
          </p>
          <h3 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-ink-2">
            {s.name}
          </h3>
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-[11.5px] tabular-nums text-mute hover:text-ink"
          >
            {s.href.replace(/^https?:\/\//, '')}
          </a>
        </div>

        <div className="flex flex-col p-6">
          <p className="text-[13px] leading-[1.65] text-ink-2">{s.tagline}</p>
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
              className="border border-ink bg-ink px-4 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50 [border-radius:4px]"
            >
              {sending ? t('inquirySending') : t('inquiry')}
            </button>
            {showTip && (
              <div
                role="status"
                className={`absolute -top-2 left-0 z-10 -translate-y-full whitespace-nowrap border px-3 py-1.5 text-[11.5px] font-medium [border-radius:4px] ${
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
      </div>

      <div className="mt-5 flex items-center justify-center gap-2">
        {SERVICES.map((item, i) => {
          const active = i === index;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.name}
              aria-current={active}
              onClick={() => goTo(i)}
              className={`h-[6px] transition-all duration-[160ms] [border-radius:999px] ${
                active ? 'w-6 bg-ink' : 'w-[6px] bg-line hover:bg-mute-soft'
              }`}
            />
          );
        })}
      </div>
    </section>
  );
}
