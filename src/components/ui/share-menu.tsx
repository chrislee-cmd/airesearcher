'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/toast-provider';
import { DropdownMenu, type DropdownItem } from './dropdown-menu';

export type ShareDestination = 'google-docs' | 'google-sheets' | 'notion';

type ShareItemDocsText = {
  destination: 'google-docs';
  getText: () => string | Promise<string>;
  title: string;
};
// Use this when the feature already produces a rich-formatted DOCX/HTML
// blob (e.g. transcripts, desk-research). Drive converts the bytes to a
// Google Doc and preserves formatting near-losslessly.
type ShareItemDocsBlob = {
  destination: 'google-docs';
  getBlob: () => Promise<{ blob: Blob; mimeType: string }>;
  title: string;
};
type ShareItemSheets = {
  destination: 'google-sheets';
  getRows: () => string[][] | Promise<string[][]>;
  title: string;
};
type ShareItemNotion = {
  destination: 'notion';
  getMarkdown: () => string | Promise<string>;
  title: string;
};

export type ShareItem =
  | ShareItemDocsText
  | ShareItemDocsBlob
  | ShareItemSheets
  | ShareItemNotion;

type Props = {
  items: ShareItem[];
  disabled?: boolean;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
};

const DEST_LABEL: Record<ShareDestination, string> = {
  'google-docs': 'Google Docs',
  'google-sheets': 'Google Sheets',
  'notion': 'Notion',
};

// Icon SVGs inlined to avoid external dependency — kept minimal.
function GoogleDocsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="#4285F4" opacity=".8" />
      <path d="M14 2v6h6" fill="#1565C0" opacity=".6" />
      <path d="M8 13h8M8 17h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function GoogleSheetsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="#0F9D58" opacity=".8" />
      <path d="M14 2v6h6" fill="#057642" opacity=".6" />
      <rect x="7" y="12" width="4" height="3" rx=".5" fill="white" opacity=".9" />
      <rect x="13" y="12" width="4" height="3" rx=".5" fill="white" opacity=".9" />
      <rect x="7" y="16" width="4" height="3" rx=".5" fill="white" opacity=".6" />
      <rect x="13" y="16" width="4" height="3" rx=".5" fill="white" opacity=".6" />
    </svg>
  );
}
function NotionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933l3.222-.187z" />
    </svg>
  );
}

const DEST_ICON: Record<ShareDestination, React.ReactNode> = {
  'google-docs': <GoogleDocsIcon />,
  'google-sheets': <GoogleSheetsIcon />,
  'notion': <NotionIcon />,
};

function connectUrl(destination: ShareDestination, currentPath: string): string {
  if (destination === 'notion') {
    return `/api/share/notion/start?next=${encodeURIComponent(currentPath)}`;
  }
  return `/api/share/google/start?next=${encodeURIComponent(currentPath)}`;
}

async function callShareApi(
  item: ShareItem,
): Promise<{ url: string } | { error: string }> {
  if (item.destination === 'google-docs') {
    // Blob path (DOCX/HTML) preserves rich formatting via Drive conversion.
    // Text path falls back to server-side markdown→HTML.
    if ('getBlob' in item) {
      const { blob, mimeType } = await item.getBlob();
      const form = new FormData();
      form.append('title', item.title);
      form.append('mimeType', mimeType);
      form.append('file', blob, 'doc');
      const res = await fetch('/api/share/google/docs', {
        method: 'POST',
        body: form,
      });
      return res.json() as Promise<{ url: string } | { error: string }>;
    }
    const text = await item.getText();
    const res = await fetch('/api/share/google/docs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: item.title, text }),
    });
    return res.json() as Promise<{ url: string } | { error: string }>;
  }
  if (item.destination === 'google-sheets') {
    const rows = await item.getRows();
    const res = await fetch('/api/share/google/sheets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: item.title, rows }),
    });
    return res.json() as Promise<{ url: string } | { error: string }>;
  }
  // notion
  const markdown = await item.getMarkdown();
  const res = await fetch('/api/share/notion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: item.title, markdown }),
  });
  return res.json() as Promise<{ url: string } | { error: string }>;
}

export function ShareMenu({ items, disabled = false, align = 'start', side = 'bottom' }: Props) {
  const toast = useToast();
  const pathname = usePathname();
  const [busy, setBusy] = useState<ShareDestination | null>(null);

  async function handleSelect(item: ShareItem) {
    setBusy(item.destination);
    try {
      const result = await callShareApi(item);
      if ('error' in result) {
        if (result.error === 'not_connected' || result.error === 'missing_docs_scope' || result.error === 'missing_sheets_scope') {
          window.location.assign(connectUrl(item.destination, pathname));
          return;
        }
        toast.push(`공유 실패: ${result.error}`, { tone: 'warn' });
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
      toast.push(`${DEST_LABEL[item.destination]}에 공유됐어요.`, { tone: 'amore' });
    } catch {
      toast.push('공유 중 오류가 발생했어요.', { tone: 'warn' });
    } finally {
      setBusy(null);
    }
  }

  const dropdownItems: DropdownItem[] = items.map((item) => ({
    key: item.destination,
    label: (
      <span className="inline-flex items-center gap-2">
        {DEST_ICON[item.destination]}
        {DEST_LABEL[item.destination]}
      </span>
    ),
    disabled: disabled || busy !== null,
    onSelect: () => handleSelect(item),
  }));

  if (items.length === 1) {
    const only = items[0];
    return (
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => handleSelect(only)}
        className={triggerClass(false)}
      >
        {DEST_ICON[only.destination]}
        <span>{busy ? '공유 중…' : '공유'}</span>
      </button>
    );
  }

  return (
    <DropdownMenu
      align={align}
      side={side}
      minWidth={180}
      items={dropdownItems}
      trigger={({ open, onClick, ...aria }) => (
        <button
          type="button"
          {...aria}
          disabled={disabled || busy !== null}
          onClick={onClick}
          className={triggerClass(open)}
        >
          <span>{busy ? '공유 중…' : '공유'}</span>
          <Caret open={open} />
        </button>
      )}
    />
  );
}

function triggerClass(open: boolean): string {
  return `inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-[120ms] [border-radius:14px] border border-line text-ink-2 hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'border-ink-2' : ''}`;
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={`transition-transform duration-[120ms] ${open ? 'rotate-180' : ''}`}
    >
      <path d="M1 2.5 L4 5.5 L7 2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
