'use client';

/* ────────────────────────────────────────────────────────────────────
   Canvas Layout Publish Control — 슈퍼어드민 전용 "기본 배치로 발행".

   슈퍼어드민이 캔버스에서 위젯을 드래그해 만든 현재 배치(positions)를 그대로
   전역 발행한다 → 일반계정의 초기 렌더 baseline 이 된다. 별도 admin 화면 없이
   "드래그한 그대로" 발행해 재현 드리프트를 0으로 둔다(스펙 설계 결정).

   position: fixed 로 viewport 우하단 고정 — canvas pan/zoom 과 무관. Navigator
   (좌상단)와 충돌하지 않는다. 일반계정에는 렌더되지 않는다(board 가 canPublish
   로 게이트).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { CanvasCoords } from '@/lib/admin/canvas-layout';

type Status = 'idle' | 'publishing' | 'done' | 'error';

export function LayoutPublishControl({
  positions,
  onPublished,
}: {
  positions: Record<string, CanvasCoords>;
  // 발행 성공 시 서버 version 통지 — board 가 로컬 적용 version 을 갱신해
  // 슈퍼어드민 자신은 재적용 루프에 걸리지 않게 한다.
  onPublished?: (version: number) => void;
}) {
  const t = useTranslations('Canvas.publish');
  const [status, setStatus] = useState<Status>('idle');
  // done/error 라벨을 잠깐 보여준 뒤 idle 로 되돌리는 타이머.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((next: Status) => {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 2400);
  }, []);

  const publish = useCallback(async () => {
    if (status === 'publishing') return;
    setStatus('publishing');
    try {
      const res = await fetch('/api/admin/canvas-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      });
      if (!res.ok) {
        flash('error');
        return;
      }
      const json = (await res.json()) as {
        layout?: { version?: number } | null;
      };
      const version = json?.layout?.version;
      if (typeof version === 'number') onPublished?.(version);
      flash('done');
    } catch {
      flash('error');
    }
  }, [status, positions, onPublished, flash]);

  const label =
    status === 'publishing'
      ? t('publishing')
      : status === 'done'
        ? t('published')
        : status === 'error'
          ? t('failed')
          : t('publish');

  return (
    <div
      data-canvas-action
      className="fixed bottom-6 right-6 z-fab flex flex-col items-end gap-1"
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={publish}
        disabled={status === 'publishing'}
        aria-live="polite"
      >
        {label}
      </Button>
      <span className="text-xs text-mute">{t('hint')}</span>
    </div>
  );
}
