'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { usePopoverBase } from '@/components/ui/use-popover-base';
import type { DeliverableFeature, DeliverableStatus } from '@/lib/artifacts/types';
import { FEATURE_OPEN_HREF, isEnabled } from './constants';
import { Pressable } from './pressable';

// ⋯ row menu — trigger + portal. Portal at z-overlay (the app's top menu
// layer; CD asks for z-60, z-overlay=70 is the shipped portal-menu precedent
// in ui/select-menu.tsx and guarantees it clears content + rail).
//
// Groups (BUILD-SPEC A4a): Export (from export_formats — omitted entirely when
// empty or when status isn't ready, never an empty heading) → Organize
// (Move to project / Delete). Delete is out of scope for this PR (shown
// disabled). Trigger flips to bg-ink while open.

const MENU_WIDTH = 248;

// format → menu row glyph. Label is the uppercased format + `.ext`, so a new
// export format needs no i18n change (the shared-contract goal).
const EXPORT_ICON: Record<string, string> = {
  docx: '📄',
  pdf: '📕',
  srt: '🎬',
  md: '📝',
  txt: '📃',
  csv: '📊',
};

export function OverflowMenu({
  feature,
  id,
  status,
  exportFormats,
  currentProjectId,
  moveSupported,
  hasOrg,
  projects,
  onChanged,
  moreLabel,
}: {
  feature: DeliverableFeature;
  id: string;
  status: DeliverableStatus;
  exportFormats: string[];
  currentProjectId: string | null;
  moveSupported: boolean;
  hasOrg: boolean;
  projects: { id: string; name: string }[];
  onChanged: () => void;
  moreLabel: string;
}) {
  const t = useTranslations('Library');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const { triggerRef, panelRef, anchorRect } = usePopoverBase<HTMLSpanElement, HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
  });

  const enabled = isEnabled(status);
  // Export group appears only when the deliverable is actually exportable —
  // ready + at least one format (A2: export enabled for ready only).
  const showExport = status === 'ready' && exportFormats.length > 0;
  const moveEnabled = moveSupported && hasOrg && projects.length > 0;

  const triggerCls = open
    ? 'border-2 border-ink bg-ink text-paper shadow-memphis-sm'
    : enabled
      ? 'border-[1.5px] border-ink bg-paper text-ink shadow-memphis-sm'
      : 'border-[1.5px] border-ink/20 bg-surface-disabled text-mute';

  async function moveTo(next: string | null) {
    setMoving(true);
    try {
      const res = await fetch('/api/artifacts/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature, id, project_id: next }),
      });
      if (res.ok) {
        setOpen(false);
        onChanged();
      }
    } finally {
      setMoving(false);
    }
  }

  const left = anchorRect
    ? Math.max(8, anchorRect.right - MENU_WIDTH)
    : 0;
  const top = anchorRect ? anchorRect.bottom + 6 : 0;

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
    >
      <Pressable
        onPress={() => enabled && setOpen((v) => !v)}
        disabled={!enabled}
        ariaLabel={moreLabel}
        className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-icon text-lg font-bold ${triggerCls}`}
      >
        ⋯
      </Pressable>

      {open &&
        anchorRect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            className="fixed z-overlay overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-lg"
            style={{ top, left, width: MENU_WIDTH }}
          >
            {showExport && (
              <>
                <div className="border-b border-line-strong bg-paper-soft px-3 py-2 font-mono-label text-xs uppercase tracking-[0.12em] text-mute-soft">
                  {t('menu.export')}
                </div>
                {exportFormats.map((fmt) => (
                  <Pressable
                    key={fmt}
                    // Export-registry isn't merged yet — fall back to the
                    // feature's own surface where export already exists.
                    onPress={() => {
                      setOpen(false);
                      router.push(FEATURE_OPEN_HREF[feature]);
                    }}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2.5 hover:bg-paper-soft"
                  >
                    <span className="text-lg">{EXPORT_ICON[fmt] ?? '📄'}</span>
                    <span className="flex-1 text-md font-semibold text-ink">
                      {fmt.toUpperCase()}
                    </span>
                    <span className="font-mono-label text-xs text-mute-soft">.{fmt}</span>
                  </Pressable>
                ))}
              </>
            )}

            <div className="border-b border-t border-line-strong bg-paper-soft px-3 py-2 font-mono-label text-xs uppercase tracking-[0.12em] text-mute-soft">
              {t('menu.organize')}
            </div>

            {/* Move to project — reuses /api/artifacts/assign. Native <select>
                is DS-lint-allowed (only button/input/textarea are banned). */}
            <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
              <span className="text-lg">📁</span>
              {moveEnabled ? (
                <select
                  aria-label={t('move.title')}
                  value={currentProjectId ?? '__unfiled__'}
                  disabled={moving}
                  onChange={(e) =>
                    moveTo(e.target.value === '__unfiled__' ? null : e.target.value)
                  }
                  className="flex-1 border-0 bg-transparent text-md font-semibold text-ink focus:outline-none disabled:opacity-50"
                >
                  <option value="__unfiled__">{t('move.unfiled')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex-1 text-md font-semibold text-mute">
                  {t('action.move')}
                </span>
              )}
              <span className="text-md text-mute-soft">›</span>
            </div>

            {/* Delete is out of scope for this PR — policy undecided. Shown
                disabled so the affordance is discoverable without acting. */}
            <span
              role="menuitem"
              aria-disabled
              title={t('deleteUnavailable')}
              className="flex cursor-not-allowed items-center gap-2.5 px-3 py-2.5"
            >
              <span className="text-lg opacity-40">🗑</span>
              <span className="flex-1 text-md font-bold text-mute">
                {t('action.delete')}
              </span>
            </span>
          </div>,
          document.body,
        )}
    </span>
  );
}
