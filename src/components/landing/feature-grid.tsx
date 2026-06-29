import type { ReactNode } from 'react';

type FeatureCard = {
  key: 'translate' | 'probing' | 'insights' | 'interviews' | 'desk' | 'quotes';
  title: string;
  body: string;
  tag?: string;
};

export function FeatureGrid({
  meta,
  title,
  subtitle,
  cards,
}: {
  meta: string;
  title: ReactNode;
  subtitle: string;
  cards: FeatureCard[];
}) {
  return (
    <section className="features" id="features">
      <div className="container">
        <div className="sec-head">
          <span className="meta">{meta}</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <div className="feature-grid">
          {cards.map((card) => (
            <article key={card.key} className={`feature-card feature-${card.key}`}>
              <div className="fc-head">
                <span className="fc-icon" aria-hidden="true">{ICON[card.key]}</span>
                {card.tag ? <span className="fc-tag">{card.tag}</span> : null}
              </div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const ICON: Record<FeatureCard['key'], string> = {
  translate: '⇄',
  probing: '?',
  insights: '◎',
  interviews: 'I',
  desk: 'D',
  quotes: 'T',
};
