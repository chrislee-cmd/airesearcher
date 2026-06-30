import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

type Labels = {
  tagline: string;
  headline: ReactNode;
  lead: ReactNode;
  ctaPrimary: string;
  ctaSecondary: string;
  postscript: ReactNode;
  canvasMeta: string;
  canvasBrand: string;
  canvasCredits: string;
  canvasSaved: string;
  widgetTranscriptsTitle: string;
  widgetTranscriptsLine1: string;
  widgetTranscriptsLine2: string;
  widgetTranscriptsLine3: string;
  widgetTranslateTitle: string;
  widgetTranslateHost: string;
  widgetTranslateGuest: string;
  widgetTranslateLine: string;
  widgetTranslateGuestLine: string;
  widgetProbingTitle: string;
  widgetProbingHint: string;
  widgetProbingQuestion: string;
  widgetInsightsTitle: string;
  widgetInsightsCluster1: string;
  widgetInsightsCluster2: string;
  widgetInsightsCluster3: string;
  widgetDeskTitle: string;
  widgetDeskSource1: string;
  widgetDeskSource2: string;
  widgetRecruitingTitle: string;
  widgetRecruitingSubtitle: string;
  widgetRecruitingP1: string;
  widgetRecruitingP1Status: string;
  widgetRecruitingP2: string;
  widgetRecruitingP2Status: string;
  widgetRecruitingP3: string;
  widgetRecruitingP3Status: string;
  widgetRecruitingCount: string;
};

export function CanvasHero({
  labels,
  ctaStartHref,
  ctaFeaturesHref,
}: {
  labels: Labels;
  ctaStartHref: string;
  ctaFeaturesHref: string;
}) {
  return (
    <header className="hero canvas-hero">
      <div className="container">
        <span className="squiggle">{labels.tagline}</span>
        <h1>{labels.headline}</h1>
        {labels.lead ? <p>{labels.lead}</p> : null}
        <div className="ctarow">
          <Link className="btn primary btn-lg" href={ctaStartHref}>{labels.ctaPrimary}</Link>
          <a className="btn btn-lg" href={ctaFeaturesHref}>{labels.ctaSecondary}</a>
        </div>
        <div className="below">{labels.postscript}</div>

        <CanvasMockup labels={labels} />
      </div>
    </header>
  );
}

function CanvasMockup({ labels }: { labels: Labels }) {
  return (
    <div className="canvas-mock" role="img" aria-label={labels.canvasMeta}>
      <div className="cm-top">
        <div className="cm-brand">
          <span className="cm-dot" />
          {labels.canvasBrand}
        </div>
        <div className="cm-top-right">
          <span className="cm-credits">{labels.canvasCredits}</span>
          <span className="cm-saved"><span className="cm-pulse" />{labels.canvasSaved}</span>
        </div>
      </div>

      <div className="cm-grid">
        {/* Transcripts */}
        <article className="cm-widget cm-w-transcripts">
          <header>
            <span className="cm-icon" aria-hidden="true">T</span>
            <h3>{labels.widgetTranscriptsTitle}</h3>
          </header>
          <ul className="cm-lines">
            <li><span className="cm-who">P1</span><span className="cm-text">{labels.widgetTranscriptsLine1.replace(/^P1\s·\s/, '')}</span></li>
            <li><span className="cm-who">P2</span><span className="cm-text">{labels.widgetTranscriptsLine2.replace(/^P2\s·\s/, '')}</span></li>
            <li><span className="cm-who">P3</span><span className="cm-text">{labels.widgetTranscriptsLine3.replace(/^P3\s·\s/, '')}</span></li>
          </ul>
        </article>

        {/* Translate */}
        <article className="cm-widget cm-w-translate">
          <header>
            <span className="cm-icon cm-icon-mint" aria-hidden="true">⇄</span>
            <h3>{labels.widgetTranslateTitle}</h3>
            <span className="cm-tag cm-tag-new">NEW</span>
          </header>
          <div className="cm-translate">
            <div className="cm-tr-row">
              <span className="cm-tr-tag">{labels.widgetTranslateHost}</span>
              <p>{labels.widgetTranslateLine}</p>
            </div>
            <div className="cm-tr-row guest">
              <span className="cm-tr-tag">{labels.widgetTranslateGuest}</span>
              <p>{labels.widgetTranslateGuestLine}</p>
            </div>
          </div>
        </article>

        {/* Probing */}
        <article className="cm-widget cm-w-probing">
          <header>
            <span className="cm-icon cm-icon-peach" aria-hidden="true">?</span>
            <h3>{labels.widgetProbingTitle}</h3>
            <span className="cm-tag cm-tag-new">NEW</span>
          </header>
          <div className="cm-probing">
            <span className="cm-probing-hint">{labels.widgetProbingHint}</span>
            <p className="cm-probing-q">{labels.widgetProbingQuestion}</p>
          </div>
        </article>

        {/* Insights */}
        <article className="cm-widget cm-w-insights">
          <header>
            <span className="cm-icon cm-icon-sky" aria-hidden="true">◎</span>
            <h3>{labels.widgetInsightsTitle}</h3>
            <span className="cm-tag cm-tag-new">NEW</span>
          </header>
          <ul className="cm-clusters">
            <li><span className="cm-bubble cm-bubble-pink" />{labels.widgetInsightsCluster1}</li>
            <li><span className="cm-bubble cm-bubble-sun" />{labels.widgetInsightsCluster2}</li>
            <li><span className="cm-bubble cm-bubble-mint" />{labels.widgetInsightsCluster3}</li>
          </ul>
        </article>

        {/* Desk */}
        <article className="cm-widget cm-w-desk">
          <header>
            <span className="cm-icon cm-icon-lav" aria-hidden="true">D</span>
            <h3>{labels.widgetDeskTitle}</h3>
          </header>
          <div className="cm-desk-progress" aria-hidden="true">
            <span className="cm-desk-progress-bar" />
          </div>
          <ul className="cm-sources">
            <li>{labels.widgetDeskSource1}</li>
            <li>{labels.widgetDeskSource2}</li>
          </ul>
        </article>

        {/* Recruiting */}
        <article className="cm-widget cm-w-recruiting">
          <header>
            <span className="cm-icon cm-icon-recruiting" aria-hidden="true">R</span>
            <h3>{labels.widgetRecruitingTitle}</h3>
          </header>
          <div className="cm-recruiting">
            <span className="cm-recruiting-sub">{labels.widgetRecruitingSubtitle}</span>
            <ul className="cm-recruiting-list">
              <li>
                <span className="cm-rec-who">P1</span>
                <span className="cm-rec-text">{labels.widgetRecruitingP1}</span>
                <span className="cm-rec-status cm-rec-ok">{labels.widgetRecruitingP1Status}</span>
              </li>
              <li>
                <span className="cm-rec-who">P2</span>
                <span className="cm-rec-text">{labels.widgetRecruitingP2}</span>
                <span className="cm-rec-status cm-rec-pending">{labels.widgetRecruitingP2Status}</span>
              </li>
              <li>
                <span className="cm-rec-who">P3</span>
                <span className="cm-rec-text">{labels.widgetRecruitingP3}</span>
                <span className="cm-rec-status cm-rec-ok">{labels.widgetRecruitingP3Status}</span>
              </li>
            </ul>
            <div className="cm-rec-count">{labels.widgetRecruitingCount}</div>
          </div>
        </article>
      </div>
    </div>
  );
}
