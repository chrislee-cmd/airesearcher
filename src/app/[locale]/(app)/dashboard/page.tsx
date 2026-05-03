import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURES } from '@/lib/features';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <section className="border-b border-line pb-10">
        <h1 className="text-[36px] font-bold leading-[1.15] tracking-[-0.025em] text-ink">
          AI 리서처
        </h1>
        <p className="mt-3 max-w-[640px] text-[13px] leading-[1.75] text-mute">
          정성·정량 인터뷰 데이터를 인용문, 스크립트, 인터뷰 결과, 전체 리포트로
          정리해주는 출판물 톤의 리서치 콘솔.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="border-b border-line pb-3 text-[20px] font-bold tracking-[-0.018em] text-ink-2">
          무엇을 만들 것인가
        </h2>
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          좌측 메뉴에서 항목을 선택해 시작하세요. 각 생성기는 입력으로부터 한 단위
          산출물을 만들어내며 사용한 만큼 크레딧을 차감합니다.
        </p>

        <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2">
          {FEATURES.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className="group block border border-line bg-paper p-5 transition-colors duration-[120ms] hover:bg-paper-soft [border-radius:4px]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[17px] font-semibold tracking-[-0.005em] text-ink-2">
                  {t(`${f.key}.title`)}
                </h3>
                <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
                  {t(`${f.key}.cost`)}
                </span>
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
                {t(`${f.key}.description`)}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
