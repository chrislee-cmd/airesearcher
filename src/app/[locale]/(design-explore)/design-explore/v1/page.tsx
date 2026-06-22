import Link from 'next/link';
import { DEMO_WIDGETS } from '../../_widgets';

// v1. Brutalist Editorial — 신문/잡지 톤
//   흑백 + 큰 serif headline + 두꺼운 black border + 사각형 카드 + spot red
export default function V1() {
  return (
    <div className="min-h-screen bg-neutral-50 font-serif text-black">
      {/* Masthead */}
      <header className="border-b-[6px] border-black px-10 pt-10 pb-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.32em] text-neutral-600">
              Vol. I — Edition № 01 — Friday, June 22, 2026
            </div>
            <h1 className="mt-2 text-[88px] font-black leading-[0.92] tracking-[-0.03em]">
              RESEARCH<span className="italic">MOCHI</span>
            </h1>
            <div className="mt-1 font-sans text-sm italic text-neutral-700">
              — a research desk, in print —
            </div>
          </div>
          <div className="font-sans">
            <div className="text-right text-[10px] uppercase tracking-[0.3em] text-neutral-600">
              Today&apos;s index
            </div>
            <div className="mt-1 border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-widest">
              6 tools listed
            </div>
          </div>
        </div>
      </header>

      {/* Section header */}
      <div className="border-b-2 border-black px-10 py-4 flex items-baseline justify-between">
        <h2 className="font-sans text-xs font-bold uppercase tracking-[0.4em]">
          The Desk — Research Tools
        </h2>
        <div className="font-sans text-xs text-neutral-600">page 1 of 1</div>
      </div>

      {/* Grid — 1px black gutters (gap-px + bg-black) */}
      <div className="px-10 py-10">
        <div className="grid grid-cols-3 gap-px bg-black">
          {DEMO_WIDGETS.map((w, i) => (
            <article
              key={w.key}
              className="bg-neutral-50 p-7 flex flex-col gap-4 min-h-[280px]"
            >
              <div className="flex items-baseline justify-between font-sans">
                <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">
                  No. {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-700 border-2 border-red-700 px-2 py-0.5">
                  {w.cost}
                </span>
              </div>
              <h3 className="text-[34px] font-bold leading-[1.02] tracking-[-0.02em]">
                {w.label}
              </h3>
              <div className="h-px bg-black" />
              <p className="font-serif text-[15px] leading-[1.55] text-neutral-900">
                {w.description}
              </p>
              <div className="mt-auto pt-2 font-sans">
                <span className="inline-block text-xs font-bold uppercase tracking-[0.25em] underline decoration-2 underline-offset-[6px] hover:text-red-700">
                  Open Tool →
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t-[6px] border-black px-10 py-6 flex items-center justify-between font-sans">
        <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">
          Print Run · 2026 · Researchmochi Editorial Office
        </div>
        <Link
          href="/design-explore"
          className="text-xs font-bold uppercase tracking-widest underline decoration-2 underline-offset-4 hover:text-red-700"
        >
          ← Back to Index
        </Link>
      </footer>
    </div>
  );
}
