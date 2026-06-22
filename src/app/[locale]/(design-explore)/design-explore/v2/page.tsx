import Link from 'next/link';
import { DEMO_WIDGETS } from '../../_widgets';

const ICONS = ['◐', '✱', '◇', '◑', '✦', '◈'];
const SWATCHES = [
  'from-sky-400 to-cyan-300',
  'from-purple-400 to-pink-300',
  'from-amber-300 to-orange-300',
  'from-emerald-400 to-teal-300',
  'from-rose-400 to-fuchsia-300',
  'from-indigo-400 to-violet-300',
];

// v2. Glass / Aero — gradient + frosted glass + 큰 radius + soft glow
export default function V2() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-300 via-pink-200 to-blue-300 font-sans text-gray-800 relative overflow-hidden">
      {/* Decorative blobs (background depth) */}
      <div className="absolute -top-20 -left-20 h-96 w-96 rounded-full bg-purple-400/40 blur-3xl" />
      <div className="absolute top-40 right-0 h-96 w-96 rounded-full bg-pink-400/40 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-blue-400/40 blur-3xl" />

      {/* Top bar — frosted */}
      <header className="relative z-10 backdrop-blur-2xl bg-white/30 border-b border-white/40 px-8 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-light tracking-tight text-gray-900">
            researchmochi
          </span>
          <span className="text-sm font-medium text-purple-700">studio</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/40 backdrop-blur-xl border border-white/40 text-xs text-gray-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            5,002 크레딧
          </div>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-400 shadow-lg shadow-purple-400/40 flex items-center justify-center text-white text-sm">
            CL
          </div>
        </div>
      </header>

      <main className="relative z-10 px-8 py-12">
        {/* Hero */}
        <div className="mb-10">
          <div className="text-xs uppercase tracking-[0.2em] text-purple-700/70">
            Good afternoon, Chris
          </div>
          <h1 className="mt-2 text-[52px] font-light tracking-tight leading-[1.05] text-gray-900">
            오늘의 작업대
          </h1>
          <p className="mt-2 text-lg text-gray-700">
            사용할 도구를 골라주세요. 결과는 자동으로 모입니다.
          </p>
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-3 gap-5">
          {DEMO_WIDGETS.map((w, i) => (
            <div
              key={w.key}
              className="group rounded-[28px] bg-white/40 backdrop-blur-2xl border border-white/50 p-6 shadow-[0_20px_60px_-20px_rgba(160,111,218,0.45)] hover:bg-white/55 hover:shadow-[0_28px_80px_-25px_rgba(236,72,153,0.55)] transition-all duration-300"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${SWATCHES[i]} shadow-lg flex items-center justify-center text-2xl text-white/95`}
                >
                  {ICONS[i]}
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/50 backdrop-blur border border-white/60 text-gray-700">
                  {w.cost}
                </span>
              </div>
              <h3 className="mt-5 text-[19px] font-medium text-gray-900 leading-tight">
                {w.label}
              </h3>
              <p className="mt-1.5 text-[13px] text-gray-700 leading-relaxed line-clamp-2">
                {w.description}
              </p>
              <button
                className="mt-5 w-full py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium shadow-md shadow-purple-400/30 hover:shadow-xl hover:shadow-pink-400/50 transition-all"
                type="button"
              >
                열기
              </button>
            </div>
          ))}
        </div>

        {/* Bottom recap */}
        <div className="mt-10 rounded-[24px] bg-white/30 backdrop-blur-xl border border-white/40 p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-gray-600">
                Recent
              </div>
              <div className="mt-1 text-lg font-medium text-gray-900">
                최근 산출물 3건 · 데스크 리포트 2 · 전사록 1
              </div>
            </div>
            <button
              className="px-4 py-2 rounded-full bg-white/40 backdrop-blur border border-white/50 text-sm text-gray-800 hover:bg-white/60 transition"
              type="button"
            >
              모두 보기 →
            </button>
          </div>
        </div>
      </main>

      <footer className="relative z-10 px-8 py-6 flex items-center justify-between text-xs text-gray-600">
        <Link
          href="/design-explore"
          className="px-3 py-1.5 rounded-full bg-white/30 backdrop-blur border border-white/40 hover:bg-white/50 transition"
        >
          ← 시안 인덱스
        </Link>
        <span className="px-3 py-1.5 rounded-full bg-white/30 backdrop-blur border border-white/40">
          v2 · Glass / Aero
        </span>
      </footer>
    </div>
  );
}
