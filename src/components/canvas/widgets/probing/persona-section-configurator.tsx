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
import { useTranslations } from 'next-intl';
import { Field } from '@/components/canvas/shell/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  ModeCardGroup,
  ModeActionCard,
  type ModeOption,
} from '@/components/ui/mode-button';
import type { ProbingCustomSection } from '../probing-types';
import {
  DEFAULT_PERSONA_PANELS,
  CUSTOM_PANEL_ICON,
} from './persona-section-meta';

const CUSTOM_TITLE_MAX = 120;
const CUSTOM_DESC_MAX = 1_000;

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
  const t = useTranslations('Probing');
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
    // 서브텍스트 제거 — 6열 작은 정사각형 카드는 아이콘 + 제목만.
    ...DEFAULT_PERSONA_PANELS.map((p) => ({
      key: p.key,
      label: t(`personaSection.${p.key}`),
      icon: p.icon,
    })),
    ...customSections.map((c) => ({
      key: c.key,
      label: c.title,
      icon: CUSTOM_PANEL_ICON,
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
      label={t('configurator.label')}
      description={t('configurator.description')}
    >
      <ModeCardGroup
        selection="multi"
        columns={6}
        variant="flat"
        ariaLabel={t('configurator.label')}
        options={options}
        selected={activeKeys}
        onToggle={handleToggle}
        // "+ 섹션 추가" = 토글이 아닌 액션 카드. 기타 · custom 카드 다음(그리드
        // 마지막 셀) 에 동일한 정사각형으로 붙는다.
        append={
          <ModeActionCard
            variant="flat"
            icon="＋"
            label={customFull ? t('configurator.limitReached') : t('configurator.addSection')}
            onClick={() => setAddOpen(true)}
            disabled={disabled || customFull}
          />
        }
      />

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
            {t('configurator.addModalTitle')}
          </h2>
          <Field
            label={t('configurator.nameLabel')}
            description={t('configurator.nameDesc')}
          >
            <Input
              value={titleDraft}
              onChange={(e) =>
                setTitleDraft(e.target.value.slice(0, CUSTOM_TITLE_MAX))
              }
              maxLength={CUSTOM_TITLE_MAX}
              placeholder={t('configurator.namePlaceholder')}
              size="sm"
            />
          </Field>
          <Field label={t('configurator.goalLabel')} description={t('configurator.goalDesc')}>
            <Textarea
              value={descDraft}
              onChange={(e) =>
                setDescDraft(e.target.value.slice(0, CUSTOM_DESC_MAX))
              }
              rows={3}
              maxLength={CUSTOM_DESC_MAX}
              placeholder={t('configurator.goalPlaceholder')}
              className="resize-none text-md"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeAdd}>
              {t('configurator.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={commitAdd}
              disabled={titleDraft.trim().length === 0}
            >
              {t('configurator.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </Field>
  );
}
