import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { SampleCluster } from './_components/sample-cluster';
import { DESIGN_BRANDS, type DesignBrand } from '@/lib/design-brands';

export default async function DesignIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="-m-6">
      <header className="border-b border-line bg-paper px-8 py-6">
        <h1 className="text-2xl font-semibold text-ink">Design brands — token comparison</h1>
        <p className="mt-1 text-md text-mute">
          {DESIGN_BRANDS.length} systems applied to the same sample cluster via{' '}
          <code className="rounded-xs bg-pacific-bg px-1.5 py-0.5 text-sm">
            [data-design=&quot;&lt;key&gt;&quot;]
          </code>{' '}
          wrappers in <code className="text-sm">globals.css</code>. Each card&apos;s footer links to{' '}
          <code className="text-sm">/canvas?design=&lt;key&gt;</code> to apply on the real board.
        </p>
      </header>
      <div className="bg-line-soft p-px">
        <div className="grid grid-cols-1 gap-px md:grid-cols-2 xl:grid-cols-3">
          {DESIGN_BRANDS.map((brand) => (
            <BrandCell key={brand.key} brand={brand} locale={locale} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandCell({ brand, locale }: { brand: DesignBrand; locale: string }) {
  const isBento = brand.key === 'bento';
  const wrapperProps = isBento ? {} : { 'data-design': brand.key };

  return (
    <div {...wrapperProps} className="flex flex-col bg-paper">
      <div className="flex-1">
        <SampleCluster systemLabel={brand.label} tagline={brand.tagline} />
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-8 py-4 text-sm text-mute">
        <span className="font-medium text-ink">{brand.label}</span>
        {isBento ? (
          <span className="text-mute-soft">default tokens</span>
        ) : (
          <Link
            href={`/${locale}/canvas?design=${brand.key}`}
            className="rounded-xs px-2 py-1 font-medium text-amore underline-offset-2 hover:underline"
          >
            Apply on /canvas →
          </Link>
        )}
      </footer>
    </div>
  );
}
