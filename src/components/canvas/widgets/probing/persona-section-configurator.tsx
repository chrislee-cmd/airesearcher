'use client';

/* ────────────────────────────────────────────────────────────────────
   PersonaSectionConfigurator — 컨트롤 패널의 "페르소나 섹션 구성" 블록.

   PR (probing-persona-section-configurator #470): 옛날엔 섹션 구성 (기본 8
   개별 숨김 · custom 추가/삭제) 이 전체보기 좌패널 (reflection-pane) 에
   흩어져 있었다 — 패널 우상단 × / grid 마지막 "위젯 추가" 카드 / 하단 "숨긴
   위젯 복원" 리스트. 이 PR 이 그 구성을 **위젯뷰 컨트롤 패널** 로 옮기고
   데스크 모드 버튼 (ModeButton, #469) 디자인의 multi 토글 카드로 통일한다.

   - 카드 = 기본 9 (DEFAULT_PERSONA_PANELS) + custom 섹션.
   - 켜짐 = 활성 (전체보기 위젯 렌더 + persona 요청 sections + 데이터 적재).
   - 끄기 = 제거. 기본은 숨김 (useHiddenDefaults, restore 로 재활성), custom
     은 영구 삭제 (useCustomSections.remove — 재-add 시 재생성).
   - "+ 섹션 추가" = custom 섹션 (라벨 + 조사 목적) 생성 modal.

   이 활성 목록이 곧 active-section SSOT — 요청·전체보기·적재를 한 소스로
   관통한다 (spec 결정 1·3).
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ModeCardGroup, type ModeOption } from '@/components/ui/mode-button';
import { DEFAULT_PERSONA_SECTIONS } from '@/lib/probing-prompts';
import type { ProbingCustomSection } from '../probing-types';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from './persona-section-meta';

const CUSTOM_TITLE_MAX = 120;
const CUSTOM_DESC_MAX = 1_000;

// 기본 섹션 key → prompt description. 카드 서브텍스트 (line-clamp-2) 로
// "이 위젯이 무엇을 담는지" 를 보여준다. probing-prompts SSOT 에서 파생.
const DEFAULT_DESC_BY_KEY = new Map(
  DEFAULT_PERSONA_SECTIONS.map((d) => [d.key, d.description]),
);

export function PersonaSectionConfigurator({
  customSections,
  hiddenKeys,
  onHideDefault,
  onRestoreDefault,
  onRemoveCustom,
  onAddCustom,
  customFull,
  disabled = false,
}: {
  customSections: ProbingCustomSection[];
  // 숨긴 기본 섹션 key 집합 (useHiddenDefaults). 카드 off 상태로 표시.
  hiddenKeys: Set<string>;
  onHideDefault: (key: string) => void;
  onRestoreDefault: (key: string) => void;
  onRemoveCustom: (key: string) => void;
  onAddCustom: (title: string, description?: string) => void;
  // custom 섹션 상한 (CUSTOM_SECTION_MAX) 도달 → 추가 비활성.
  customFull: boolean;
  // hydration 대기 등으로 구성 비활성 (localStorage 복원 전 깜빡임 방지).
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
    onAddCustom(t, descDraft.trim() || undefined);
    closeAdd();
  }

  // 기본 9 + custom → ModeButton 카드. custom key 는 별도 Set 으로 토글
  // 분기 (기본=숨김/복원, custom=삭제) 에 사용.
  const customKeySet = new Set(customSections.map((c) => c.key));
  const options: ModeOption[] = [
    ...DEFAULT_PERSONA_PANELS.map((p) => ({
      key: p.key,
      label: p.title,
      icon: p.icon,
      description: DEFAULT_DESC_BY_KEY.get(p.key),
    })),
    ...customSections.map((c) => ({
      key: c.key,
      label: c.title,
      icon: CUSTOM_PANEL_ICON,
      description: c.description,
    })),
  ];

  // 활성 (켜짐) key — 숨기지 않은 기본 + 모든 custom.
  const activeKeys: string[] = [
    ...DEFAULT_PERSONA_PANELS.filter((p) => !hiddenKeys.has(p.key)).map(
      (p) => p.key,
    ),
    ...customSections.map((c) => c.key),
  ];

  function handleToggle(key: string) {
    if (disabled) return;
    if (customKeySet.has(key)) {
      // custom off = 정의 영구 삭제 (재-add 시 재생성 — spec 결정 3).
      onRemoveCustom(key);
      return;
    }
    // 기본 섹션 = 숨김 ↔ 복원 (데이터/렌더/요청 모두 제외 ↔ 재활성).
    if (hiddenKeys.has(key)) onRestoreDefault(key);
    else onHideDefault(key);
  }

  return (
    <Field
      label="페르소나 섹션 구성"
      description="켜진 섹션만 전체보기 위젯 · 데이터 적재 대상 (끄면 제외, 기본은 재활성 가능 · 추가 섹션은 재추가 시 재생성)"
    >
      <div className="flex flex-col gap-2">
        <ModeCardGroup
          selection="multi"
          columns={2}
          variant="flat"
          ariaLabel="페르소나 섹션 구성"
          options={options}
          selected={activeKeys}
          onToggle={handleToggle}
        />
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => setAddOpen(true)}
          disabled={disabled || customFull}
        >
          {customFull ? '섹션 한도 도달' : '+ 섹션 추가'}
        </Button>
      </div>

      <Modal
        open={addOpen}
        onClose={closeAdd}
        size="sm"
        labelledBy="probing-persona-section-add-title"
      >
        <div className="flex flex-col gap-4 p-6">
          <h2
            id="probing-persona-section-add-title"
            className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
          >
            페르소나 섹션 추가
          </h2>
          <Field
            label="섹션 이름"
            description="전체보기 위젯 · 구성 카드에 표시될 제목"
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
          <Field label="조사 목적" description="이 섹션에서 알고 싶은 것 (선택)">
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
    </Field>
  );
}
