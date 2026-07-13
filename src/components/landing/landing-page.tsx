import { Outfit } from 'next/font/google';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CanvasHero } from './canvas-hero';
import { FeatureGrid } from './feature-grid';
import { WorkflowSection } from './workflow-section';
import { SecuritySection } from './security-section';
import { companyInfoLinesKo, companyInfoLinesEn } from '@/lib/company';
import {
  CREDIT_BUNDLES,
  SUBSCRIPTION_TIERS,
  type CreditBundleId,
  type SubscriptionTierId,
} from '@/lib/features';
import './landing.css';

// 랜딩 가격 카드 → CREDIT_BUNDLES 파생 (드리프트 차단). 카피는 messages 에
// 두되 ₩ 숫자·크레딧 수·단가는 이 상수에서 주입한다 — messages 에 가격을
// 하드코딩하지 않으므로 A1 리프라이스가 랜딩에 자동 반영된다.
const krw = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
const landingBundle = (id: CreditBundleId) => {
  const b = CREDIT_BUNDLES.find((x) => x.id === id)!;
  return {
    price: krw(b.priceKrw ?? 0),
    credits: krw(b.credits),
    perCredit: krw(b.perCreditKrw ?? 0),
  };
};

// 구독 티어도 같은 원리로 SUBSCRIPTION_TIERS 에서 파생 — B1 백엔드 SSOT 와
// 드리프트 0. 월 요금·포함 크레딧만 주입하고 카피는 messages 에 둔다.
const landingSub = (id: SubscriptionTierId) => {
  const s = SUBSCRIPTION_TIERS.find((x) => x.id === id)!;
  return { price: krw(s.monthlyPriceKrw), credits: krw(s.includedCredits) };
};

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

