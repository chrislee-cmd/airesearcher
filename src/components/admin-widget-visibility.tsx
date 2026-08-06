'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast-provider';

// 슈퍼어드민 위젯 노출 토글 화면. 서버 page 가 초기 상태를 SSR 로 주입하고,
// 여기서 낙관적 토글 + 실패 시 revert + 토스트. 위젯명은 Features.<key>.title
// (4로케일 이미 보유)를 재사용한다.

export type WidgetVisibilityRow = {
  key: string;
  visible: boolean;
  updatedAt: string | null;
};

// 행 dot 파스텔 톤 — 캔버스 3행(sun/mint/rose) 을 3개 단위로 반복해 시각적
// 리듬을 캔버스와 맞춘다(디자인 토큰만 사용).
const DOT_TONES = ['var(--color-sun)', 'var(--color-mint)', 'var(--color-rose)'];

export function AdminWidgetVisibility({
  initialWidgets,
}: {
  initialWidgets: WidgetVisibilityRow[];
}) {
  const t = useTranslations('AdminWidgetVisibility');
  const tFeatures = useTranslations('Features');
  const locale = useLocale();
  const { push } = useToast();
  const [rows, setRows] = useState<WidgetVisibilityRow[]>(initialWidgets);
  // 진행 중인 위젯 key — 중복 클릭 방지(토글 disabled).
  const [pending, setPending] = useState<Set<string>>(new Set());

  function formatUpdated(iso: string | null): string {
    if (!iso) return t('neverUpdated');
    try {
      return new Date(iso).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return t('neverUpdated');
    }
  }

  async function toggle(key: string, nextVisible: boolean) {
    if (pending.has(key)) return;
    setPending((p) => new Set(p).add(key));
    // 낙관적 반영.
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, visible: nextVisible } : r)),
    );
    try {
      const res = await fetch('/api/admin/widget-visibility', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgetKey: key, visible: nextVisible }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { updatedAt?: string };
      // 서버 truth(updatedAt) 로 정렬.
      setRows((prev) =>
        prev.map((r) =>
          r.key === key
            ? { ...r, visible: nextVisible, updatedAt: data.updatedAt ?? r.updatedAt }
            : r,
        ),
      );
    } catch {
      // 실패 — 낙관적 변경 되돌리고 토스트.
      setRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, visible: !nextVisible } : r)),
      );
      push(t('saveError'), { tone: 'warn' });
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto max-w-[880px] px-2 pb-16 pt-6">
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            ADMIN
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="mt-1 text-md text-mute">{t('subtitle')}</p>
      </div>

      <ul className="mt-6 flex flex-col divide-y divide-line-soft border-y border-line-soft">
        {rows.map((row, i) => {
          const name = tFeatures(`${row.key}.title` as never);
          const dot = DOT_TONES[Math.floor(i / 3) % DOT_TONES.length];
          const busy = pending.has(row.key);
          return (
            <li
              key={row.key}
              className="flex items-center gap-3 py-3.5"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: dot }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-md font-semibold text-ink">
                    {name}
                  </span>
                  {!row.visible && (
                    <Badge variant="subtle" size="sm">
                      {t('hiddenBadge')}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-mute-soft tabular-nums">
                  {t('lastUpdated', { when: formatUpdated(row.updatedAt) })}
                </div>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2">
                <span className="text-xs font-medium text-mute">
                  {row.visible ? t('shown') : t('hidden')}
                </span>
                <Checkbox
                  size="md"
                  checked={row.visible}
                  disabled={busy}
                  onChange={(e) => toggle(row.key, e.target.checked)}
                  aria-label={t('toggleAria', { name })}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
