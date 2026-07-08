'use client';

import {
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { ChipInput } from '@/components/ui/chip-input';
import { IconButton } from '@/components/ui/icon-button';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

// Interview V2 — 프로젝트 카드 안의 태그 chip 편집기.
//
// 데스크 키워드 chip 컨테이너 규격(desk-card-body 주제·키워드 입력)을 그대로
// 재사용한다 — `border-2 border-ink` frame + `focus-within:border-amore` +
// `rounded-pill border-amore` amore chip + `ChipInput`. 앱 전반의 검증된 chip
// 입력 패턴이라 태그도 이걸로 통일한다(별도 신규 디자인 X). 옛 `[+ 태그]` 토글
// 버튼 방식을 폐기하고 입력을 프레임 안에 상시 노출한다.
//
// 카드 전체가 role=button (클릭 시 프로젝트 열림) 이므로, 이 편집기의 클릭/키
// 이벤트는 래퍼에서 stopPropagation 해 카드로 흘려보내지 않는다.
//
// 검증은 서버(zod) 가 최종 강제하지만, 여기서도 동일 규칙으로 선제 차단해
// 헛된 요청/깜빡임을 막는다: trim · 대소문자 무시 중복 제거 · 최대 10개 ·
// 태그당 최대 20자. (이 선제 정규화 덕에 낙관적 업데이트가 서버 결과와 일치.)

const MAX_TAGS = 10;
const MAX_LEN = 20;

const norm = (s: string) => s.trim();
const keyOf = (s: string) => s.trim().toLowerCase();

export function ProjectTagEditor({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  // org 태그 유니버스 (자동완성 소스).
  suggestions: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState('');
  // 자동완성 드롭다운은 입력 포커스 중에만 노출 (상시 열림 방지).
  const [focused, setFocused] = useState(false);
  // 삭제 애니메이션 진행 중인 chip 값들 — collapse 가 끝나야 실제 제거.
  // 값으로 추적(태그는 keyOf 로 대소문자 무시 중복 제거되어 유일).
  const [removing, setRemoving] = useState<string[]>([]);

  const atMax = tags.length >= MAX_TAGS;

  const commit = (raw: string) => {
    const value = norm(raw);
    setDraft('');
    if (!value || value.length > MAX_LEN) return;
    if (tags.length >= MAX_TAGS) return;
    if (tags.some((x) => keyOf(x) === keyOf(value))) return;
    onChange([...tags, value]);
  };

  const commitRemove = (tag: string) => {
    onChange(tags.filter((x) => x !== tag));
  };

  // 삭제 요청 — reduced-motion 은 즉시 제거, 아니면 collapse 애니메이션 후 제거.
  const removeTag = (tag: string) => {
    if (reduced) {
      commitRemove(tag);
      return;
    }
    setRemoving((r) => (r.includes(tag) ? r : [...r, tag]));
  };

  // chip-out 애니메이션 종료 → 실제 배열에서 제거 + removing 목록 정리.
  const onChipExitEnd = (tag: string) => {
    setRemoving((r) => r.filter((x) => x !== tag));
    commitRemove(tag);
  };

  // 아직 안 붙은 태그 중 draft 부분일치. draft 가 비면 인기순 상위 몇 개 노출.
  const matches = useMemo(() => {
    const applied = new Set(tags.map(keyOf));
    const d = keyOf(draft);
    return suggestions
      .filter((s) => !applied.has(keyOf(s)) && (d === '' || keyOf(s).includes(d)))
      .slice(0, 6);
  }, [draft, suggestions, tags]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
      setFocused(false);
    }
  };

  return (
    <div
      // 카드로 클릭/키 이벤트 전파 차단 (아니면 태그 편집이 프로젝트를 연다).
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {/* 데스크 키워드 컨테이너와 동일 프레임 — chip + 입력을 한 박스에 담는다. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-2 border-ink bg-paper px-2.5 py-1.5 focus-within:border-amore">
        {tags.map((tag) => {
          const exiting = removing.includes(tag);
          return (
            <span
              key={tag}
              // 등장 pop-in, 삭제 중이면 chip-out(collapse). 삭제 애니메이션이
              // 끝나면 실제 배열에서 제거한다.
              className={`inline-flex items-center gap-1 rounded-pill border border-amore bg-paper px-2.5 py-0.5 text-xs text-amore ${
                exiting ? 'chip-out' : 'pop-in'
              }`}
              onAnimationEnd={exiting ? () => onChipExitEnd(tag) : undefined}
            >
              {tag}
              <IconButton
                variant="ghost-brand"
                size="compact"
                onClick={() => removeTag(tag)}
                aria-label={t('tagRemove', { tag })}
              >
                <span aria-hidden>×</span>
              </IconButton>
            </span>
          );
        })}

        {!atMax && (
          <ChipInput
            value={draft}
            maxLength={MAX_LEN}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              if (draft.trim()) commit(draft);
              setFocused(false);
            }}
            placeholder={tags.length === 0 ? t('tagPlaceholder') : ''}
            className="min-w-[80px] flex-1 text-xs"
          />
        )}
      </div>

      {focused && matches.length > 0 && (
        <div className="absolute left-0 top-full z-popup mt-1 min-w-[120px] overflow-hidden rounded-xs border border-line bg-paper py-1">
          {matches.map((s) => (
            <div
              key={s}
              role="button"
              tabIndex={0}
              className="cursor-pointer px-3 py-1 text-xs text-ink hover:bg-line-soft"
              // onBlur(input) 가 제안 클릭보다 먼저 튀지 않게 mousedown 에서 처리.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  commit(s);
                }
              }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
