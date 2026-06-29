import type { ReactNode } from 'react';

type Step = { num: string; title: string; body: string };

export function WorkflowSection({
  meta,
  title,
  subtitle,
  steps,
}: {
  meta: string;
  title: ReactNode;
  subtitle: string;
  steps: [Step, Step, Step];
}) {
  return (
    <section className="workflow" id="workflow">
      <div className="container">
        <div className="sec-head">
          <span className="meta">{meta}</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <ol className="workflow-steps">
          {steps.map((s, i) => (
            <li key={s.num} className="workflow-step">
              <span className="wf-num">{s.num}</span>
              <div className="wf-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
              {i < steps.length - 1 ? <span className="wf-arrow" aria-hidden="true">→</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
