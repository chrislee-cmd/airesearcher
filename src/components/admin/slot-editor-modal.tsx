'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type SchedSlot,
  type SlotStatus,
  findOverlaps,
  fromLocalInputValue,
} from '@/lib/scheduling/slots';

// Individual = one slot for the selected candidate (or a candidate-less titled
// event). Group = fan out one slot per candidate in the batch (server-side).
export type SlotAssignMode = 'individual' | 'group';

export type SlotDraft = {
  // Present when editing an existing slot; absent for a fresh create.
  id?: string;
  // Individual vs group fan-out. Group is create-only (editing is per-slot).
  mode: SlotAssignMode;
  // Free-text event label (PR-B). Required unless a candidate is attached.
  title: string;
  // Optional (PR-B) — a titled event may have no candidate.
  candidateId: string;
  startLocal: string; // datetime-local value
  endLocal: string;
  status: SlotStatus;
  location: string;
  note: string;
};

type CandidateOption = { id: string; label: string };
// A selectable group for group-mode fan-out — name + its active-candidate count.
export type GroupOption = { id: string; name: string; count: number };

type Props = {
  open: boolean;
  onClose: () => void;
  draft: SlotDraft | null;
  candidates: CandidateOption[];
  // Batch the new slot belongs to — scopes candidate-less titled events (PR-B)
  // and is the default fan-out target in group mode.
  batchId: string;
  // Every assignment group — the group-mode picker lists them all so the admin
  // can fan out to any group, not just the calendar's active one.
  groupOptions: GroupOption[];
  // All existing slots — used for the soft double-booking warning.
  allSlots: SchedSlot[];
  onSaved: () => void;
};

