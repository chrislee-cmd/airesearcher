'use client';

import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { useInterviewV2TrustStats } from '@/hooks/use-interview-v2-trust-stats';

// Interview V2 — 신뢰도 (trust) panel, option B.
//
// Always-expanded visual dashboard under the project file list (no collapse):
// three count-up stat cards (the "분석 완료" card carries an animated SVG ring
// gauge) plus a 7-step safeguard timeline explaining, in plain non-technical
// Korean, how the search answers stay grounded in the uploaded material. Each
// timeline row highlights on hover and reveals its detail behind an ⓘ tooltip.
// The count-up / ring / stagger animations fire once the stats load.
//
// Copy is kept as an inline ko-only constant (mirroring the spec) rather than
// i18n keys: this is one of three competing trust-UX experiments (A/B/C) and
// keeping it out of the messages/*.json hotspot avoids merge conflicts with
// the sibling experiments. If option B is adopted, the copy moves to
// messages/{ko,en}.json in the follow-up.

type Layer = { id: string; title: string; detail: string };

// Plain-language rewrite of the 7 hallucination guards — no jargon (청크 /
// 임베딩 / citation / threshold / temperature 등은 쉬운 말로 풀어씀).
const LAYERS: Layer[] = [
  {
    id: 'retrieval-first',
    title: '올린 자료에 있는 내용만 답합니다',
    detail:
      'AI가 일반 상식이나 추측으로 답하지 못하게 막습니다. 오직 여러분이 업로드한 인터뷰 원문 안에서만 답을 찾습니다.',
  },
  {
    id: 'threshold',
    title: '질문과 관련 없는 부분은 걸러냅니다',
    detail:
      '질문과 동떨어진 대목은 자동으로 제외하고, 실제로 관련 있는 부분만 답변의 근거로 사용합니다.',
  },
  {
    id: 'inline-citation',
    title: '모든 답변에 근거 출처를 함께 보여줍니다',
    detail:
      '답변의 각 내용이 어느 자료의 어느 대목에서 나왔는지 항상 표시합니다. 근거 없는 이야기는 하지 않습니다.',
  },
  {
    id: 'server-reconstruct',
    title: '가짜로 만들어낸 출처는 자동으로 지웁니다',
    detail:
      '혹시 AI가 실제로 없는 출처를 지어내도, 서버가 원문과 대조해 존재하지 않는 것은 제거합니다. 화면에 보이는 근거는 100% 진짜 원문입니다.',
  },
  {
    id: 'no-answer',
    title: '근거가 없으면 솔직하게 "못 찾았다"고 답합니다',
    detail:
      '자료에서 답을 찾지 못하면 억지로 지어내지 않고, "이 질문에 대한 근거를 찾지 못했습니다"라고 그대로 알려줍니다.',
  },
  {
    id: 'zero-retention',
    title: '올린 자료를 외부에 저장하지 않습니다',
    detail:
      'AI 제공사 서버에 인터뷰 내용이 남지 않습니다. 답변을 만든 뒤에는 보관하지 않습니다.',
  },
  {
    id: 'temp',
    title: '매번 일관되고 안정적으로 답합니다',
    detail:
      'AI가 상상력을 발휘해 내용을 부풀리지 않도록 설정을 낮췄습니다. 같은 질문에는 흔들림 없이 사실 위주로 답합니다.',
  },
];

// Ease-out count-up. Restarts whenever `active` flips true (stats loaded) so
// the numbers tick up once the data arrives. Uses rAF timestamps, not Date.
function useCountUp(target: number, active: boolean, duration = 650) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    // value stays 0 until `active` flips true, then eases up to target.
    if (!active) return;
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return value;
}

// Animated ring gauge for the 분석 완료 %. Fills from empty to `pct` on mount
// via a stroke-dashoffset transition.
function EmbedRing({ pct }: { pct: number }) {
  const size = 60;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOffset(circ * (1 - pct / 100)));
    return () => cancelAnimationFrame(raf);
  }, [circ, pct]);

  const shown = useCountUp(pct, true, 650);

  return (
    <span className="relative inline-flex h-[60px] w-[60px] items-center justify-center">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-amore)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 750ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums text-ink">
        {shown}%
      </span>
    </span>
  );
}

