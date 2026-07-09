'use client';

import usageMap from '../usage-map.generated.json';
import type { SectionId } from './sections';

type Usage = { widget: string; file: string; line: number };

// scripts/gen-ds-usage.mjs 산출물. component 섹션마다 키 존재(0이면 []).
// token 섹션(color/radius/…)은 키가 없어 undefined → 패널 미표시.
const USAGE_MAP = usageMap as unknown as Record<string, Usage[]>;

export function CanvasUsages({ id }: { id: SectionId }) {
  const usages = USAGE_MAP[id];
  if (!usages) return null; // foundation/token 섹션 — 사용처 패널 없음

  const groups = new Map<string, Usage[]>();
  for (const u of usages) {
    const arr = groups.get(u.widget);
    if (arr) arr.push(u);
    else groups.set(u.widget, [u]);
  }

  return (
    <section className="mt-12 border-t border-line-soft pt-6">
      <div className="eyebrow-mute mb-1">캔버스 사용처</div>
      <p className="mb-4 text-sm text-mute-soft">
        이 컴포넌트를 실제로 쓰는 캔버스 위젯 목록. <code>pnpm gen:ds-usage</code> 로 소스에서 자동 생성.
      </p>
      {usages.length === 0 ? (
        <p className="text-sm text-mute">현재 캔버스 위젯에서 사용되지 않습니다.</p>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([widget, items]) => (
            <div key={widget}>
              <h3 className="mb-1.5 text-sm font-semibold text-ink">{widget}</h3>
              <ul className="space-y-0.5">
                {items.map((u) => (
                  <li key={`${u.file}:${u.line}`} className="font-mono text-xs-soft text-mute">
                    {u.file}:{u.line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
