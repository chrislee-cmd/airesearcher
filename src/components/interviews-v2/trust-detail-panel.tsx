'use client';

import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { useInterviewV2TrustStats } from '@/hooks/use-interview-v2-trust-stats';

// Interview V2 — 신뢰도 (trust) detail panel, option B.
//
// A collapsed-by-default disclosure under the project file list. The summary
// row shows the headline reassurance numbers (files · chunks · embed %);
// expanding reveals a visual dashboard — three count-up stat cards (the embed
// card carries an animated SVG ring gauge) plus the 7-layer
// hallucination-guard list rendered as an interactive timeline: numbered
// badges connected by a spine, each row highlighting on hover with its detail
// behind an ⓘ tooltip. Content mounts on open, so the count-up / ring / stagger
// animations replay every time the panel is expanded (dynamic on interaction).
//
// Copy is kept as an inline ko-only constant (mirroring the spec) rather than
// i18n keys: this is one of three competing trust-UX experiments (A/B/C) and
// keeping it out of the messages/*.json hotspot avoids merge conflicts with
// the sibling experiments. If option B is adopted, the copy moves to
// messages/{ko,en}.json in the follow-up.

type Layer = { id: string; title: string; detail: string };

const LAYERS: Layer[] = [
  {
    id: 'retrieval-first',
    title: '근거 청크 밖 정보 생성 금지',
    detail:
      'LLM system prompt 에 "일반 상식·추측·외부 지식 금지" 명시. 오직 인덱싱된 원문만 답변 근거로 사용합니다.',
  },
  {
    id: 'threshold',
    title: '유사도 임계값 0.2 (관련 없는 청크 drop)',
    detail:
      '실 prod 데이터로 튜닝한 값 (0.19 이하 = orthogonal noise). 관련성이 부족한 청크를 pgvector 레벨에서 걸러냅니다.',
  },
  {
    id: 'inline-citation',
    title: '인라인 [citation] 필수',
    detail:
      'LLM 이 모든 사실 주장 뒤에 [chunk_id] inline citation 을 붙이도록 강제합니다. 근거 없이 서술하지 않습니다.',
  },
  {
    id: 'server-reconstruct',
    title: '서버 재구성 (환상 citation drop)',
    detail:
      'LLM 이 존재하지 않는 chunk_id 를 인용해도 서버가 실제 hits 와 매칭 후 없는 것은 drop 합니다. 사용자가 보는 근거 = 100% 실 원문.',
  },
  {
    id: 'no-answer',
    title: '근거 없으면 "찾지 못했습니다" fallback',
    detail:
      '근거 청크로 답할 수 없으면 "이 질문에 대한 근거를 찾지 못했습니다" 를 강제 반환합니다. 지어내지 않습니다.',
  },
  {
    id: 'zero-retention',
    title: 'Zero retention (외부 서버 저장 X)',
    detail: 'Anthropic 서버에 데이터를 저장하지 않습니다 (providerOptions.zero_retention).',
  },
  {
    id: 'temp',
    title: 'Temperature 0.1 (deterministic)',
    detail: 'creative hallucination 을 최소화합니다. Deterministic 답변을 우선합니다.',
  },
];

// Ease-out count-up. Restarts whenever `active` flips true (panel opened) so
// the numbers tick up on every expand. Uses rAF timestamps, not Date.
function useCountUp(target: number, active: boolean, duration = 650) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    // Content unmounts when the panel closes, so no reset is needed — value
    // stays 0 until `active` flips true, then eases up to target.
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

// Animated ring gauge for the embed %. Fills from empty to `pct` on mount via
// a stroke-dashoffset transition.
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
  suffix,
  label,
  active,
}: {
  value: number;
  suffix?: string;
  label: string;
  active: boolean;
}) {
  const shown = useCountUp(value, active, 650);
  return (
    <div className="flex flex-col items-center gap-1 rounded-sm border border-line bg-paper px-2 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amore">
      <span className="text-2xl font-semibold tabular-nums text-ink">
        {shown}
        {suffix ? <span className="text-md text-mute">{suffix}</span> : null}
      </span>
      <span className="text-xs uppercase tracking-[0.14em] text-mute-soft">{label}</span>
    </div>
  );
}

export function TrustDetailPanel({ projectId }: { projectId: string }) {
  const { stats, isLoading } = useInterviewV2TrustStats(projectId);
  const [open, setOpen] = useState(false);

  const fileCount = stats?.fileCount ?? 0;
  const chunkCount = stats?.chunkCount ?? 0;
  const embedPct = Math.round((stats?.embedRate ?? 1) * 100);
  // Content mounts only while open, so animations replay on each expand.
  const active = open && !!stats;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="border-t border-line-soft"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-ink-2 transition-colors hover:bg-amore-bg">
        <span
          className={`text-mute transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="relative inline-flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-amore"
            style={{ animation: 'trustShield 1.8s ease-in-out infinite' }}
            aria-hidden
          />
          🛡 신뢰도
        </span>
        {isLoading ? (
          <span className="text-mute">· 집계 중…</span>
        ) : (
          <span className="text-mute">
            · 파일 {fileCount} · 청크 {chunkCount} · {embedPct}%
          </span>
        )}
      </summary>

      {open && (
        <div className="space-y-5 bg-paper-soft px-4 py-5">
          {/* 데이터 정확성 — count-up stat 카드 3개 + 임베딩 링 게이지. */}
          <section
            style={{ animation: 'trustReveal 320ms ease-out both' }}
          >
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-2">
              📄 데이터 정확성
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <StatCard value={fileCount} label="파일" active={active} />
              <StatCard value={chunkCount} label="청크" active={active} />
              <div className="flex flex-col items-center gap-1 rounded-sm border border-line bg-paper px-2 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amore">
                {active ? (
                  <EmbedRing pct={embedPct} />
                ) : (
                  <span className="inline-flex h-[60px] items-center text-2xl font-semibold text-mute-soft">
                    —
                  </span>
                )}
                <span className="text-xs uppercase tracking-[0.14em] text-mute-soft">
                  임베딩
                </span>
              </div>
            </div>
            <p
              className="mt-2 text-xs text-mute"
              style={{ animation: 'trustReveal 320ms ease-out both', animationDelay: '90ms' }}
            >
              ✅ 원문 무손실 · chunk 1800자 안전 마진 18배
            </p>
          </section>

          {/* 환각 방지 7-layer — 세로 타임라인. 각 행 hover 시 배지 채움 + 강조. */}
          <section>
            <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink-2">
              🛡 환각 방지 7-layer
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
        </div>
      )}
    </details>
  );
}
