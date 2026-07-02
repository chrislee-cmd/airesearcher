'use client';

/* ────────────────────────────────────────────────────────────────────
   AddCustomSectionCard — 좌패널 페르소나 grid 마지막의 "위젯 추가" 블록.

   PR (probing-widget-add-move-to-left-grid): 옛 우패널의 "조사 위젯" 섹션 +
   "+ 위젯 추가" 버튼을 폐기하고, 좌패널 페르소나 grid 의 **마지막 칸** 으로
   이동. PersonaPanel 과 동일한 shell (테두리 / hover) 에 중앙 "+" 아이콘 +
   "위젯 추가" 텍스트. 클릭 시 title + 조사목적 입력 modal 은 이전과 동일하게
   재사용 — 본 컴포넌트가 open state + drafts 를 자체 소유한다.

   custom 섹션 한도 (CUSTOM_SECTION_MAX) 도달 시 "위젯 한도 도달" 로 비활성화.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

const CUSTOM_TITLE_MAX = 120;
const CUSTOM_DESC_MAX = 1_000;

export function AddCustomSectionCard({
  onAdd,
  full,
  disabled = false,
}: {
  onAdd: (title: string, description?: string) => void;
  full: boolean;
  disabled?: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  function closeAdd() {
    setAddOpen(false);
    setTitleDraft('');
    setDescDraft('');
  }

  function commitAdd() {
    const t = titleDraft.trim();
    if (!t) return;
    onAdd(t, descDraft.trim() || undefined);
    closeAdd();
  }

  const blocked = disabled || full;

  return (
    <>
      <Button
        variant="ghost"
        fullWidth
        onClick={() => setAddOpen(true)}
        disabled={blocked}
        aria-label="조사 위젯 추가"
        className="min-h-[120px] flex-col p-3"
      >
        <span className="flex flex-col items-center gap-1.5">
          <span aria-hidden className="text-2xl leading-none">
            +
          </span>
          <span className="text-xs uppercase tracking-[0.22em]">
            {full ? '위젯 한도 도달' : '위젯 추가'}
          </span>
        </span>
      </Button>

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
          <Field label="위젯 이름" description="페르소나 그리드에 표시될 섹션 제목">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value.slice(0, CUSTOM_TITLE_MAX))}
              maxLength={CUSTOM_TITLE_MAX}
              placeholder="예: 구매 여정 / 경쟁사 전환 이유"
              size="sm"
            />
          </Field>
          <Field label="조사 목적" description="이 위젯에서 알고 싶은 것 (선택)">
            <Textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value.slice(0, CUSTOM_DESC_MAX))}
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
    </>
  );
}
