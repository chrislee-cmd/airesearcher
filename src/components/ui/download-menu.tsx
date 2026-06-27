'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  triggerBlobDownload,
  triggerUrlDownload,
} from '@/lib/export/download';
import { FORMAT_META, type ExportFormat } from '@/lib/export/formats';
import { Button } from './button';
import { DropdownMenu, type DropdownItem } from './dropdown-menu';

type ItemUrl = {
  format: ExportFormat;
  kind: 'url';
  href: string;
  filename?: string;
};
type ItemBlob = {
  format: ExportFormat;
  kind: 'blob';
  build: () => Promise<Blob> | Blob;
  filename: string;
};
// Escape hatch for callers that already own a download handler
// (e.g. provider methods like exportXlsx()).
type ItemAction = {
  format: ExportFormat;
  kind: 'action';
  onSelect: () => Promise<void> | void;
  label?: string;
};

export type ExportItem = ItemUrl | ItemBlob | ItemAction;

type Props = {
  items: ExportItem[];
  /** Trigger label, default Common.export.download. */
  label?: string;
  tone?: 'ghost' | 'primary';
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  disabled?: boolean;
  /** Analytics hook. */
  onExport?: (format: ExportFormat) => void;
};

export function DownloadMenu({
  items,
  label,
  tone = 'ghost',
  align = 'start',
  side = 'bottom',
  disabled = false,
  onExport,
}: Props) {
  const t = useTranslations('Common.export');
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function handleSelect(item: ExportItem) {
    onExport?.(item.format);
    if (item.kind === 'url') {
      triggerUrlDownload(item.href, item.filename);
      return;
    }
    if (item.kind === 'blob') {
      try {
        setBusy(item.format);
        const blob = await item.build();
        triggerBlobDownload(blob, item.filename);
      } finally {
        setBusy(null);
      }
      return;
    }
    try {
      setBusy(item.format);
      await item.onSelect();
    } finally {
      setBusy(null);
    }
  }

  const dropdownItems: DropdownItem[] = items.map((item) => {
    const meta = FORMAT_META[item.format];
    const labelText =
      item.kind === 'action' && item.label
        ? item.label
        : (t(meta.labelKey) as string);
    return {
      key: item.format,
      label: labelText,
      hint: `.${meta.ext}`,
      disabled: disabled || busy !== null,
      onSelect: () => handleSelect(item),
    };
  });

  const triggerLabel = label ?? (t('download') as string);
  const variant = tone === 'primary' ? 'primary' : 'ghost';

  // Single-item fallback: render a plain button instead of a dropdown,
  // so trivial cases don't force users through an extra click.
  if (items.length === 1) {
    const only = items[0];
    return (
      <Button
        variant={variant}
        size="sm"
        disabled={disabled || busy !== null}
        onClick={() => handleSelect(only)}
      >
        {triggerLabel}
      </Button>
    );
  }

  return (
    <DropdownMenu
      align={align}
      side={side}
      minWidth={180}
      items={dropdownItems}
      trigger={({ open, onClick, ...aria }) => (
        <Button
          variant={variant}
          size="sm"
          disabled={disabled}
          onClick={onClick}
          rightIcon={<Caret open={open} />}
          {...aria}
        >
          {triggerLabel}
        </Button>
      )}
    />
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={`transition-transform duration-[120ms] ${
        open ? 'rotate-180' : ''
      }`}
    >
      <path d="M1 2.5 L4 5.5 L7 2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
