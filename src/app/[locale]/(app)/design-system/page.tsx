import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { ChapterHeader } from '@/components/editorial';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/button';
import { IconButton, type IconButtonVariant, type IconButtonSize } from '@/components/ui/icon-button';
import { ChromeButton, type ChromeButtonVariant, type ChromeButtonSize } from '@/components/ui/chrome-button';
import { Input } from '@/components/ui/input';
import { ChromeInput } from '@/components/ui/chrome-input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { ModalDemo, FileDropZoneDemo, DropdownMenuDemo } from './demos';

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
      <FontSizeTokens />
      <ColorTokens />
      <ZIndexTokens />
      <ButtonSection />
      <IconButtonSection />
      <ChromeButtonSection />
      <InputSection />
      <ChromeInputSection />
      <TextareaSection />
      <SelectSection />
      <CheckboxSection />
      <ModalSection />
      <SkeletonSection />
      <LabelSection />
      <FileDropZoneSection />
      <MenuSection />
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
            <code className="text-sm text-ink">{t.name}</code>
            <p className="text-sm text-mute-soft tabular-nums">{t.value}</p>
            <p className="text-center text-xs-soft text-mute">{t.usage}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FontSizeTokens() {
  const tokens = [
    { name: 'text-xs', px: '10px', usage: '극소 caps/labels', absorbs: '9, 9.5, 10' },
    { name: 'text-xs-soft', px: '10.5px', usage: 'amore-soft eyebrow', absorbs: '10.5' },
    { name: 'text-sm', px: '11.5px', usage: '작은 UI 텍스트', absorbs: '11, 11.5' },
    { name: 'text-md', px: '12.5px', usage: '기본 본문', absorbs: '12, 12.5' },
    { name: 'text-lg', px: '13px', usage: '강조 본문', absorbs: '13, 13.5' },
    { name: 'text-xl', px: '15px', usage: '소제목', absorbs: '14, 15' },
    { name: 'text-2xl', px: '18px', usage: '제목', absorbs: '16, 17, 18' },
    { name: 'text-3xl', px: '22px', usage: '대제목', absorbs: '20, 22, 24' },
    { name: 'text-display', px: '32px', usage: '히어로/디스플레이', absorbs: '26, 28, 42' },
  ];
  return (
    <Section title="Font Size" hint="text-{name} 사용. text-[Npx] 직접 사용은 lint 차단 예정 (B-1 마이그 완료 후).">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((t) => (
          <div
            key={t.name}
            className="flex flex-col gap-2 border border-line bg-paper p-3 rounded-sm"
          >
            <div className={`text-ink-2 ${t.name}`}>
              표준 텍스트 샘플
            </div>
            <div className="flex items-center justify-between border-t border-line-soft pt-2">
              <code className="text-sm text-ink">{t.name}</code>
              <span className="text-xs-soft tabular-nums text-mute-soft">{t.px}</span>
            </div>
            <p className="text-xs-soft text-mute">{t.usage}</p>
            <p className="text-xs text-mute-soft">흡수: {t.absorbs}</p>
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
                  <code className="text-xs-soft text-ink">{t.name}</code>
                  <p className="text-xs text-mute-soft tabular-nums">{t.hex}</p>
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
        <table className="w-full text-md">
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

function InputSection() {
  return (
    <Section
      title="Input"
      hint="src/components/ui/input.tsx · label / helper / error / size (sm|md) / leftSlot / rightSlot / fullWidth · 14px radius capsule"
    >
      <Subsection label="Sizes (default + label + helper)">
        <div className="grid grid-cols-2 gap-6">
          <Input size="sm" label="size=sm" helper="px-2.5 py-1.5 text-md" placeholder="value" />
          <Input size="md" label="size=md" helper="px-3 py-2 text-lg (default)" placeholder="value" />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Input label="Default" placeholder="value" />
          <Input label="Disabled" disabled placeholder="value" />
          <Input label="Error" error="이메일 형식이 올바르지 않습니다." defaultValue="bad" />
          <Input label="Helper text" helper="회사 도메인 권장" placeholder="email@…" />
        </div>
      </Subsection>

      <Subsection label="leftSlot · rightSlot · required">
        <div className="grid grid-cols-2 gap-6">
          <Input label="leftSlot" leftSlot={<span aria-hidden>$</span>} placeholder="0.00" />
          <Input label="rightSlot" rightSlot={<span aria-hidden>%</span>} placeholder="0" />
          <Input label="required" required placeholder="value" />
        </div>
      </Subsection>
    </Section>
  );
}

function ChromeInputSection() {
  return (
    <Section
      title="ChromeInput"
      hint="src/components/ui/chrome-input.tsx · 4px radius (chrome) · in-row name/rename/URL · label/error 없음 — 인라인 사용 의도"
    >
      <Subsection label="Sizes">
        <div className="flex flex-wrap items-center gap-2">
          <ChromeInput size="xs" placeholder="size=xs" />
          <ChromeInput size="sm" placeholder="size=sm (default)" />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex flex-wrap items-center gap-2">
          <ChromeInput placeholder="default" />
          <ChromeInput disabled placeholder="disabled" />
          <ChromeInput readOnly defaultValue="readonly value" />
        </div>
      </Subsection>
    </Section>
  );
}

function TextareaSection() {
  return (
    <Section
      title="Textarea"
      hint="src/components/ui/textarea.tsx · Input 과 동일한 label/helper/error/fullWidth contract · rows prop (기본 4) · resize-y"
    >
      <Subsection label="Default + label + helper">
        <Textarea label="설명" helper="자유 형식. 줄바꿈 가능." placeholder="여기에 입력…" />
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Textarea label="Disabled" disabled placeholder="value" rows={3} />
          <Textarea label="Error" error="최소 10자 이상 입력하세요." defaultValue="short" rows={3} />
        </div>
      </Subsection>
    </Section>
  );
}

function SelectSection() {
  const options = [
    { value: 'admin', label: '관리자 (admin)' },
    { value: 'member', label: '멤버 (member)' },
    { value: 'viewer', label: '뷰어 (viewer)' },
  ];
  return (
    <Section
      title="Select"
      hint="src/components/ui/select.tsx · native <select> 위에 appearance-none + 자체 chevron · Input 과 같은 contract"
    >
      <Subsection label="Sizes (options prop + placeholder)">
        <div className="grid grid-cols-2 gap-6">
          <Select
            size="sm"
            label="size=sm"
            placeholder="역할 선택…"
            options={options}
          />
          <Select
            size="md"
            label="size=md (default)"
            placeholder="역할 선택…"
            options={options}
          />
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="grid grid-cols-2 gap-6">
          <Select label="Default" defaultValue="member" options={options} />
          <Select label="Disabled" disabled defaultValue="member" options={options} />
          <Select label="Error" error="역할을 선택하세요." options={options} />
          <Select label="Helper" helper="조직 전체에 적용됩니다." options={options} />
        </div>
      </Subsection>
    </Section>
  );
}

function CheckboxSection() {
  return (
    <Section
      title="Checkbox"
      hint="src/components/ui/checkbox.tsx · accent-amore 자동 적용 · 시각만 — 텍스트는 <label> wrapper 로 직접 붙임"
    >
      <Subsection label="Sizes">
        <div className="flex items-center gap-6">
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox size="sm" defaultChecked />
            <span>size=sm (default)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox size="md" defaultChecked />
            <span>size=md</span>
          </label>
        </div>
      </Subsection>

      <Subsection label="States">
        <div className="flex items-center gap-6">
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox />
            <span>Default (off)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-ink">
            <Checkbox defaultChecked />
            <span>Checked</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-mute">
            <Checkbox disabled />
            <span>Disabled (off)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-md text-mute">
            <Checkbox disabled defaultChecked />
            <span>Disabled (checked)</span>
          </label>
        </div>
      </Subsection>
    </Section>
  );
}

function ModalSection() {
  return (
    <Section
      title="Modal"
      hint="src/components/ui/modal.tsx · 3 sizes (sm/md/lg) · Esc 닫기 · backdrop 클릭 닫기 · body scroll lock · focus restore · z-modal(50)"
    >
      <Subsection label="Sizes (interactive)">
        <ModalDemo />
      </Subsection>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section
      title="Skeleton"
      hint="src/components/ui/skeleton.tsx · 3 variants (text/block/circle) · animate-pulse bg-line-soft"
    >
      <Subsection label="Variants">
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=text</div>
            <Skeleton variant="text" />
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="60%" />
          </div>
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=block</div>
            <Skeleton variant="block" height={80} />
          </div>
          <div className="space-y-2">
            <div className="eyebrow-mute">variant=circle</div>
            <Skeleton variant="circle" />
            <Skeleton variant="circle" width={48} height={48} />
            <Skeleton variant="circle" width={64} height={64} />
          </div>
        </div>
      </Subsection>
    </Section>
  );
}

function LabelSection() {
  return (
    <Section
      title="Label"
      hint="src/components/ui/label.tsx · UPPERCASE / tracked / text-sm field label · Input/Textarea/Select 가 내부적으로 사용 · 직접 import 는 드물어야 함"
    >
      <Subsection label="Default / required">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <Label htmlFor="lbl-demo-1">Default</Label>
            <Input id="lbl-demo-1" placeholder="value" />
          </div>
          <div>
            <Label htmlFor="lbl-demo-2" required>
              Required
            </Label>
            <Input id="lbl-demo-2" required placeholder="value" />
          </div>
        </div>
      </Subsection>
    </Section>
  );
}

function FileDropZoneSection() {
  return (
    <Section
      title="FileDropZone"
      hint="src/components/ui/file-drop-zone.tsx · drag·drop + 클릭 picker · accept / multiple / maxSizeBytes / disabled · 워크스페이스 artifact drop 지원 (onDropRaw)"
    >
      <Subsection label="Default (drag or click)">
        <FileDropZoneDemo />
      </Subsection>
    </Section>
  );
}

function MenuSection() {
  return (
    <Section
      title="DropdownMenu"
      hint="src/components/ui/dropdown-menu.tsx · headless menu primitive (render-prop trigger) · 키보드 ↑↓ Enter Esc · click-outside 자동 닫기 · align (start|end) · side (top|bottom) · hint 가능 · optional label"
    >
      <Subsection label="Interactive (align / side / label)">
        <DropdownMenuDemo />
      </Subsection>
      <Subsection label="Compositions in the codebase">
        <div className="text-md text-mute space-y-1.5">
          <p>
            DropdownMenu 위에 도메인 wrapper 두 개가 있습니다 — 직접 dropdown 코드를 작성하지 말고 가능하면 wrapper 사용:
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>
              <code className="font-mono text-ink-2">DownloadMenu</code> (<code className="font-mono">ui/download-menu.tsx</code>) — ExportFormat 별 url / blob / action 항목. 1개일 때는 plain Button 으로 fallback.
            </li>
            <li>
              <code className="font-mono text-ink-2">ShareMenu</code> (<code className="font-mono">ui/share-menu.tsx</code>) — Google Docs / Sheets / Notion 전송. 인증 끊긴 경우 connect URL 로 redirect, 토스트로 결과 알림.
            </li>
          </ul>
        </div>
      </Subsection>
    </Section>
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
        <h2 className="text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {hint ? <p className="text-sm text-mute-soft">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
