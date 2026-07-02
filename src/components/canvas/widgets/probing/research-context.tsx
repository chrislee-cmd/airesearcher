'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingResearchContext — 우패널 상단의 사용자 입력 패널.

   PR (probing-question-thinking-flow): 우패널 4-layer 중 A 번. 3 필드:
     1. research_goal (조사 목적) — Textarea 2 rows
     2. hypotheses (핵심 가설 list) — chip container + ChipInput, Enter 분리
     3. key_research_question (KRQ) — Textarea 2 rows

   PR (probing-custom-section-ui): KRQ 텍스트 필드를 제거하고 그 자리를
   **"위젯 추가"** 방식으로 대체. 사용자가 title + 조사목적으로 custom 섹션을
   정의하면 좌패널 페르소나 grid 에 실시간으로 채워진다. custom 섹션 목록 +
   "+ 위젯 추가" 버튼 (modal) 이 여기서 노출되고, 실제 렌더/삭제는 좌패널
   (ReflectionPane) 이 담당한다. 목록의 × 는 여기서도 즉시 삭제 가능.

   영속화: research_context 는 부모 (probing-card) 가 GET/PUT
   `/api/probing/research-context`, custom 섹션은 useCustomSections(localStorage).
   본 컴포넌트는 controlled props 로 표시 / 갱신만 한다.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type KeyboardEvent } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import type { ProbingCustomSection } from '../probing-types';

const GOAL_MAX = 2_000;
const HYPOTHESIS_MAX = 500;
const HYPOTHESES_COUNT_MAX = 20;
const CUSTOM_TITLE_MAX = 120;
const CUSTOM_DESC_MAX = 1_000;

export function ProbingResearchContext({
  researchGoal,
  hypotheses,
  onResearchGoalChange,
  onHypothesesChange,
  customSections,
  onAddCustomSection,
  onRemoveCustomSection,
  customSectionsFull,
  disabled = false,
}: {
  researchGoal: string;
  hypotheses: string[];
  onResearchGoalChange: (next: string) => void;
  onHypothesesChange: (next: string[]) => void;
  customSections: ProbingCustomSection[];
  onAddCustomSection: (title: string, description?: string) => void;
  onRemoveCustomSection: (key: string) => void;
  customSectionsFull: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft('');
      return;
    }
    if (hypotheses.length >= HYPOTHESES_COUNT_MAX) {
      setDraft('');
      return;
    }
    if (hypotheses.includes(trimmed)) {
      setDraft('');
      return;
    }
    onHypothesesChange([...hypotheses, trimmed.slice(0, HYPOTHESIS_MAX)]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (
      e.key === 'Backspace' &&
      draft.length === 0 &&
      hypotheses.length > 0
    ) {
      e.preventDefault();
      onHypothesesChange(hypotheses.slice(0, -1));
    }
  }

  function removeHypothesis(idx: number) {
    onHypothesesChange(hypotheses.filter((_, i) => i !== idx));
  }

  function closeAdd() {
    setAddOpen(false);
    setTitleDraft('');
    setDescDraft('');
  }

  function commitAdd() {
    const t = titleDraft.trim();
    if (!t) return;
    onAddCustomSection(t, descDraft.trim() || undefined);
    closeAdd();
  }

  return (
    <section className="space-y-3 border-b-[2px] border-line-soft bg-paper px-4 py-3">
      <Field
        label="조사 목적"
        description="이 인터뷰로 알고자 하는 것 (1~2 문장)"
      >
        <Textarea
          value={researchGoal}
          onChange={(e) =>
            onResearchGoalChange(e.target.value.slice(0, GOAL_MAX))
          }
          rows={2}
          maxLength={GOAL_MAX}
          disabled={disabled}
          placeholder="예: 가성비 vs 프리미엄 선택 기준 이해"
          className="resize-none text-md"
        />
      </Field>

      <Field
        label="핵심 가설"
        description="검증 / 반증 대상 (한 줄씩, Enter 로 추가)"
      >
        <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
          {hypotheses.map((h, idx) => (
            <span
              key={`${idx}-${h}`}
              className="inline-flex items-center gap-1 rounded-pill border border-amore bg-white px-2.5 py-0.5 text-xs text-amore"
            >
              {h}
              <IconButton
                variant="ghost-brand"
                onClick={() => removeHypothesis(idx)}
                aria-label={`가설 제거: ${h}`}
                disabled={disabled}
              >
                ×
              </IconButton>
            </span>
          ))}
          <ChipInput
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, HYPOTHESIS_MAX))}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) commitDraft();
            }}
            disabled={disabled || hypotheses.length >= HYPOTHESES_COUNT_MAX}
            placeholder={
              hypotheses.length === 0
                ? '가설 추가 (Enter)'
                : hypotheses.length >= HYPOTHESES_COUNT_MAX
                  ? `최대 ${HYPOTHESES_COUNT_MAX}개`
                  : '+ 가설 추가'
            }
            className="min-w-[140px] flex-1"
          />
        </div>
      </Field>

      {/* 조사 위젯 — KRQ 필드 대체. 추가된 custom 섹션은 좌패널 페르소나
          grid 에 기본 8 섹션과 동일하게 노출되고 실시간으로 채워진다. */}
      <Field
        label="조사 위젯"
        description="궁금한 주제를 위젯으로 추가하면 페르소나 그리드에 실시간으로 채워집니다"
      >
        <div className="space-y-2">
          {customSections.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {customSections.map((c) => (
                <li
                  key={c.key}
                  className="flex items-start justify-between gap-2 rounded-xs border border-line-soft bg-paper-soft px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-md font-medium text-ink-2">
                      {c.title}
                    </p>
                    {c.description && (
                      <p className="truncate text-xs text-mute">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <IconButton
                    variant="ghost-danger"
                    onClick={() => onRemoveCustomSection(c.key)}
                    aria-label={`위젯 제거: ${c.title}`}
                    disabled={disabled}
                  >
                    ×
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={disabled || customSectionsFull}
            className="w-full"
          >
            {customSectionsFull ? '위젯 한도 도달' : '+ 위젯 추가'}
          </Button>
        </div>
      </Field>

      <Modal
        open={addOpen}
        onClose={closeAdd}
        size="sm"
        labelledBy="probing-custom-section-add-title"
      >
        <div className="flex flex-col gap-4 p-6">
          <h2
            id="probing-custom-section-add-title"
            className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
          >
            조사 위젯 추가
          </h2>
          <Field
            label="위젯 이름"
            description="페르소나 그리드에 표시될 섹션 제목"
          >
            <Input
              value={titleDraft}
              onChange={(e) =>
                setTitleDraft(e.target.value.slice(0, CUSTOM_TITLE_MAX))
              }
              maxLength={CUSTOM_TITLE_MAX}
              placeholder="예: 구매 여정 / 경쟁사 전환 이유"
              size="sm"
            />
          </Field>
          <Field
            label="조사 목적"
            description="이 위젯에서 알고 싶은 것 (선택)"
          >
            <Textarea
              value={descDraft}
              onChange={(e) =>
                setDescDraft(e.target.value.slice(0, CUSTOM_DESC_MAX))
              }
              rows={3}
              maxLength={CUSTOM_DESC_MAX}
              placeholder="예: 응답자가 기존 도구를 떠난 결정적 순간과 그 트리거"
              className="resize-none text-md"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeAdd}>
              취소
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={commitAdd}
              disabled={titleDraft.trim().length === 0}
            >
              추가
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
