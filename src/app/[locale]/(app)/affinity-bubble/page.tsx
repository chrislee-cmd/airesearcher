import Image from 'next/image';
import { setRequestLocale, getTranslations } from 'next-intl/server';

const SITE_URL = 'https://affinitybubble.com/';

export default async function AffinityBubblePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('AffinityBubble');

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('eyebrow')}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
              {t('title')}
            </h1>
            <p className="mt-2 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
              {t('description')}
            </p>
          </div>
          <a
            href={SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 border border-ink bg-ink px-5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
          >
            {t('inquiry')}
          </a>
        </div>
      </div>

      <figure className="mt-8 overflow-hidden border border-line bg-paper [border-radius:4px]">
        {/* The image is a static preview of the affinitybubble.com output —
            link target is the live site. Sized via aspect-ratio so it scales
            without layout shift on slow networks. */}
        <Image
          src="/affinity-bubble.jpeg"
          alt={t('alt')}
          width={1916}
          height={1374}
          className="h-auto w-full"
          priority
        />
        <figcaption className="border-t border-line-soft px-5 py-3 text-[11px] text-mute-soft">
          {t('caption')}
        </figcaption>
      </figure>

      <div className="mt-8 flex justify-center">
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-ink bg-ink px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
        >
          {t('inquiry')} →
        </a>
      </div>
    </div>
  );
}
