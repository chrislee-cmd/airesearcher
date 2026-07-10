'use client';

import { Link } from '@/i18n/navigation';
import usageMap from '../usage-map.generated.json';
import type { SectionId } from './sections';

type Usage = { widget: string; key: string | null; file: string; line: number };

// scripts/gen-ds-usage.mjs 산출물. component 섹션마다 키 존재(0이면 []).
// token 섹션(color/radius/…)은 키가 없어 undefined → 패널 미표시.
const USAGE_MAP = usageMap as unknown as Record<string, Usage[]>;

// file:line → GitHub 소스 딥링크. main 브랜치 기준.
const GH_BLOB = 'https://github.com/chrislee-cmd/airesearcher/blob/main/';

export function CanvasUsages({ id }: { id: SectionId }) {
  const usages = USAGE_MAP[id];
  if (!usages) return null; // foundation/token 섹션 — 사용처 패널 없음

  // 위젯 라벨로 그룹핑(첫 항목의 focus key 유지 — 같은 위젯은 key 동일).
  const groups = new Map<string, { key: string | null; items: Usage[] }>();
  for (const u of usages) {
    const g = groups.get(u.widget);
    if (g) g.items.push(u);
    else groups.set(u.widget, { key: u.key, items: [u] });
  }

  return (
    <section className="mt-12 border-t border-line-soft pt-6">
      <div className="eyebrow-mute mb-1">캔버스 사용처</div>
      <p className="mb-4 text-sm text-mute-soft">
        이 컴포넌트를 쓰는 캔버스 위젯. 위젯명을 누르면 캔버스에서 해당 위젯으로 이동하고, 파일
        경로를 누르면 GitHub 소스로 이동합니다. <code>pnpm gen:ds-usage</code> 로 자동 생성.
      </p>
      {usages.length === 0 ? (
        <p className="text-sm text-mute">현재 캔버스 위젯에서 사용되지 않습니다.</p>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([widget, { key, items }]) => (
            <div key={widget}>
              {key ? (
                <Link
                  href={`/canvas?focus=${key}`}
                  title="캔버스에서 이 위젯 보기"
                  className="group mb-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink transition-colors hover:text-amore"
                >
                  {widget}
                  <span aria-hidden className="text-xs-soft text-mute-soft group-hover:text-amore">
                    ↗ 캔버스에서 보기
                  </span>
                </Link>
              ) : (
                <h3 className="mb-1.5 text-sm font-semibold text-ink">{widget}</h3>
              )}
              <ul className="space-y-0.5">
                {items.map((u) => (
                  <li key={`${u.file}:${u.line}`}>
                    <a
                      href={`${GH_BLOB}${u.file}#L${u.line}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs-soft text-mute transition-colors hover:text-amore hover:underline"
                    >
                      {u.file}:{u.line}
                    </a>
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
