'use client';

import { useEffect, useRef, useState } from 'react';
import { Pressable } from '@/components/artifacts/library/pressable';
import { TONE_BG, avatarTone, initials } from './tone';

// 발급자 필터(§1.1, admin · 조직 전체 스코프 한정) — 아바타 스택 + 라벨 + caret.
// 조건부 렌더: "내 링크" 스코프에서는 아예 없음(모든 행이 내 것이라 정보 0).
// 발급자별 클라 필터(선택 → 해당 발급자 행만). 아바타는 이름 해시 고정 배정.

export type IssuerOption = { name: string; isMine: boolean };

function Avatar({ name, index }: { name: string; index: number }) {
  return (
    <span
      className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.4px] border-ink text-xs font-extrabold text-ink ${TONE_BG[avatarTone(name)]} ${index > 0 ? '-ml-1.5' : ''}`}
    >
      {initials(name)}
    </span>
  );
}

export function ShareIssuerFilter({
  issuers,
  selected,
  onSelect,
  allLabel,
  meLabel,
}: {
  issuers: IssuerOption[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  allLabel: string;
  meLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const stack = issuers.slice(0, 3);
  const selectedIssuer = selected ? issuers.find((i) => i.name === selected) : null;
  const label = selectedIssuer ? selectedIssuer.name : allLabel;

  return (
    <div ref={ref} className="relative shrink-0">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        ariaLabel={allLabel}
        className="inline-flex items-center gap-[7px] rounded-control border-[1.5px] border-ink bg-paper px-[11px] py-1.5 text-md font-bold text-ink shadow-memphis-sm-faint"
      >
        <span className="inline-flex items-center">
          {stack.map((iss, i) => (
            <Avatar key={iss.name} name={iss.name} index={i} />
          ))}
        </span>
        {label}
        <span className="text-xs" aria-hidden>
          ▼
        </span>
      </Pressable>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-fab flex w-max min-w-[180px] max-w-[280px] flex-col overflow-hidden rounded-panel border-2 border-ink bg-paper py-1 shadow-popover">
          <MenuItem
            label={allLabel}
            active={selected === null}
            onPress={() => {
              onSelect(null);
              setOpen(false);
            }}
          />
          {issuers.map((iss) => (
            <MenuItem
              key={iss.name}
              label={iss.name}
              me={iss.isMine ? meLabel : undefined}
              avatar={<Avatar name={iss.name} index={0} />}
              active={selected === iss.name}
              onPress={() => {
                onSelect(iss.name);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  me,
  avatar,
  active,
  onPress,
}: {
  label: string;
  me?: string;
  avatar?: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      ariaLabel={label}
      className={`flex items-center gap-2 px-3 py-2 text-md ${active ? 'bg-paper-soft font-extrabold text-ink' : 'font-medium text-mute'}`}
    >
      {avatar}
      {label}
      {me && (
        <span className="rounded-xs border border-rose bg-rose-bg px-1 font-mono-label text-xs font-extrabold text-amore-deep">
          {me}
        </span>
      )}
    </Pressable>
  );
}
