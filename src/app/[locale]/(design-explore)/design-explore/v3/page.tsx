import Link from 'next/link';
import { DEMO_WIDGETS } from '../../_widgets';

// v3. Terminal / IDE — dark + monospace + neon accent + grid
export default function V3() {
  return (
    <div
      className="min-h-screen bg-[#0d1117] font-mono text-[13px] text-gray-300"
      style={{ fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace' }}
    >
      {/* Top bar — terminal prompt */}
      <header className="border-b border-gray-800 bg-[#161b22]">
        <div className="px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="ml-3 text-xs text-gray-500">
              researchmochi — bash — 120×30
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>session</span>
            <span className="text-cyan-400">4f2a:c9d1</span>
            <span>·</span>
            <span className="text-green-400">●&nbsp;connected</span>
          </div>
        </div>
        <div className="px-6 py-2 border-t border-gray-800 flex items-center gap-2 text-xs">
          <span className="text-green-400">chris@desk</span>
          <span className="text-gray-500">:</span>
          <span className="text-cyan-400">~/researchmochi</span>
          <span className="text-gray-500">$ </span>
          <span className="text-gray-300">tools list --all</span>
          <span className="text-gray-500 animate-pulse">▊</span>
        </div>
      </header>

      <main className="px-6 py-6">
        <div className="text-xs text-gray-500 mb-5">
          <span className="text-green-400"># </span>
          available_tools: 6 widgets registered · org=lee880728 · balance=5002 credits
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-3 gap-3">
          {DEMO_WIDGETS.map((w, i) => (
            <div
              key={w.key}
              className="border border-gray-800 bg-[#161b22] hover:border-cyan-700 hover:bg-[#1c2128] transition group cursor-pointer"
            >
              {/* file-tab header */}
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between bg-[#0d1117] group-hover:bg-[#161b22]">
                <div className="flex items-center gap-2">
                  <span className="text-purple-400 text-xs">▸</span>
                  <span className="text-cyan-300 text-xs">{w.key}.tool</span>
                </div>
                <span className="text-xs text-gray-600">
                  [{String(i + 1).padStart(2, '0')}/06]
                </span>
              </div>
              {/* body */}
              <div className="px-4 py-4">
                <div className="text-[15px] text-gray-100 mb-2">{w.label}</div>
                <div className="text-xs text-gray-500 leading-[1.6]">
                  <span className="text-gray-600">{'//'}</span> {w.description}
                </div>
                {/* faux code */}
                <div className="mt-4 border-l-2 border-cyan-900 pl-3 text-[11px] text-gray-600 leading-[1.6]">
                  <div>
                    <span className="text-purple-400">def</span>{' '}
                    <span className="text-cyan-300">run</span>():
                  </div>
                  <div className="pl-3">
                    <span className="text-gray-500">return</span>{' '}
                    <span className="text-green-300">{`"${w.label}"`}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-3">
                  <span className="text-xs text-yellow-300">{w.cost}</span>
                  <span className="text-xs text-cyan-400 group-hover:text-cyan-300">
                    $ open --tool={w.key} →
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-2 text-xs">
          <span className="text-green-400">[OK]</span>
          <span className="text-gray-500">
            6 / 6 widgets loaded · uptime 03:24:11 ·{' '}
            <span className="text-cyan-400">v3</span> ·{' '}
            <span className="text-purple-400">research desk</span>
          </span>
        </div>
      </main>

      <footer className="border-t border-gray-800 bg-[#161b22] px-6 py-2.5 flex items-center justify-between text-xs text-gray-500">
        <Link
          href="/design-explore"
          className="hover:text-cyan-300 transition"
        >
          ← /index
        </Link>
        <div className="flex items-center gap-4">
          <span>UTF-8</span>
          <span>·</span>
          <span>LF</span>
          <span>·</span>
          <span className="text-cyan-400">tsx</span>
          <span>·</span>
          <span>Ln 42, Col 8</span>
        </div>
      </footer>
    </div>
  );
}