function StatCard({
  value,
  label,
  active,
}: {
  value: number;
  label: string;
  active: boolean;
}) {
  const shown = useCountUp(value, active, 650);
  return (
    <div className="flex flex-col items-center gap-1 rounded-sm border border-line bg-paper px-2 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amore">
      <span className="text-2xl font-semibold tabular-nums text-ink">{shown}</span>
      <span className="text-xs uppercase tracking-[0.14em] text-mute-soft">{label}</span>
    </div>
  );
}

export function TrustDetailPanel({ projectId }: { projectId: string }) {
  const { stats } = useInterviewV2TrustStats(projectId);

  const fileCount = stats?.fileCount ?? 0;
  const chunkCount = stats?.chunkCount ?? 0;
  const embedPct = Math.round((stats?.embedRate ?? 1) * 100);
  // Animations start once the stats have loaded.
  const active = !!stats;

  return (
    <section className="border-t border-line-soft bg-paper-soft px-4 py-5">
      {/* 헤더 — 접히지 않고 항상 노출. 방패 dot 가 잔잔히 맥동. */}
      <div className="mb-4 flex items-start gap-2">
        <span
          className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amore"
          style={{ animation: 'trustShield 1.8s ease-in-out infinite' }}
          aria-hidden
        />
        <div>
          <h3 className="text-sm font-semibold text-ink">🛡 믿을 수 있는 답변인 이유</h3>
          <p className="mt-0.5 text-xs text-mute">
            올린 자료에 있는 내용만으로 답하고, 그 근거를 항상 함께 보여줍니다.
          </p>
        </div>
      </div>

      {/* 우리가 분석한 자료 — count-up stat 카드 3개 + 완료율 링 게이지. */}
      <section style={{ animation: 'trustReveal 320ms ease-out both' }}>
        <h4 className="mb-2 text-sm font-semibold text-ink-2">📄 우리가 분석한 자료</h4>
        <div className="grid grid-cols-3 gap-2">
          <StatCard value={fileCount} label="파일" active={active} />
          <StatCard value={chunkCount} label="본문 조각" active={active} />
          <div className="flex flex-col items-center gap-1 rounded-sm border border-line bg-paper px-2 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amore">
            {active ? (
              <EmbedRing pct={embedPct} />
            ) : (
              <span className="inline-flex h-[60px] items-center text-2xl font-semibold text-mute-soft">
                —
              </span>
            )}
            <span className="text-xs uppercase tracking-[0.14em] text-mute-soft">
              분석 완료
            </span>
          </div>
        </div>
        <p
          className="mt-2 text-xs text-mute"
          style={{ animation: 'trustReveal 320ms ease-out both', animationDelay: '90ms' }}
        >
          ✅ 올린 원문을 그대로 보관합니다 — 내용이 잘리거나 빠지지 않습니다.
        </p>
      </section>

      {/* 지어내지 않도록 하는 7가지 안전장치 — 세로 타임라인. */}
      <section className="mt-5">
        <h4 className="mb-3 text-sm font-semibold text-ink-2">
          🛡 지어내지 않도록 하는 7가지 안전장치
        </h4>
        <ol className="relative space-y-0.5">
          {/* timeline spine — 배지 중심(li px-2 0.5rem + badge 반지름 0.75rem)에 정렬 */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-5 top-5 w-px bg-line-soft"
            style={{ left: '1.25rem' }}
          />
          {LAYERS.map((l, i) => (
            <li
              key={l.id}
              className="group/row relative flex items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-paper"
              style={{
                animation: 'trustReveal 320ms ease-out both',
                animationDelay: `${120 + i * 45}ms`,
              }}
            >
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-paper-soft text-xs font-semibold tabular-nums text-mute transition-colors duration-200 group-hover/row:border-amore group-hover/row:bg-amore-bg group-hover/row:text-amore">
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-ink-2">{l.title}</span>
              <Tooltip content={l.detail}>
                <span
                  className="cursor-help text-mute transition-colors group-hover/row:text-amore"
                  aria-label={l.title}
                >
                  ⓘ
                </span>
              </Tooltip>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
