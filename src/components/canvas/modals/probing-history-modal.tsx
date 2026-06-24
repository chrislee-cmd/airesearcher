'use client';

/* ────────────────────────────────────────────────────────────────────
   probing-history-modal — 과거 probing 제안 세트 한 건을 펼쳐 보는 모달.

   probing-card 의 산출물 영역에서 row 클릭 시 호출. 카드 본문에는
   질문 텍스트만 압축돼 보이지만, 모달에서는 technique 라벨 + why 문구
   까지 모두 노출. 카드 클릭과 동일하게 모달 안 카드도 클립보드 복사.
   ──────────────────────────────────────────────────────────────────── */

import { Modal } from '@/components/ui/modal';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
} from '@/lib/probing-prompts';
import type { ProbingSuggestionSet } from '@/components/canvas/widgets/probing-types';

function formatTime(epochMs: number) {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function ProbingHistoryModal({
  set,
  onClose,
  onCopy,
}: {
  set: ProbingSuggestionSet | null;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const open = set !== null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={set ? `제안 세트 · ${formatTime(set.created_at)}` : ''}
      description={set ? `질문 ${set.questions.length}개 · 클릭하면 복사됩니다` : ''}
      size="lg"
    >
      {set && (
        <ul className="space-y-3">
          {set.questions.map((q, i) => {
            const label =
              q.technique && q.technique in PROBING_TECHNIQUE_LABEL
                ? PROBING_TECHNIQUE_LABEL[q.technique as ProbingTechnique]
                : q.technique || '제안';
            return (
              <li key={i}>
                {/* eslint-disable-next-line react/forbid-elements -- card-shaped clickable. <Button> primitive enforces center-aligned single-line capsule layout incompatible with this multi-row text+chip+why card. */}
                <button
                  type="button"
                  onClick={() => onCopy(q.text)}
                  className="w-full rounded-sm border border-line bg-paper px-4 py-3 text-left transition-colors duration-[120ms] hover:border-amore"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-lg leading-[1.55] text-ink-2">
                      {q.text}
                    </span>
                    <span className="shrink-0 rounded-xs border border-line-soft px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-mute-soft">
                      {label}
                    </span>
                  </div>
                  {q.why && (
                    <p className="mt-1.5 text-sm leading-[1.6] text-mute">
                      {q.why}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
