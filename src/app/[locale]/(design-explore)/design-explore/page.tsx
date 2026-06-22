import Link from 'next/link';

// /design-explore index — 3 시안 네비게이션.
const SHEETS = [
  {
    href: 'v1',
    title: 'Brutalist Editorial',
    note: '신문/잡지 톤 — 흑백 + serif headline + 두꺼운 border + spot red',
    swatch: 'bg-neutral-50 border-l-4 border-black',
  },
  {
    href: 'v2',
    title: 'Glass / Aero',
    note: 'gradient + frosted glass + 큰 radius + soft glow',
    swatch:
      'bg-gradient-to-br from-purple-200 via-pink-200 to-blue-200 border-l-4 border-purple-400',
  },
  {
    href: 'v3',
    title: 'Terminal / IDE',
    note: 'dark + monospace + neon accent + grid',
    swatch: 'bg-[#0d1117] border-l-4 border-cyan-500 text-gray-300',
  },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-neutral-100 px-8 py-16 font-sans">
      <div className="mx-auto max-w-3xl">
        <div className="text-xs uppercase tracking-[0.3em] text-neutral-500">
          researchmochi · design exploration
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-900">
          3 시안 비교
        </h1>
        <p className="mt-2 text-neutral-600">
          production 디자인 (Bento Editorial) 과 완전히 다른 방향 3가지. 같은
          캔버스 (도구 6장) 화면을 어떻게 그리는지 비교용. 머지 X — preview only.
        </p>

        <div className="mt-10 space-y-4">
          {SHEETS.map((s) => (
            <Link
              key={s.href}
              href={`/design-explore/${s.href}`}
              className="block rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 transition overflow-hidden"
            >
              <div className="flex">
                <div className={`w-32 ${s.swatch}`} />
                <div className="flex-1 px-6 py-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-neutral-500 uppercase">
                      {s.href}
                    </span>
                    <span className="text-xl font-medium text-neutral-900">
                      {s.title}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-neutral-600">{s.note}</div>
                </div>
                <div className="flex items-center pr-6 text-neutral-400">→</div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 text-xs text-neutral-500">
          isolated route — 사이드바/provider 미상속. /design-explore 외 영향 0.
        </div>
      </div>
    </div>
  );
}
