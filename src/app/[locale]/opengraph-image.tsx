import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

export const alt = 'Research-Canvas — Your research workflow, in one place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Satori (next/og) can't fetch /public assets by URL — read the file and inline
// it as a base64 data URI. PNG is used instead of the SVG lockup because Satori
// rasterizes SVG without the app fonts, dropping the wordmark text. The self-
// contained full-color icon carries the mark; the wordmark is a real text node.
async function loadBrandIcon() {
  const bytes = await readFile(
    join(process.cwd(), 'public/branding/icons/03_ICON_FULL_COLOR.png'),
  );
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Landing' });

  const title = locale === 'ko'
    ? '한 화면에서, 처음부터 끝까지'
    : 'Your research, end to end';
  const subtitle = locale === 'ko'
    ? '리서치 캔버스'
    : 'on one canvas';
  const tagline = t('hero.tagline');

  const iconSrc = await loadBrandIcon();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fffce1',
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.18) 2px, transparent 2px)',
          backgroundSize: '48px 48px',
          padding: '80px',
          position: 'relative',
        }}
      >
        {/* corner accents — parked in the top-right corner, clear of all text */}
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 90,
            width: 108,
            height: 108,
            borderRadius: '50%',
            background: '#ff5c8a',
            border: '6px solid #000',
            boxShadow: '8px 8px 0 #000',
            transform: 'rotate(-10deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 96,
            right: 236,
            width: 58,
            height: 58,
            borderRadius: '12px',
            background: '#cdebd9',
            border: '5px solid #000',
            boxShadow: '6px 6px 0 #000',
            transform: 'rotate(14deg)',
          }}
        />

        {/* tagline pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#ff5c8a',
            color: '#000',
            border: '5px solid #000',
            borderRadius: '999px',
            padding: '10px 30px',
            fontSize: 30,
            fontWeight: 700,
            boxShadow: '6px 6px 0 #000',
            transform: 'rotate(-2deg)',
            alignSelf: 'flex-start',
            marginBottom: 44,
          }}
        >
          {tagline}
        </div>

        {/* headline — constrained width keeps it clear of the corner accents */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            color: '#000',
            fontWeight: 800,
            fontSize: 88,
            lineHeight: 1.04,
            letterSpacing: '-0.035em',
            maxWidth: 820,
          }}
        >
          <div style={{ display: 'flex' }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                background: '#ffd9c9',
                border: '6px solid #000',
                borderRadius: '14px',
                padding: '0 24px',
                boxShadow: '8px 8px 0 #000',
                transform: 'rotate(-1deg)',
                display: 'flex',
              }}
            >
              {subtitle}
            </span>
          </div>
        </div>

        {/* brand lockup — real icon (PNG) + wordmark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 'auto',
            fontSize: 34,
            fontWeight: 800,
            color: '#000',
          }}
        >
          { }
          <img src={iconSrc} width={60} height={60} alt="Research-Canvas" />
          Research-Canvas
        </div>
      </div>
    ),
    { ...size },
  );
}