export async function LandingPage({ locale }: { locale: string }) {
  const t = await getTranslations('Landing');

  const richTags = {
    hl: (chunks: React.ReactNode) => <span className="hl">{chunks}</span>,
    hlPeach: (chunks: React.ReactNode) => <span className="hl peach">{chunks}</span>,
    hlMint: (chunks: React.ReactNode) => <span className="hl mint">{chunks}</span>,
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    b: (chunks: React.ReactNode) => <b>{chunks}</b>,
    em: (chunks: React.ReactNode) => <em>{chunks}</em>,
    span: (chunks: React.ReactNode) => <span>{chunks}</span>,
    br: () => <br />,
  };

  const ctaStart = '/login?next=/canvas';
  const ctaCredits = '/login?next=/credits';

  // 가격 카드별 팩 매핑 — mini/starter/plus 3팩을 랜딩 티저로 노출.
  // enterprise 는 견적(상수 파생 없음).
  const priceStarter = landingBundle('mini');
  const priceTeam = landingBundle('starter');
  const priceStudio = landingBundle('plus');

  // 월 구독 3티어 — 일회성 팩과 병치 노출 (접근성 톤).
  const subSolo = landingSub('solo');
  const subPlus = landingSub('plus');
  const subPro = landingSub('pro');

  const heroLabels = {
    tagline: t('hero.tagline'),
    headline: t.rich('hero.headline', richTags),
    lead: t.rich('hero.lead', richTags),
    ctaPrimary: t('hero.ctaPrimary'),
    ctaSecondary: t('hero.ctaSecondary'),
    postscript: t.rich('hero.postscript', richTags),
    canvasMeta: t('hero.canvasMeta'),
    canvasBrand: t('hero.canvasBrand'),
    canvasCredits: t('hero.canvasCredits'),
    canvasSaved: t('hero.canvasSaved'),
    widgetTranscriptsTitle: t('hero.widgetTranscriptsTitle'),
    widgetTranscriptsLine1: t('hero.widgetTranscriptsLine1'),
    widgetTranscriptsLine2: t('hero.widgetTranscriptsLine2'),
    widgetTranscriptsLine3: t('hero.widgetTranscriptsLine3'),
    widgetTranslateTitle: t('hero.widgetTranslateTitle'),
    widgetTranslateHost: t('hero.widgetTranslateHost'),
    widgetTranslateGuest: t('hero.widgetTranslateGuest'),
    widgetTranslateLine: t('hero.widgetTranslateLine'),
    widgetTranslateGuestLine: t('hero.widgetTranslateGuestLine'),
    widgetProbingTitle: t('hero.widgetProbingTitle'),
    widgetProbingHint: t('hero.widgetProbingHint'),
    widgetProbingQuestion: t('hero.widgetProbingQuestion'),
    widgetInsightsTitle: t('hero.widgetInsightsTitle'),
    widgetInsightsCluster1: t('hero.widgetInsightsCluster1'),
    widgetInsightsCluster2: t('hero.widgetInsightsCluster2'),
    widgetInsightsCluster3: t('hero.widgetInsightsCluster3'),
    widgetDeskTitle: t('hero.widgetDeskTitle'),
    widgetDeskSource1: t('hero.widgetDeskSource1'),
    widgetDeskSource2: t('hero.widgetDeskSource2'),
    widgetRecruitingTitle: t('hero.widgetRecruitingTitle'),
    widgetRecruitingSubtitle: t('hero.widgetRecruitingSubtitle'),
    widgetRecruitingP1: t('hero.widgetRecruitingP1'),
    widgetRecruitingP1Status: t('hero.widgetRecruitingP1Status'),
    widgetRecruitingP2: t('hero.widgetRecruitingP2'),
    widgetRecruitingP2Status: t('hero.widgetRecruitingP2Status'),
    widgetRecruitingP3: t('hero.widgetRecruitingP3'),
    widgetRecruitingP3Status: t('hero.widgetRecruitingP3Status'),
    widgetRecruitingCount: t('hero.widgetRecruitingCount'),
  };

  type FeatureBullet = { highlight: string; rest: string };
  const featureCards = [
    { key: 'translate' as const, title: t('features.translate.title'), lead: t('features.translate.lead'), bullets: t.raw('features.translate.bullets') as FeatureBullet[], tag: t('features.translate.tag') },
    { key: 'probing' as const, title: t('features.probing.title'), lead: t('features.probing.lead'), bullets: t.raw('features.probing.bullets') as FeatureBullet[], tag: t('features.probing.tag') },
    { key: 'insights' as const, title: t('features.insights.title'), lead: t('features.insights.lead'), bullets: t.raw('features.insights.bullets') as FeatureBullet[], tag: t('features.insights.tag') },
    { key: 'interviews' as const, title: t('features.interviews.title'), lead: t('features.interviews.lead'), bullets: t.raw('features.interviews.bullets') as FeatureBullet[] },
    { key: 'desk' as const, title: t('features.desk.title'), lead: t('features.desk.lead'), bullets: t.raw('features.desk.bullets') as FeatureBullet[] },
    { key: 'quotes' as const, title: t('features.quotes.title'), lead: t('features.quotes.lead'), bullets: t.raw('features.quotes.bullets') as FeatureBullet[] },
  ];

  const workflowSteps = [
    { num: t('workflow.step1Num'), title: t('workflow.step1Title'), body: t('workflow.step1Body') },
    { num: t('workflow.step2Num'), title: t('workflow.step2Title'), body: t('workflow.step2Body') },
    { num: t('workflow.step3Num'), title: t('workflow.step3Title'), body: t('workflow.step3Body') },
  ] as const;

  const securityCards = (['ai', 'auth', 'encryption', 'payment'] as const).map((key) => ({
    key,
    title: t(`security.cards.${key}.title`),
    lead: t(`security.cards.${key}.lead`),
    bullets: t.raw(`security.cards.${key}.bullets`) as Array<{ highlight: string; rest: string }>,
  }));

  return (
    <div className={`${outfit.variable} landing-root`}>
      <nav className="top">
        <div className="container row">
          <div className="brand">
            <img className="logo" src="/branding/logos/01_PRIMARY_LOGO_HORIZONTAL.svg" alt="Research-Canvas" />
          </div>
          <div className="links">
            <a href="#features">{t('nav.features')}</a>
            <a href="#workflow">{t('nav.workflow')}</a>
            <a href="#security">{t('nav.security')}</a>
            <a href="#pricing">{t('nav.pricing')}</a>
            <a href="#faq">{t('nav.faq')}</a>
          </div>
          <div className="cta">
            <Link className="btn" href="/login">{t('nav.signIn')}</Link>
            <Link className="btn primary" href={ctaStart}>{t('nav.freeStart')}</Link>
          </div>
        </div>
      </nav>

      <CanvasHero labels={heroLabels} ctaStartHref={ctaStart} ctaFeaturesHref="#features" />

      <FeatureGrid
        meta={t('features.meta')}
        title={t.rich('features.title', richTags)}
        subtitle={t('features.subtitle')}
        cards={featureCards}
      />

      <WorkflowSection
        meta={t('workflow.meta')}
        title={t.rich('workflow.title', richTags)}
        subtitle={t('workflow.subtitle')}
        steps={[workflowSteps[0], workflowSteps[1], workflowSteps[2]]}
      />

      <SecuritySection
        meta={t('security.meta')}
        title={t.rich('security.title', richTags)}
        subtitle={t('security.subtitle')}
        cards={securityCards}
        footer={{
          text: t('security.footer.text'),
          linkText: t('security.footer.linkText'),
          linkHref: t('security.footer.linkHref'),
        }}
      />

      <section className="pricing" id="pricing">
        <div className="container">
          <div className="sec-head">
            <span className="meta">{t('pricing.meta')}</span>
            <h2>{t.rich('pricing.title', richTags)}</h2>
            <p>{t('pricing.subtitle')}</p>
          </div>
          <div className="price-grid">
            <div className="price">
              <span className="meta">{t('pricing.tiers.starter.meta')}</span>
              <h4>{t('pricing.tiers.starter.name')}</h4>
              <div className="num">{t('pricing.tiers.starter.price', { price: priceStarter.price })}<small>{t('pricing.tiers.starter.priceNote', { credits: priceStarter.credits, perCredit: priceStarter.perCredit })}</small></div>
              <ul>
                <li>{t('pricing.tiers.starter.f1')}</li>
                <li>{t('pricing.tiers.starter.f2')}</li>
                <li>{t('pricing.tiers.starter.f3')}</li>
              </ul>
              <Link className="btn" href={ctaCredits}>{t('pricing.tiers.starter.cta')}</Link>
            </div>

            <div className="price featured">
              <span className="badge">{t('pricing.tiers.team.badge')}</span>
              <span className="meta">{t('pricing.tiers.team.meta')}</span>
              <h4>{t('pricing.tiers.team.name')}</h4>
              <div className="num">{t('pricing.tiers.team.price', { price: priceTeam.price })}<small>{t('pricing.tiers.team.priceNote', { credits: priceTeam.credits, perCredit: priceTeam.perCredit })}</small></div>
              <ul>
                <li>{t('pricing.tiers.team.f1')}</li>
                <li>{t('pricing.tiers.team.f2')}</li>
                <li>{t('pricing.tiers.team.f3')}</li>
              </ul>
              <Link className="btn primary white" href={ctaCredits}>{t('pricing.tiers.team.cta')}</Link>
            </div>

            <div className="price">
              <span className="meta">{t('pricing.tiers.studio.meta')}</span>
              <h4>{t('pricing.tiers.studio.name')}</h4>
              <div className="num">{t('pricing.tiers.studio.price', { price: priceStudio.price })}<small>{t('pricing.tiers.studio.priceNote', { credits: priceStudio.credits, perCredit: priceStudio.perCredit })}</small></div>
              <ul>
                <li>{t('pricing.tiers.studio.f1')}</li>
                <li>{t('pricing.tiers.studio.f2')}</li>
                <li>{t('pricing.tiers.studio.f3')}</li>
              </ul>
              <Link className="btn" href={ctaCredits}>{t('pricing.tiers.studio.cta')}</Link>
            </div>

            <div className="price">
              <span className="meta">{t('pricing.tiers.enterprise.meta')}</span>
              <h4>{t('pricing.tiers.enterprise.name')}</h4>
              <div className="num">{t('pricing.tiers.enterprise.price')}<small>{t('pricing.tiers.enterprise.priceNote')}</small></div>
              <ul>
                <li>{t('pricing.tiers.enterprise.f1')}</li>
                <li>{t('pricing.tiers.enterprise.f2')}</li>
                <li>{t('pricing.tiers.enterprise.f3')}</li>
              </ul>
              <a className="btn" href="mailto:chris.lee@meteor-research.com">{t('pricing.tiers.enterprise.cta')}</a>
            </div>
          </div>

          <div className="sec-head" style={{ marginTop: '4rem' }}>
            <span className="meta">{t('pricing.sub.meta')}</span>
            <h2>{t.rich('pricing.sub.title', richTags)}</h2>
            <p>{t('pricing.sub.subtitle')}</p>
          </div>
          <div className="price-grid sub-price-grid">
            <div className="price">
              <span className="meta">{t('pricing.sub.tiers.solo.meta')}</span>
              <h4>{t('pricing.sub.tiers.solo.name')}</h4>
              <div className="num">{t('pricing.sub.tiers.solo.price', { price: subSolo.price })}<small>{t('pricing.sub.tiers.solo.priceNote', { credits: subSolo.credits })}</small></div>
              <ul>
                <li>{t('pricing.sub.tiers.solo.f1')}</li>
                <li>{t('pricing.sub.tiers.solo.f2')}</li>
                <li>{t('pricing.sub.tiers.solo.f3')}</li>
              </ul>
              <Link className="btn" href={ctaCredits}>{t('pricing.sub.tiers.solo.cta')}</Link>
            </div>

            <div className="price featured">
              <span className="badge">{t('pricing.sub.tiers.plus.badge')}</span>
              <span className="meta">{t('pricing.sub.tiers.plus.meta')}</span>
              <h4>{t('pricing.sub.tiers.plus.name')}</h4>
              <div className="num">{t('pricing.sub.tiers.plus.price', { price: subPlus.price })}<small>{t('pricing.sub.tiers.plus.priceNote', { credits: subPlus.credits })}</small></div>
              <ul>
                <li>{t('pricing.sub.tiers.plus.f1')}</li>
                <li>{t('pricing.sub.tiers.plus.f2')}</li>
                <li>{t('pricing.sub.tiers.plus.f3')}</li>
              </ul>
              <Link className="btn primary white" href={ctaCredits}>{t('pricing.sub.tiers.plus.cta')}</Link>
            </div>

            <div className="price">
              <span className="meta">{t('pricing.sub.tiers.pro.meta')}</span>
              <h4>{t('pricing.sub.tiers.pro.name')}</h4>
              <div className="num">{t('pricing.sub.tiers.pro.price', { price: subPro.price })}<small>{t('pricing.sub.tiers.pro.priceNote', { credits: subPro.credits })}</small></div>
              <ul>
                <li>{t('pricing.sub.tiers.pro.f1')}</li>
                <li>{t('pricing.sub.tiers.pro.f2')}</li>
                <li>{t('pricing.sub.tiers.pro.f3')}</li>
              </ul>
              <Link className="btn" href={ctaCredits}>{t('pricing.sub.tiers.pro.cta')}</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="faq" id="faq">
        <div className="container">
          <div className="sec-head">
            <span className="meta">{t('faq.meta')}</span>
            <h2>{t('faq.title')}</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>{t('faq.q1')} <span className="plus">+</span></summary>
              <div className="a">{t('faq.a1')}</div>
            </details>
            <details>
              <summary>{t('faq.q2')} <span className="plus">+</span></summary>
              <div className="a">{t('faq.a2')}</div>
            </details>
            <details>
              <summary>{t('faq.q3')} <span className="plus">+</span></summary>
              <div className="a">{t('faq.a3')}</div>
            </details>
            <details>
              <summary>{t('faq.q4')} <span className="plus">+</span></summary>
              <div className="a">{t('faq.a4')}</div>
            </details>
          </div>
        </div>
      </section>

      <section className="cta-final" id="start">
        <div className="container">
          <div className="cta-card">
            <span className="squiggle">{t('ctaFinal.squiggle')}</span>
            <h2>{t.rich('ctaFinal.title', richTags)}</h2>
            <p>{t('ctaFinal.subtitle')}</p>
            <div className="row">
              <Link className="btn primary btn-lg" href={ctaStart}>{t('ctaFinal.ctaPrimary')}</Link>
              <a className="btn btn-lg" href="#features">{t('ctaFinal.ctaSecondary')}</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="row">
          <div style={{ display: 'flex', gap: '18px' }}>
            <Link href="/terms">{t('footer.terms')}</Link>
            <Link href="/privacy">{t('footer.privacy')}</Link>
            <Link href="/use-policy">{t('footer.usePolicy')}</Link>
            <a href="mailto:chris.lee@meteor-research.com">{t('footer.contact')}</a>
          </div>
        </div>
        <div className="biz-info">
          {(locale === 'ko' ? companyInfoLinesKo() : companyInfoLinesEn()).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
