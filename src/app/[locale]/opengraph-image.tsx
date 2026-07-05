import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

export const alt = 'Research-Canvas — Your research workflow, in one place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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
        {/* pink dot accent */}
        <div
          style={{
            position: 'absolute',
            top: 70,
            right: 110,
            width: 110,
            height: 110,
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
            top: 220,
            right: 240,
            width: 64,
            height: 64,
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
            marginBottom: 40,
          }}
        >
          {tagline}
        </div>

        {/* headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            color: '#000',
            fontWeight: 800,
            fontSize: 96,
            lineHeight: 1.04,
            letterSpacing: '-0.035em',
            maxWidth: 950,
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

        {/* brand bottom */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 'auto',
            fontSize: 28,
            fontWeight: 800,
            color: '#000',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              background: '#ff5c8a',
              border: '4px solid #000',
              borderRadius: '10px',
              boxShadow: '4px 4px 0 #000',
            }}
          />
          Research-Canvas
        </div>
      </div>
    ),
    { ...size },
  );
}
