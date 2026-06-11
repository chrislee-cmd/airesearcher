import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { ChapterHeader } from '@/components/editorial';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/button';
import { IconButton, type IconButtonVariant, type IconButtonSize } from '@/components/ui/icon-button';
import { ChromeButton, type ChromeButtonVariant, type ChromeButtonSize } from '@/components/ui/chrome-button';

export default async function DesignSystemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader
        title="Design System"
        description="현재 코드베이스에 정의된 모든 디자인 토큰과 표준 부품의 카탈로그. 새 화면 만들기 전 여기에서 가능한 부품을 확인하고, 토큰 값은 globals.css 의 @theme 블록에서 관리합니다. 이 페이지는 super admin 만 접근 가능합니다."
      />

      <RadiusTokens />
      <ColorTokens />
      <ZIndexTokens />
      <ButtonSection />
      <IconButtonSection />
      <ChromeButtonSection />
    </div>
  );
}

function RadiusTokens() {
  const tokens = [
    { name: 'rounded-xs', value: '4px', usage: 'chip · badge · 작은 카드' },
    { name: 'rounded-sm', value: '14px', usage: '카드 · 모달 · 입력창 (기본)' },
    { name: 'rounded-md', value: '24px', usage: '대형 카드' },
    { name: 'rounded-lg', value: '32px', usage: '대형 컨테이너' },
    { name: 'rounded-full', value: '∞', usage: 'pill · 원형 버튼' },
  ];
  return (
    <Section title="Radius" hint="rounded-{name} 사용. [border-radius:Npx] 직접 사용은 lint 차단.">
      <div className="grid grid-cols-5 gap-3">
        {tokens.map((t) => (
          <div
            key={t.name}
            className="flex flex-col items-center gap-2 border border-line bg-paper p-4 rounded-sm"
          >
            <div className={`h-16 w-16 bg-amore-bg ${t.name}`} />
            <code className="text-[11px] text-ink">{t.name}</code>
            <p className="text-[11px] text-mute-soft tabular-nums">{t.value}</p>
            <p className="text-center text-[10.5px] text-mute">{t.usage}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ColorTokens() {
  const groups = [
    {
      heading: 'Brand · Surfaces',
      tokens: [
        { name: 'amore', cls: 'bg-amore', hex: '#a06fda' },
        { name: 'amore-soft', cls: 'bg-amore-soft', hex: '#b690e2' },
        { name: 'amore-bg', cls: 'bg-amore-bg', hex: '#e7defe' },
        { name: 'pacific', cls: 'bg-pacific', hex: '#1d1b20' },
        { name: 'pacific-bg', cls: 'bg-pacific-bg', hex: '#f3f0eb' },
        { name: 'paper', cls: 'bg-paper border-line border', hex: '#fbf7f2' },
        { name: 'paper-soft', cls: 'bg-paper-soft border-line border', hex: '#fefaf5' },
      ],
    },
    {
      heading: 'Text · Lines',
      tokens: [
        { name: 'ink', cls: 'bg-ink', hex: '#1d1b20' },
        { name: 'ink-2', cls: 'bg-ink-2', hex: '#2a262f' },
        { name: 'mute', cls: 'bg-mute', hex: '#5b5965' },
        { name: 'mute-soft', cls: 'bg-mute-soft', hex: '#8a8693' },
        { name: 'gray-warm', cls: 'bg-gray-warm', hex: '#6f6c78' },
        { name: 'line', cls: 'bg-line', hex: 'ink/10%' },
        { name: 'line-soft', cls: 'bg-line-soft', hex: 'ink/6%' },
      ],
    },
    {
      heading: 'Bento Pastels',
      tokens: [
        { name: 'lav', cls: 'bg-lav', hex: '#e7defe' },
        { name: 'peach', cls: 'bg-peach', hex: '#ffd9c9' },
        { name: 'mint', cls: 'bg-mint', hex: '#cdebd9' },
        { name: 'sun', cls: 'bg-sun', hex: '#fff1b6' },
        { name: 'sky', cls: 'bg-sky', hex: '#cfe6ff' },
        { name: 'rose', cls: 'bg-rose', hex: '#ffd0e2' },
      ],
    },
    {
      heading: 'Signal',
      tokens: [
        { name: 'success', cls: 'bg-success', hex: '#16a34a' },
        { name: 'warning', cls: 'bg-warning', hex: '#fb923c' },
        { name: 'warning-bg', cls: 'bg-warning-bg', hex: '#fff1e6' },
        { name: 'warning-line', cls: 'bg-warning-line', hex: '#ffd9bf' },
        { name: 'am-accent', cls: 'bg-am-accent', hex: '#fb923c' },
        { name: 'pm-accent', cls: 'bg-pm-accent', hex: '#6c7aff' },
      ],
    },
  ];
  return (
    <Section
      title="Color"
      hint="bg-{name} / text-{name} / border-{name} 형태로 사용. 새 색은 globals.css 의 @theme 블록에 토큰으로 추가 후 사용."
    >
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <div key={g.heading}>
            <div className="eyebrow-mute mb-3">{g.heading}</div>
            <div className="grid grid-cols-7 gap-3">
              {g.tokens.map((t) => (
                <div
                  key={t.name}
                  className="flex flex-col items-center gap-1.5 rounded-xs"
                >
                  <div className={`h-12 w-12 rounded-xs ${t.cls}`} />
                  <code className="text-[10.5px] text-ink">{t.name}</code>
                  <p className="text-[10px] text-mute-soft tabular-nums">{t.hex}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ZIndexTokens() {
  const tokens = [
    { name: 'z-table-sticky', value: 1, usage: '테이블 sticky 헤더' },
    { name: 'z-table-cell-sticky', value: 2, usage: '테이블 sticky 셀' },
    { name: 'z-table-resize', value: 3, usage: '컬럼 resize 핸들' },
    { name: 'z-fab', value: 40, usage: 'voice concierge FAB' },
    { name: 'z-modal', value: 50, usage: '모든 모달 (ui/modal · 페이지 ad-hoc 모달)' },
    { name: 'z-toast', value: 60, usage: 'toast / snackbar (modal 위)' },
    { name: 'z-overlay', value: 70, usage: 'voice concierge tour highlight (최상단)' },
  ];
  return (
    <Section
      title="Z-index"
      hint="z-{name} 사용. z-[N] 직접 사용은 lint 차단. 같은 레이어 안에서는 DOM 순서로 정렬."
    >
      <div className="border border-line bg-paper rounded-sm">
        <table className="w-full text-[12px]">
          <thead className="border-b border-line">
            <tr className="text-left">
              <th className="px-4 py-2.5 font-semibold text-ink-2">Token</th>
              <th className="px-4 py-2.5 font-semibold text-ink-2">Value</th>
              <th className="px-4 py-2.5 font-semibold text-ink-2">Usage</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.name} className="border-b border-line-soft last:border-b-0">
                <td className="px-4 py-2 font-mono text-ink">{t.name}</td>
                <td className="px-4 py-2 tabular-nums text-mute">{t.value}</td>
                <td className="px-4 py-2 text-mute">{t.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ButtonSection() {
  const variants: ButtonVariant[] = [
    'primary',
    'secondary',
    'ghost',
    'destructive',
    'link',
    'destructive-link',
  ];
  const sizes: ButtonSize[] = ['xs', 'sm', 'md', 'lg', 'cta'];
  return (
    <Section
      title="Button"
      hint="src/components/ui/button.tsx · 6 variants × 5 sizes · loading / fullWidth / left|rightIcon"
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=primary)">
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((s) => (
            <Button key={s} size={s}>
              {s}
            </Button>
          ))}
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button disabled>Disabled</Button>
          <Button loading loadingLabel="Loading…">
            Submit
          </Button>
        </div>
      </Subsection>

      <Subsection label="fullWidth">
        <Button fullWidth>fullWidth</Button>
      </Subsection>
    </Section>
  );
}

function IconButtonSection() {
  const variants: IconButtonVariant[] = ['ghost', 'ghost-danger', 'ghost-brand', 'bordered'];
  const sizes: IconButtonSize[] = ['compact', 'sm', 'md', 'lg'];
  return (
    <Section
      title="IconButton"
      hint="src/components/ui/icon-button.tsx · aria-label required (a11y enforced by type) · variants for hover treatment · sizes are shape"
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap items-center gap-3">
          {variants.map((v) => (
            <IconButton key={v} variant={v} size="md" aria-label={v}>
              <CloseIcon />
            </IconButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=bordered)">
        <div className="flex flex-wrap items-center gap-3">
          {sizes.map((s) => (
            <IconButton key={s} variant="bordered" size={s} aria-label={s}>
              <CloseIcon />
            </IconButton>
          ))}
        </div>
      </Subsection>
    </Section>
  );
}

function ChromeButtonSection() {
  const variants: ChromeButtonVariant[] = ['default', 'mute', 'primary'];
  const sizes: ChromeButtonSize[] = ['xs', 'sm', 'md', 'lg'];
  return (
    <Section
      title="ChromeButton"
      hint="src/components/ui/chrome-button.tsx · 4px radius chrome (별도로 squared) · 보조 액션용. uppercase prop 으로 caps treatment."
    >
      <Subsection label="Variants (size=md)">
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => (
            <ChromeButton key={v} variant={v}>
              {v}
            </ChromeButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="Sizes (variant=default)">
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((s) => (
            <ChromeButton key={s} size={s}>
              {s}
            </ChromeButton>
          ))}
        </div>
      </Subsection>

      <Subsection label="uppercase=true">
        <ChromeButton uppercase>Create folder</ChromeButton>
      </Subsection>
    </Section>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Subsection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="eyebrow-mute mb-2">{label}</div>
      {children}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between border-b border-line-soft pb-2">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {hint ? <p className="text-[11px] text-mute-soft">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
