'use client';

/* ────────────────────────────────────────────────────────────────────
   ReportEditBody — 편집 모드 보고서 본문 (fresh · BUILD-SPEC §0.4·§1.4 · S5a–c).

   읽기 모드의 <ReportBody> 와 같은 블록 비주얼을 그대로 재사용(planBlocks/
   renderBlock export)하되, 그 사이에 편집 어포던스를 짜 넣는다:
   - 블록 사이 <SectionGap>(＋) — 자연어 지시로 새 절 삽입.
   - 본문 drag-to-ask <AskLayer> — 구절 선택 → 질문 → 답변 카드(앵커 아래 인라인).
   - inserted_qa/inserted_section(사용자 생성물) 인라인 편집(＋ 기타 편집 대상 블록).

   이 컴포넌트는 편집 모드에서만 마운트된다 — 읽기 모드에는 <ReportBody> 가 붙어
   ＋도 드래그 하이라이트도 DOM 에 없다(§0.4 하드). 삽입/편집 로직은 use-topline-
   section-insert · use-topline-drag-to-ask · use-topline-edit 재사용(계약 무변경).
   ──────────────────────────────────────────────────────────────────── */

import { Fragment, useMemo, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { isEditableToplineBlockType } from '@/lib/interview-v2/types';
import { useToast } from '@/components/toast-provider';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { useToplineDragToAsk } from '@/hooks/use-topline-drag-to-ask';
import { useToplineSectionInsert } from '@/hooks/use-topline-section-insert';
import { useToplineEdit } from '@/hooks/use-topline-edit';
import { planBlocks, renderBlock, type Tr } from './report-blocks';
import { SectionGap, PendingSectionCard } from './section-gap';
import { AskLayer, PendingQaCard } from './ask-popup';

// 인라인 블록 편집기 — 편집 대상 블록의 md 를 plain textarea 로 열어 내용만 수정
// (스타일 X). 저장 = 낙관적 반영 + PATCH(edit_block), 취소 = 원문 유지(닫기만).
function BlockEditor({
  initialMd,
  saving,
  onSave,
  onCancel,
}: {
  initialMd: string;
  saving: boolean;
  onSave: (nextMd: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [draft, setDraft] = useState(initialMd);
  const unchanged = draft.trim() === initialMd.trim();
  return (
    <div className="rounded-panel border-2 border-ink bg-paper p-3.5 shadow-memphis-md-faint">
      {/* eslint-disable-next-line react/forbid-elements -- 인라인 편집은 자동 높이 plain textarea chrome; Textarea primitive 고정 스타일과 불일치 */}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        autoFocus
        disabled={saving}
        aria-label={t('editBlockLabel')}
        className="w-full resize-none rounded-control border-[1.5px] border-ink bg-paper px-3 py-2.5 text-md leading-[1.7] text-ink-2 outline-none disabled:opacity-60"
      />
      <div className="mt-2 flex items-center gap-2.5">
        <span className="font-mono-label text-xs text-mute-soft">
          {t('editBlockHint')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* eslint-disable-next-line react/forbid-elements -- 취소는 outline rounded-pill chrome; Button variant 와 불일치 */}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center rounded-pill border-[1.5px] border-ink/20 px-3.5 py-[7px] text-md font-bold text-mute disabled:opacity-45"
          >
            {t('editBlockCancel')}
          </button>
          {/* eslint-disable-next-line react/forbid-elements -- 저장은 solid ink rounded-pill chrome; Button primary radius 와 불일치 */}
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving || unchanged || draft.trim().length === 0}
            className="inline-flex items-center rounded-pill bg-ink px-4 py-[7px] text-md font-extrabold text-paper shadow-memphis-sm-faint disabled:opacity-45"
          >
            {t('editBlockSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReportEditBody({
  blocks,
  metaRight,
  projectId,
  containerRef,
  refetch,
  applyBlockMd,
  // 인터뷰 코퍼스가 있는지(indexed) — drag-to-ask / 섹션 삽입은 근거로 생성하므로
  // 필수. false 면 ＋/질문 CTA 를 숨긴다(편집 모드지만 근거 없음).
  askEnabled,
}: {
  blocks: ToplineBlock[];
  metaRight: string;
  projectId: string;
  // 편집 캔버스 스크롤 컨테이너 ref — drag 선택 감지 스코프.
  containerRef: RefObject<HTMLElement | null>;
  refetch: () => Promise<void> | void;
  applyBlockMd: (blockId: string, md: string) => void;
  askEnabled: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  const tr = t as unknown as Tr;
  const toast = useToast();
  const execLabel = t('reportExecLabel');
  const plan = planBlocks(blocks, tr);

  const dta = useToplineDragToAsk({ projectId, onMerged: refetch });
  const section = useToplineSectionInsert({
    projectId,
    onInserted: refetch,
    onError: (code) =>
      toast.push(
        code === 'no_answer'
          ? t('editSectionNoContent')
          : `${t('editSectionError')} (${code})`,
        { tone: 'warn' },
      ),
  });
  const edit = useToplineEdit({ projectId, applyBlockMd, onSaved: refetch });

  const [openGapKey, setOpenGapKey] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const blockIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);
  // anchor 가 현재 블록 목록에 없는 pending(그 사이 재생성 등) 은 말미에.
  const topPendingSections = section.pending.filter((p) => p.anchorBlockId === null);
  const orphanPendingSections = section.pending.filter(
    (p) => p.anchorBlockId !== null && !blockIds.has(p.anchorBlockId),
  );
  const orphanPendingQa = dta.pending.filter((p) => !blockIds.has(p.anchorBlockId));

  // gap 렌더 — anchor(gap 위 블록 id, null=최상단) + 고유 key. 근거 없으면 미표시.
  const renderGap = (anchorBlockId: string | null, gapKey: string) => {
    if (!askEnabled) return null;
    return (
      <SectionGap
        open={openGapKey === gapKey}
        busy={false}
        onOpen={() => setOpenGapKey(gapKey)}
        onClose={() => setOpenGapKey((k) => (k === gapKey ? null : k))}
        onSubmit={(prompt) => {
          void section.insert(anchorBlockId, prompt);
          setOpenGapKey(null);
        }}
      />
    );
  };

  const saveEdit = async (blockId: string, prevMd: string, nextMd: string) => {
    const res = await edit.save(blockId, prevMd, nextMd);
    setEditingBlockId(null);
    if (!res.ok) {
      toast.push(`${t('editBlockError')} (${res.error})`, { tone: 'warn' });
    }
  };

  return (
    <div
      ref={containerRef as RefObject<HTMLDivElement>}
      className="mx-auto flex w-[var(--iv-body-col-w)] max-w-full flex-col selection:bg-sun selection:text-ink"
    >
      {askEnabled && <div className="mb-3.5">{renderGap(null, 'top')}</div>}
      {topPendingSections.map((p) => (
        <div key={p.id} className="mt-3.5">
          <PendingSectionCard prompt={p.prompt} />
        </div>
      ))}

      {plan.map(({ block, mt, meta }) => {
        const editable = isEditableToplineBlockType(block.type);
        const isEditing = editingBlockId === block.id;
        const pendingUnder = dta.pending.filter((p) => p.anchorBlockId === block.id);
        return (
          <Fragment key={block.id}>
            <div data-block-id={block.id} className={`group/block relative ${mt}`}>
              {isEditing ? (
                <BlockEditor
                  initialMd={block.md ?? ''}
                  saving={edit.savingId === block.id}
                  onSave={(next) => void saveEdit(block.id, block.md ?? '', next)}
                  onCancel={() => setEditingBlockId(null)}
                />
              ) : (
                <>
                  {renderBlock(block, meta, tr, execLabel, metaRight)}
                  {/* 편집 어포던스 — 편집 대상 블록(삽입 카드 포함)만. hover 노출. */}
                  {editable && (
                    // eslint-disable-next-line react/forbid-elements -- 블록 편집 트리거는 hover 시 뜨는 작은 typos 아이콘 chrome; IconButton 고정 radius/배경과 불일치
                    <button
                      type="button"
                      onClick={() => setEditingBlockId(block.id)}
                      aria-label={t('editBlockLabel')}
                      title={t('editBlockLabel')}
                      className="absolute right-0 top-0 hidden h-[26px] w-[26px] items-center justify-center rounded-nav border-[1.5px] border-ink bg-paper shadow-memphis-sm group-hover/block:flex focus-visible:flex"
                    >
                      <DuotoneIcon name="typos" size={13} />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* 이 블록을 앵커로 한 drag-to-ask 답변 카드. */}
            {pendingUnder.map((qa) => (
              <div key={qa.id} className="mt-3.5">
                <PendingQaCard
                  qa={qa}
                  onKeep={() => void dta.keep(qa)}
                  onDiscard={() => dta.discard(qa.id)}
                />
              </div>
            ))}

            {/* 블록 사이 ＋ gap — 근거 있을 때만(askEnabled) 렌더. */}
            {askEnabled && (
              <div className="mt-3.5">{renderGap(block.id, block.id)}</div>
            )}
          </Fragment>
        );
      })}

      {/* anchor 소실 pending — 말미 안전 렌더. */}
      {orphanPendingQa.map((qa) => (
        <div key={qa.id} className="mt-3.5">
          <PendingQaCard
            qa={qa}
            onKeep={() => void dta.keep(qa)}
            onDiscard={() => dta.discard(qa.id)}
          />
        </div>
      ))}
      {orphanPendingSections.map((p) => (
        <div key={p.id} className="mt-3.5">
          <PendingSectionCard prompt={p.prompt} />
        </div>
      ))}

      {/* 드래그 질문 레이어 — 선택 감지 + CTA + 입력 카드(fixed). */}
      <AskLayer
        containerRef={containerRef}
        enabled
        askEnabled={askEnabled}
        onAsk={(anchorBlockId, selectedText, question, mode) =>
          void dta.ask(anchorBlockId, selectedText, question, mode)
        }
      />
    </div>
  );
}
