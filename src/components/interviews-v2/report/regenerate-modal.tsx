'use client';

/* ────────────────────────────────────────────────────────────────────
   RegenerateModal — 재생성 방향 모달 (fresh · BUILD-SPEC §1.4·§1.5 · S4b .dc.html
   비주얼 SSOT). border 3 ink · rounded-modal(18) · shadow-iv-modal-regen(8px8px0
   ink/40) · 헤더 rose + border-b 2 ink · 푸터 paper-soft + border-t 2 ink.

   방향 textarea(카운터 N/600 — TOPLINE_DIRECTION_MAX 공유) + 언어 6종 pill.
   확인 시 generate(true, lang, direction) 호출(로직 재사용, 계약 무변경). 공유
   <Modal bare> 로 메커니즘(Esc·backdrop·scroll-lock·focus)만 빌리고 프레임은
   children 이 소유한다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

// 재생성 방향 입력 최대 길이 — SSOT 는 lib/interview-v2/topline-prompt.ts 의
// TOPLINE_DIRECTION_MAX. 서버 프롬프트 모듈을 client 번들에 끌어오지 않으려 값만
// 미러(반드시 동기 유지). textarea maxLength·counter·route zod .max 가 공유한다.
const TOPLINE_DIRECTION_MAX = 600;

const LANG_OPTIONS = [
  // i18n-allow-korean -- 언어 자기표기(로케일 무관 self-label · topline-view 선례)
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
] as const;

export function RegenerateModal({
  open,
  onClose,
  savedDirection,
  outputLang,
  isUploaded,
  hasInserted,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  // 마지막 방향(미세 조정용 프리필). null = 빈 입력.
  savedDirection: string | null;
  // 초기 언어(저장된 언어).
  outputLang: string;
  // 업로드 보고서 덮어쓰기 경고 노출.
  isUploaded: boolean;
  // 삽입 블록 보존 안내 노출.
  hasInserted: boolean;
  // 방향 + 언어로 재생성 확정.
  onConfirm: (direction: string, lang: string) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [direction, setDirection] = useState('');
  const [lang, setLang] = useState(outputLang);

  // 모달 열릴 때 저장된 방향/언어로 초기화.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 모달 open 마다 서버 저장값으로 입력 seed(외부 소스 = savedDirection/outputLang)
    setDirection(savedDirection ?? '');
    setLang(outputLang);
  }, [open, savedDirection, outputLang]);

  const confirm = () => {
    onConfirm(direction.trim(), lang);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md" bare labelledBy="iv-regen-title">
      <div className="overflow-hidden rounded-modal border-[3px] border-ink bg-paper shadow-iv-modal-regen">
        {/* 헤더 — rose. */}
        <div className="flex items-center gap-[11px] border-b-2 border-ink bg-widget-header-rose px-5 py-3.5">
          <DuotoneIcon name="regenerate" size={19} />
          <div
            id="iv-regen-title"
            className="text-2xl font-extrabold tracking-[-0.4px] text-ink"
            style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          >
            {t('regenTitle')}
          </div>
          {/* eslint-disable-next-line react/forbid-elements -- 모달 닫기 ✕ 는 30px 스퀘어 chrome(rounded-nav·memphis-sm); IconButton 고정 배경과 불일치 */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('regenClose')}
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-nav border-[1.5px] border-ink bg-paper text-md font-bold text-ink shadow-memphis-sm"
          >
            ✕
          </button>
        </div>

        {/* 본문. */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="text-md leading-[1.7] text-mute">
            {t('regenBody')}
          </div>

          {/* 방향 입력. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-label text-xs font-bold uppercase tracking-[0.14em] text-mute-soft">
                {t('regenDirectionLabel')}
              </span>
              <span className="ml-auto font-mono-label text-xs tabular-nums text-faint">
                {direction.length} / {TOPLINE_DIRECTION_MAX}
              </span>
            </div>
            {/* eslint-disable-next-line react/forbid-elements -- CD S4b 방향 입력은 rounded-panel·memphis-sm-faint 인라인 chrome(min-h 100); Textarea primitive 고정 스타일과 불일치 */}
            <textarea
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              rows={3}
              maxLength={TOPLINE_DIRECTION_MAX}
              placeholder={t('regenDirectionPlaceholder')}
              aria-label={t('regenDirectionLabel')}
              className="min-h-[100px] w-full resize-none rounded-panel border-[1.5px] border-ink bg-paper px-3.5 py-3 text-md leading-[1.75] text-ink-2 shadow-memphis-sm-faint outline-none placeholder:text-faint"
            />
            <div className="text-xs leading-[1.6] text-mute-soft">
              {t('regenDirectionHint')}
            </div>
          </div>

          {/* 출력 언어 pill 6종. */}
          <div className="flex flex-col gap-[9px]">
            <span className="font-mono-label text-xs font-bold uppercase tracking-[0.14em] text-mute-soft">
              {t('regenLangLabel')}
            </span>
            <div className="flex flex-wrap gap-[7px]">
              {LANG_OPTIONS.map((o) => (
                // eslint-disable-next-line react/forbid-elements -- CD S4b 언어 pill 은 선택형 rounded-pill chrome(선택 rose·memphis-sm / 비선택 outline); Button variant 와 불일치
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setLang(o.value)}
                  aria-pressed={lang === o.value}
                  className={
                    lang === o.value
                      ? 'inline-flex items-center rounded-pill border-2 border-ink bg-widget-header-rose px-3.5 py-[7px] text-md font-extrabold text-ink shadow-memphis-sm'
                      : 'inline-flex items-center rounded-pill border-[1.5px] border-ink/[0.18] bg-paper px-3.5 py-[7px] text-md font-bold text-mute'
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="text-xs leading-[1.6] text-mute-soft">
              {t('regenLangHint')}
            </div>
          </div>

          {/* 덮어쓰기/보존 안내. */}
          {isUploaded && (
            <div className="rounded-control border-[1.5px] border-warning bg-warning-bg px-3 py-2.5 text-sm leading-[1.6] text-amber-text">
              {t('regenUploadedNote')}
            </div>
          )}
          {hasInserted && (
            <div className="text-sm leading-[1.6] text-mute">
              {t('regenPreserveNote')}
            </div>
          )}
        </div>

        {/* 푸터 — paper-soft. */}
        <div className="flex items-center gap-2.5 border-t-2 border-ink bg-paper-soft px-5 py-3.5">
          <span className="font-mono-label text-xs text-mute-soft">
            {t('regenEta')}
          </span>
          <div className="ml-auto flex items-center gap-2.5">
            {/* eslint-disable-next-line react/forbid-elements -- 취소는 outline rounded-pill chrome; Button variant 와 불일치 */}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-pill border-[1.5px] border-ink/20 px-[18px] py-2.5 text-md font-bold text-mute"
            >
              {t('regenCancel')}
            </button>
            {/* eslint-disable-next-line react/forbid-elements -- 다시 만들기는 solid ink rounded-pill chrome(💎 예외 이모지); Button primary radius 와 불일치 */}
            <button
              type="button"
              onClick={confirm}
              className="inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-md font-extrabold text-paper shadow-memphis-sm-faint"
            >
              {t('regenConfirm')} · 💎10
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
