import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

type SecurityCard = {
  key: 'ai' | 'auth' | 'encryption' | 'payment';
  title: string;
  lead: string;
  bullets: Array<{ highlight: string; rest: string }>;
};

export function SecuritySection({
  meta,
  title,
  subtitle,
  cards,
  footer,
}: {
  meta: string;
  title: ReactNode;
  subtitle: string;
  cards: SecurityCard[];
  footer: { text: string; linkText: string; linkHref: string };
}) {
  return (
    <section className="security" id="security">
      <div className="container">
        <div className="sec-head">
          <span className="meta">{meta}</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <div className="security-grid">
          {cards.map((card) => (
            <article key={card.key} className={`security-card sc-${card.key}`}>
              <div className="sc-head">
                <span className="sc-icon" aria-hidden="true">{ICON[card.key]}</span>
              </div>
              <h3>{card.title}</h3>
              <p className="sc-lead">{card.lead}</p>
              <ul className="sc-bullets">
                {card.bullets.map((b, i) => (
                  <li key={i}>
                    <strong className="sc-highlight">{b.highlight}</strong>
                    <span className="sc-rest"> — {b.rest}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="security-footer">
          {footer.text}{' '}
          <Link href={footer.linkHref} className="security-link">{footer.linkText}</Link>
        </p>
      </div>
    </section>
  );
}

const ICON: Record<SecurityCard['key'], string> = {
  ai: '🛡',
  auth: '🔐',
  encryption: '🔒',
  payment: '💳',
};
