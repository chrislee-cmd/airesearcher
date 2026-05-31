'use client';

import type { LabelHTMLAttributes, ReactNode } from 'react';

// Shared <Label> — codifies the recurring UPPERCASE/tracked field-label
// pattern (text-[11px] uppercase tracking-[0.22em] text-mute-soft).
//
// Used together with <Input>, <Textarea>, <Select>.

type Props = LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
  required?: boolean;
};

export function Label({
  children,
  required = false,
  className,
  ...rest
}: Props) {
  const cls = [
    'block text-[11px] font-medium uppercase tracking-[0.22em] text-mute-soft',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <label className={cls} {...rest}>
      {children}
      {required ? <span className="ml-1 text-warning">*</span> : null}
    </label>
  );
}
