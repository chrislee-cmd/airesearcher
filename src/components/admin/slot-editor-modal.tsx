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

export type SlotDraft = {
  // Present when editing an existing slot; absent for a fresh create.
  id?: string;
  candidateId: string;
  startLocal: string; // datetime-local value
  endLocal: string;
  status: SlotStatus;
  location: string;
  note: string;
};

type CandidateOption = { id: string; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  draft: SlotDraft | null;
  candidates: CandidateOption[];
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
  allSlots,
  onSaved,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
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

  async function save() {
    if (saving) return;
    const startIso = fromLocalInputValue(startLocal);
    const endIso = fromLocalInputValue(endLocal);
    if (!candidateId || !startIso || !endIso) {
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
            body: JSON.stringify({
              candidate_id: candidateId,
              start_at: startIso,
              end_at: endIso,
              status,
              location,
              note,
            }),
          });
      if (!res.ok) {
        setError(t('slotSaveFailed'));
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
        <Select
          label={t('slotCandidate')}
          value={candidateId}
          onChange={(e) => setCandidateId(e.target.value)}
          options={candidates.map((c) => ({ value: c.id, label: c.label }))}
          disabled={isEditing}
        />

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