// Create / edit / cancel a single interview slot. Times are entered in the
// admin's local timezone (datetime-local) and converted to UTC ISO on save.
// Double-booking is surfaced as a soft warning only (spec: no hard block).
export function SlotEditorModal({
  open,
  onClose,
  draft,
  candidates,
  batchId,
  groupOptions,
  allSlots,
  onSaved,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const [mode, setMode] = useState<SlotAssignMode>('individual');
  // Which group to fan out over in group mode (defaults to the calendar's group).
  const [groupId, setGroupId] = useState('');
  const [title, setTitle] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [status, setStatus] = useState<SlotStatus>('proposed');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-seed local state whenever a new draft is opened.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed local form state from the incoming draft each time the modal opens.
  // Keyed by draftKey so a fresh open re-seeds; reset on close so re-editing the
  // *same* slot after a save still re-seeds (an id-only key would match the
  // stale seededFor and skip).
  const draftKey = draft ? (draft.id ?? `new:${draft.candidateId}:${draft.startLocal}`) : null;
  if (open && draft && seededFor !== draftKey) {
    setMode(draft.mode);
    // Default the group picker to the calendar's active group when present,
    // otherwise the first available group.
    setGroupId(
      groupOptions.some((g) => g.id === batchId)
        ? batchId
        : (groupOptions[0]?.id ?? ''),
    );
    setTitle(draft.title);
    setCandidateId(draft.candidateId);
    setStartLocal(draft.startLocal);
    setEndLocal(draft.endLocal);
    setStatus(draft.status);
    setLocation(draft.location);
    setNote(draft.note);
    setError(null);
    setSeededFor(draftKey);
  } else if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const isEditing = Boolean(draft?.id);

  // Soft double-booking check against the currently-entered times.
  const overlaps = useMemo(() => {
    const startIso = fromLocalInputValue(startLocal);
    const endIso = fromLocalInputValue(endLocal);
    if (!startIso || !endIso) return [];
    return findOverlaps(
      { start_at: startIso, end_at: endIso, status },
      allSlots,
      draft?.id,
    );
  }, [startLocal, endLocal, status, allSlots, draft?.id]);

  // Group mode is create-only; editing an existing slot is always per-candidate.
  const isGroup = mode === 'group' && !isEditing;
  const selectedGroup = groupOptions.find((g) => g.id === groupId) ?? null;
  const groupCount = selectedGroup?.count ?? 0;

  async function save() {
    if (saving) return;
    const startIso = fromLocalInputValue(startLocal);
    const endIso = fromLocalInputValue(endLocal);
    // Group mode fans out to the batch's candidates, so it needs neither a title
    // nor a candidate — just a non-empty group. Individual mode needs a title OR
    // a candidate (PR-B). Both need valid times.
    if (isGroup) {
      if (groupCount === 0) {
        setError(t('slotGroupEmpty'));
        return;
      }
    } else if (!title.trim() && !candidateId) {
      setError(t('slotMissingFields'));
      return;
    }
    if (!startIso || !endIso) {
      setError(t('slotMissingFields'));
      return;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError(t('slotEndBeforeStart'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = isEditing
        ? await fetch(`/api/scheduling/slots/${draft!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              start_at: startIso,
              end_at: endIso,
              status,
              location,
              note,
            }),
          })
        : await fetch('/api/scheduling/slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              isGroup
                ? {
                    mode: 'group',
                    batch_id: groupId,
                    title,
                    start_at: startIso,
                    end_at: endIso,
                    status,
                    location,
                    note,
                  }
                : {
                    title,
                    candidate_id: candidateId,
                    batch_id: batchId,
                    start_at: startIso,
                    end_at: endIso,
                    status,
                    location,
                    note,
                  },
            ),
          });
      if (!res.ok) {
        // Surface the empty-group case distinctly so the admin knows to add
        // candidates rather than assume a generic save failure.
        if (isGroup) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(
            body?.error === 'no_candidates'
              ? t('slotGroupEmpty')
              : t('slotSaveFailed'),
          );
        } else {
          setError(t('slotSaveFailed'));
        }
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEditing || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduling/slots/${draft!.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(t('slotDeleteFailed'));
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? t('slotEditTitle') : t('slotCreateTitle')}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {isEditing ? (
            <Button variant="destructive-link" onClick={remove} disabled={saving}>
              {t('slotDelete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t('slotCancel')}
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? t('slotSaving') : t('slotSave')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label={t('slotTitle')}
          placeholder={t('slotTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Assignment mode — create-only. Editing an existing slot is always
            per-candidate, so the toggle is hidden there. */}
        {!isEditing && (
          <Select
            label={t('slotAssignMode')}
            value={mode}
            onChange={(e) => setMode(e.target.value as SlotAssignMode)}
            options={[
              { value: 'individual', label: t('slotModeIndividual') },
              { value: 'group', label: t('slotModeGroup') },
            ]}
          />
        )}

        {isGroup ? (
          <div className="flex flex-col gap-2">
            <Select
              label={t('slotGroupSelect')}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              options={groupOptions.map((g) => ({
                value: g.id,
                label: g.name || t('slotUntitled'),
              }))}
            />
            <p className="text-sm text-mute">
              {t('slotGroupHelper', { count: groupCount })}
            </p>
          </div>
        ) : (
          <Select
            label={t('slotCandidateOptional')}
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            options={[
              { value: '', label: t('slotCandidateNone') },
              ...candidates.map((c) => ({ value: c.id, label: c.label })),
            ]}
            disabled={isEditing}
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t('slotStart')}
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
          <Input
            label={t('slotEnd')}
            type="datetime-local"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </div>

        <Select
          label={t('slotStatus')}
          value={status}
          onChange={(e) => setStatus(e.target.value as SlotStatus)}
          options={[
            { value: 'proposed', label: t('statusProposed') },
            { value: 'confirmed', label: t('statusConfirmed') },
            { value: 'cancelled', label: t('statusCancelled') },
          ]}
        />

        <Input
          label={t('slotLocation')}
          placeholder={t('slotLocationPlaceholder')}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <Textarea
          label={t('slotNote')}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {overlaps.length > 0 && (
          <p className="rounded-xs border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning">
            {t('slotOverlapWarn', { count: overlaps.length })}
          </p>
        )}
        {error && <p className="text-sm text-warning">{error}</p>}
      </div>
    </Modal>
  );
}
