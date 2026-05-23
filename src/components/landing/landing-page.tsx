import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Showcase } from './showcase';
import { panelsKo } from './panels.ko';
import { panelsEn } from './panels.en';
import type { PanelKey } from './panels';
import './landing.css';

export async function LandingPage({ locale }: { locale: string }) {
  const t = await getTranslations('Landing');
  const panels = locale === 'en' ? panelsEn : panelsKo;
  const generatingText = locale === 'en' ? 'Generating…' : '생성 중...';

  const tools: Record<PanelKey, string> = {
    desk: t('showcase.tools.desk'),
    screener: t('showcase.tools.screener'),
    guideline: t('showcase.tools.guideline'),
    moderator: t('showcase.tools.moderator'),
    verbatim: t('showcase.tools.verbatim'),
    interview: t('showcase.tools.interview'),
    report: t('showcase.tools.report'),
    quant: t('showcase.tools.quant'),
    affinity: t('showcase.tools.affinity'),
  };

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

  // Hero CTAs
  const ctaStart = '/login?next=/dashboard';
  const ctaCredits = '/login?next=/credits';

  return (
    <div className="landing-root">
      <nav className="top">
        <div className="container row">
          <div className="brand">
            <img className="logo" src="/landing/logo.png" alt="Research-mochi" /> Research-mochi
          </div>
          <div className="links">
            <a href="#showcase">{t('nav.demo')}</a>
            <a href="#why-mochi">{t('nav.why')}</a>
            <a href="#pricing">{t('nav.pricing')}</a>
            <a href="#voice">{t('nav.story')}</a>
            <a href="#faq">{t('nav.faq')}</a>
          </div>
          <div className="cta">
            <Link className="btn" href="/login">{t('nav.signIn')}</Link>
            <Link className="btn primary" href={ctaStart}>{t('nav.freeStart')}</Link>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="container">
          <span className="squiggle">{t('hero.tagline')}</span>
          <h1>{t.rich('hero.headline', richTags)}</h1>
          <p>{t.rich('hero.lead', richTags)}</p>
          <div className="ctarow">
            <Link className="btn primary btn-lg" href={ctaStart}>{t('hero.ctaPrimary')}</Link>
            <a className="btn btn-lg" href="#showcase">{t('hero.ctaSecondary')}</a>
          </div>
          <div className="below">{t.rich('hero.postscript', richTags)}</div>
        </div>
      </header>

      <Showcase
        panels={panels}
        generatingText={generatingText}
        labels={{
          meta: t('showcase.meta'),
          title: t.rich('showcase.title', richTags),
          subtitle: t('showcase.subtitle'),
          freeTrial: t('showcase.freeTrial'),
          freeTrialTime: t('showcase.freeTrialTime'),
          groups: {
            design: t('showcase.groups.design'),
            conduct: t('showcase.groups.conduct'),
            analysis: t('showcase.groups.analysis'),
          },
          tools,
          sideFoot: t('showcase.sideFoot'),
          wsMeta: t('showcase.wsMeta'),
          wsEmpty: t('showcase.wsEmpty'),
          wsReset: t('showcase.wsReset'),
          wsToReport: t('showcase.wsToReport'),
          footMeta: t('showcase.footMeta'),
          tip: t('showcase.tip'),
          tipMeta: t('showcase.tipMeta'),
          fallbackNext: t('showcase.fallbackNext'),
        }}
      />

      <section className="why-mochi" id="why-mochi">
        <img className="wm-bg sharp" src="/landing/mochi-bg.jpg" alt="" aria-hidden="true" />
        <div className="container">
          <span className="wm-tag">{t('whyMochi.tag')}</span>
          <span className="wm-hand">{t.rich('whyMochi.hand', richTags)}</span>
          <p className="wm-body">{t('whyMochi.body1')}</p>
          <p className="wm-body">{t('whyMochi.body2')}</p>
          <div className="wm-rule"></div>
          <div className="wm-perks">
            <div className="wm-perk"><p>{t.rich('whyMochi.perk1', richTags)}</p></div>
            <div className="wm-perk"><p>{t.rich('whyMochi.perk2', richTags)}</p></div>
            <div className="wm-perk"><p>{t.rich('whyMochi.perk3', richTags)}</p></div>
          </div>
          <span className="wm-coda">{t('whyMochi.coda')}</span>
        </div>
      </section>

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
              <div className="num">{t('pricing.tiers.starter.price')}<small>{t('pricing.tiers.starter.priceNote')}</small></div>
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
              <h4 style={{ color: '#fff' }}>{t('pricing.tiers.team.name')}</h4>
              <div className="num" style={{ color: '#fff' }}>{t('pricing.tiers.team.price')}<small>{t('pricing.tiers.team.priceNote')}</small></div>
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
              <div className="num">{t('pricing.tiers.studio.price')}<small>{t('pricing.tiers.studio.priceNote')}</small></div>
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
        </div>
      </section>

      <section className="voice" id="voice">
        <div className="container">
          <div className="voice-card">
            <div className="av"><span>🌷</span><span>🍵</span><span>🌿</span><span>🍑</span></div>
            <div className="quote">{t.rich('voice.quote', richTags)}</div>
            <div className="by">{t('voice.by')}</div>
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
              <Link className="btn primary" href={ctaStart} style={{ height: '46px', padding: '0 22px', fontSize: '14px' }}>{t('ctaFinal.ctaPrimary')}</Link>
              <a className="btn" href="#showcase" style={{ height: '46px', padding: '0 22px', fontSize: '14px' }}>{t('ctaFinal.ctaSecondary')}</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="row">
          <div>{t.rich('footer.madeIn', richTags)}</div>
          <div style={{ display: 'flex', gap: '18px' }}>
            <Link href="/terms">{t('footer.terms')}</Link>
            <Link href="/privacy">{t('footer.privacy')}</Link>
            <a href="mailto:chris.lee@meteor-research.com">{t('footer.contact')}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
