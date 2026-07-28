'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { DeliverableRow } from '@/lib/artifacts/types';
import { FEATURE_OPEN_HREF, MOVE_SUPPORTED } from './constants';
import { Pressable } from './pressable';
import { OverflowMenu } from './overflow-menu';

// Open · Share · ⋯ cluster — the A2 action-enable matrix, made concrete.
//
// Open: primary except on error (secondary — it surfaces the failure + retry).
// Share: enabled only on `ready` deliverables. `shareable=false` HIDES it
//   entirely (BUILD-SPEC §3 + spec §제약3: hidden = "never for this kind",
//   distinct from disabled = "not right now"). Every adapter currently returns
//   shareable=false (shared_views not merged), so Share is hidden until that
//   lands. This follows the §제약3/BUILD-SPEC normative rule over §2's
//   "disabled+tooltip" phrasing — the two conflict and the constraint wins.
// ⋯: opens the overflow menu when the row is actionable (ready/draft); disabled
//   on processing/error (nothing to organise/export yet).

const PILL = 'inline-flex items-center justify-center rounded-pill';
const PRIMARY = 'border-2 border-ink bg-ink text-paper shadow-memphis-sm';
const SECONDARY = 'border-[1.5px] border-ink bg-paper text-ink shadow-memphis-sm';

export function RowActions({
  row,
  hasOrg,
  projects,
  onChanged,
}: {
  row: DeliverableRow;
  hasOrg: boolean;
  projects: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const t = useTranslations('Library');
  const router = useRouter();

  const openTreatment = row.status === 'error' ? SECONDARY : PRIMARY;

  return (
    <div className="flex shrink-0 items-center justify-end gap-[7px]">
      <Pressable
        onPress={() => router.push(FEATURE_OPEN_HREF[row.feature])}
        ariaLabel={t('action.open')}
        className={`${PILL} ${openTreatment} px-3.5 py-1.5 text-md font-extrabold`}
      >
        {t('action.open')}
      </Pressable>

      {row.shareable && (
        <Pressable
          onPress={() => {
            /* wired in the shared-views follow-up */
          }}
          disabled={row.status !== 'ready'}
          ariaLabel={t('action.share')}
          className={`${PILL} px-3 py-1.5 text-md font-bold ${
            row.status === 'ready'
              ? SECONDARY
              : 'border-[1.5px] border-ink/20 bg-surface-disabled text-mute'
          }`}
        >
          {t('action.share')}
        </Pressable>
      )}

      <OverflowMenu
        feature={row.feature}
        id={row.id}
        status={row.status}
        exportFormats={row.export_formats}
        currentProjectId={row.project_id}
        moveSupported={MOVE_SUPPORTED[row.feature]}
        hasOrg={hasOrg}
        projects={projects}
        onChanged={onChanged}
        moreLabel={t('action.more')}
      />
    </div>
  );
}
