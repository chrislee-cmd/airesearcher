import { setRequestLocale } from 'next-intl/server';
import { SampleCluster } from '../_components/sample-cluster';

export default async function DesignAirbnbPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="-m-6 grid grid-cols-1 lg:grid-cols-2">
      <div className="border-b border-line lg:border-b-0 lg:border-r">
        <SampleCluster
          systemLabel="Bento (current)"
          tagline="Editorial, warm cream canvas, single amore accent (#a06fda)."
        />
      </div>
      <div data-design="airbnb">
        <SampleCluster
          systemLabel="Airbnb"
          tagline="Marketplace, pure white canvas, single Rausch accent (#ff385c)."
        />
      </div>
    </div>
  );
}
