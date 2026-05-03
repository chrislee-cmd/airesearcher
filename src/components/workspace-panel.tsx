'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { FeatureKey } from '@/lib/features';
import { useWorkspace } from './workspace-provider';

function formatTime(ms: number, locale: 'ko' | 'en' = 'ko') {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return locale === 'ko' ? '방금' : 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'ko' ? `${min}분 전` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'ko' ? `${hr}시간 전` : `${hr}h ago`;
  const d = new Date(ms);
  return d.toLocaleDateString();
}

export function WorkspacePanel() {
  const t = useTranslations('Workspace');
  const tSidebar = useTranslations('Sidebar');
  const { artifacts, isOpen, setOpen, removeArtifact, sendTo, targetsFor } =
    useWorkspace();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSendSub, setOpenSendSub] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSendSub(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenu]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1500);
    return () => window.clearTimeout(id);
  }, [toast]);

  function flash(msg: string) {
    setToast(msg);
  }

  async function onCopy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      flash(t('copied'));
    } catch {
      flash(t('copyFailed'));
    }
    setOpenMenu(null);
  }

  function onSend(artifactId: string, target: FeatureKey) {
    const path = sendTo(artifactId, target);
    setOpenMenu(null);
    setOpenSendSub(false);
    if (path) {
      // Use the locale-aware router so navigation respects the active locale.
      router.push(path);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('expand')}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 border border-line bg-paper px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:4px]"
      >
        <span className="inline-block h-1 w-5 bg-amore" />
        {t('eyebrow')}
        <span className="tabular-nums text-mute-soft">· {artifacts.length}</span>
      </button>
    );
  }

  const viewedArtifact = viewing ? artifacts.find((a) => a.id === viewing) : null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col border border-line bg-paper [border-radius:4px]">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('eyebrow')}
          </span>
          <span className="text-[11px] tabular-nums text-mute-soft">
            · {artifacts.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setOpenMenu(null);
            setViewing(null);
          }}
          aria-label={t('collapse')}
          className="text-[18px] leading-none text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
        >
          ×
        </button>
      </header>

      <div className="max-h-[60vh] min-h-[180px] overflow-y-auto">
        {artifacts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] text-mute-soft">{t('empty')}</p>
            <p className="mt-2 text-[11px] text-mute-soft">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul>
            {artifacts.map((a) => {
              const targets = targetsFor(a.featureKey);
              const isMenuOpen = openMenu === a.id;
              return (
                <li
                  key={a.id}
                  className="border-b border-line-soft px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore">
                        {tSidebar(a.featureKey)}
                      </div>
                      <div className="mt-1 truncate text-[12.5px] font-semibold text-ink-2">
                        {a.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11.5px] leading-[1.55] text-mute">
                        {a.content.slice(0, 140)}
                        {a.content.length > 140 ? '…' : ''}
                      </div>
                      <div className="mt-1.5 text-[10.5px] tabular-nums text-mute-soft">
                        {formatTime(a.createdAt)}
                      </div>
                    </div>
                    <div className="relative shrink-0" ref={isMenuOpen ? menuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(isMenuOpen ? null : a.id);
                          setOpenSendSub(false);
                        }}
                        aria-label={t('actions')}
                        className="flex h-7 w-7 items-center justify-center text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
                      >
                        <span className="text-[16px] leading-none">⋯</span>
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:4px]">
                          <MenuItem onClick={() => { setViewing(a.id); setOpenMenu(null); }}>
                            {t('view')}
                          </MenuItem>
                          <MenuItem onClick={() => onCopy(a.content)}>
                            {t('copy')}
                          </MenuItem>
                          <div className="relative">
                            <MenuItem
                              disabled={targets.length === 0}
                              onClick={() => setOpenSendSub((v) => !v)}
                              trailing={targets.length > 0 ? '›' : undefined}
                            >
                              {t('sendTo')}
                            </MenuItem>
                            {openSendSub && targets.length > 0 && (
                              <div className="absolute right-full top-0 mr-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:4px]">
                                {targets.map((tgt) => (
                                  <MenuItem
                                    key={tgt}
                                    onClick={() => onSend(a.id, tgt)}
                                  >
                                    {tSidebar(tgt)}
                                  </MenuItem>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="my-1 h-px bg-line-soft" />
                          <MenuItem
                            danger
                            onClick={() => {
                              removeArtifact(a.id);
                              setOpenMenu(null);
                            }}
                          >
                            {t('delete')}
                          </MenuItem>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && (
        <div className="border-t border-line-soft px-4 py-2 text-[11px] text-mute">
          {toast}
        </div>
      )}

      {viewedArtifact && (
        <ViewerOverlay
          title={viewedArtifact.title}
          content={viewedArtifact.content}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  trailing,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[11.5px] transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-warning hover:bg-paper-soft' : 'text-mute hover:bg-paper-soft hover:text-ink-2'
      }`}
    >
      <span>{children}</span>
      {trailing && <span className="text-mute-soft">{trailing}</span>}
    </button>
  );
}

function ViewerOverlay({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[720px] flex-col border border-line bg-paper [border-radius:4px]"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="truncate text-[13px] font-semibold text-ink-2">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            ×
          </button>
        </header>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-5 text-[12.5px] leading-[1.7] text-ink-2">
          {content}
        </pre>
      </div>
    </div>
  );
}
