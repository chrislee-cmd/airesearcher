'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingBridge — 탭①(응답) 선택모드 브리지 (CD recruiting-journey N1 바 +
   N4 모달). design-handoff/recruiting-journey/BUILD-SPEC.md §1(브리지 바)·§3
   N1/N4 · `.dc.html` (line 62 바 · 79-86 모달) · WRITER-GAP-AUDIT §0(D1-A)·§3.

   요약(판단테이블)·raw(스프레드시트) 두 뷰가 하나의 선택 집합을 공유하므로,
   선택 state 는 호스트(recruiting-card)가 SSOT 로 쥐고 이 컴포넌트는 순수
   프레젠테이션 + 브리지 POST 만 소유한다(fresh 신규 빌드 — 구 초대 CTA/confirm
   모달은 supersede·통합). 선택 시 이 바/모달이 유일한 CTA — 이중 CTA 금지
   (GAP-AUDIT §0).

   D1-A(어드민 게이트): 선택→보내기 = `recruiting_invitations` 생성(P0 #1195).
   연락처는 서버에서만 처리(응답 PII 는 이미 블랭킹돼 클라에 없음 — 모달은
   마스킹 값 ●●●● 만 표시). 슈퍼어드민 승인(sent) 시 서버가 sched_candidates 로
   자동 인제스트 → 명단 반영.

   대상 그룹: P0 resolve API 는 inbox(미할당) batch 만 노출하고 그룹 목록
   endpoint 는 P0 에 없어, Select 는 📥 미할당(inbox) 기본만 제공한다(보수적 —
   기존 그룹 선택은 ② wave 의 groups-list endpoint 후속). POST 는 target:'inbox'.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import { CONTACT_MASK } from '@/lib/scheduling/candidate-masking';
import type { PersonaFit } from '@/lib/recruiting/persona-fit';

// 선택 응답자 서술자 — 호스트가 판단(judgments)에서 selected 필터로 빌드한다.
// name 은 응답 PII 블랭킹으로 클라에 없어 제외(#번호 + demographic 으로 식별).
export type BridgeCandidate = {
  id: string; // responseId (= judgment.response_key = invitations response_id)
  num: number | null;
  demo: string | null;
  fit: PersonaFit | null;
};

// N4 fit pill — judged-table FIT_STYLE 와 동일 시맨틱(high=success · medium=
// amore-deep · low=mute). 색만 토큰 소유, 라벨은 i18n.
const FIT_PILL: Record<PersonaFit, { labelKey: string; cls: string }> = {
  high: { labelKey: 'fitHigh', cls: 'border-success bg-success/10 text-success' },
  medium: {
    labelKey: 'fitMedium',
    cls: 'border-amore bg-amore/10 text-amore-deep',
  },
  low: { labelKey: 'fitLow', cls: 'border-line bg-paper-soft text-mute-soft' },
};

export function RecruitingBridge({
  selectedCount,
  candidates,
  formId,
  projectId,
  onClear,
  onSent,
}: {
  selectedCount: number;
  candidates: BridgeCandidate[];
  formId: string | null;
  projectId: string | null;
  onClear: () => void;
  // POST 성공 시 — 호스트가 선택 리셋(+명단 카운트 갱신 등)을 수행.
  onSent: () => void;
}) {
  const t = useTranslations('Recruiting.fv');
  const { push: pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // 대상 그룹 — P0 그룹 목록 endpoint 부재로 inbox(미할당) 기본만(보수적).
  const [target, setTarget] = useState<'inbox'>('inbox');

  const send = useCallback(async () => {
    if (!formId || candidates.length === 0) return;
    setSending(true);
    try {
      const res = await fetch('/api/recruiting/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          form_id: formId,
          project_id: projectId,
          response_ids: candidates.map((c) => c.id),
          // target='inbox' → 승인 시 폼 프로젝트의 미할당(inbox) batch 로 인제스트.
          target,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string | null;
          detail?: string | null;
        };
        // Show the real Postgres code + message when the route exposes them so a
        // failing preview is diagnosable at a glance (round-2 feedback #2a) —
        // instead of the opaque "insert_failed".
        const reason = j.code
          ? `${j.error ?? 'error'} (${j.code}${j.detail ? `: ${j.detail}` : ''})`
          : j.error ?? String(res.status);
        pushToast(t('bridgeToastFail', { error: reason }), { tone: 'warn' });
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { count?: number };
      const count = j.count ?? candidates.length;
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'bridge_send',
        metadata: { count },
      });
      pushToast(t('bridgeToastSuccess', { count }), { tone: 'amore' });
      setOpen(false);
      onSent();
    } catch {
      pushToast(t('bridgeToastError'), { tone: 'warn' });
    } finally {
      setSending(false);
    }
  }, [formId, projectId, candidates, target, pushToast, t, onSent]);

  if (selectedCount === 0) return null;

  return (
    <>
      {/* ── 브리지 바 (CD N1 line 62) — mint bg(#e8f7ee, GAP-AUDIT §3) · 2px ink
          bottom · inset success 룰 · ✓ 배지 · 카운트 · 힌트 · success CTA · 해제 */}
      <div className="flex shrink-0 flex-wrap items-center gap-[11px] border-b-2 border-ink bg-bridge-bar-bg px-5 py-[11px] shadow-[inset_0_-3px_0_var(--color-success)]">
        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-xs border-[1.6px] border-ink bg-ink text-xs text-white">
          ✓
        </span>
        <span className="text-sm font-extrabold text-ink">
          {t('bridgeSelectedCount', { count: selectedCount })}
        </span>
        <span className="text-xs-soft text-mute">{t('bridgeHint')}</span>
        <div className="flex-1" />
        {/* success CTA — bg-success·white·2px ink·radius-pill·memphis-sm 전용 chrome */}
        {/* eslint-disable-next-line react/forbid-elements -- CD N1 브리지 CTA 는 bg-success·white·border-2 ink·radius-pill·memphis-sm 전용 chrome 으로 Button primitive 의 variant/radius 와 불일치(§7.11). 셸 헤더 조각과 동일 선례. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-[7px] rounded-pill border-2 border-ink bg-success px-[18px] py-2 text-sm font-extrabold text-white shadow-memphis-sm"
        >
          {t('bridgeSend')}
        </button>
        {/* eslint-disable-next-line react/forbid-elements -- CD N1 해제 는 인라인 텍스트 액션(mute-soft) 으로 Button primitive 형태와 불일치(§7.11). 셸 조각과 동일 선례. */}
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-mute-soft hover:text-ink"
        >
          {t('bridgeClear')}
        </button>
      </div>

      {/* ── N4 브리지 모달 (CD line 79-86). bare 모달 위에 fresh 카드 프레임. */}
      <Modal
        open={open}
        onClose={() => !sending && setOpen(false)}
        size="md"
        bare
        dsPrimitive="Modal"
      >
        <div className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-2xl">
          {/* 헤더 — sun 밴드(§S3 recruiting sun 톤 = shell tokens.ts) · → ·
              Outfit 800 타이틀 · 닫기 ✕ */}
          <header className="flex shrink-0 items-center gap-[10px] border-b-2 border-ink bg-sun px-5 py-[14px]">
            <span aria-hidden className="text-lg leading-none">
              →
            </span>
            <h2
              className="flex-1 text-xl font-extrabold text-ink"
              // 풀뷰 타이틀 = Outfit display (fullview-header 선례; fontFamily 는
              // 토큰 var 라 check:design 무해).
              style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
            >
              {t('bridgeModalTitle')}
            </h2>
            {/* eslint-disable-next-line react/forbid-elements -- 모달 닫기 ✕ 는 셸 닫기 조각과 동일한 28px·radius-close·memphis-sm 스퀘어 chrome 으로 IconButton 고정 radius/variant 와 불일치(§7.11). */}
            <button
              type="button"
              onClick={() => !sending && setOpen(false)}
              aria-label={t('bridgeCancel')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--fv-radius-close)] border-[1.5px] border-ink bg-paper text-sm text-ink shadow-memphis-sm"
            >
              ✕
            </button>
          </header>

          {/* 본문 — 대상그룹 Select · PII 고지 · 선택 리스트 */}
          <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-5">
            {/* 대상 그룹 */}
            <div>
              <div className="mb-1.5 text-xs-soft font-bold text-mute">
                {t('bridgeTargetGroup')}
              </div>
              <Select
                size="sm"
                aria-label={t('bridgeTargetGroup')}
                value={target}
                onChange={(e) => setTarget(e.target.value as 'inbox')}
                options={[{ value: 'inbox', label: t('bridgeInboxOption') }]}
              />
            </div>

            {/* D1-A PII 고지 — warning-bg(#fff1e6) · 2px ink · amber memphis */}
            <div className="flex items-start gap-[9px] rounded-sm border-2 border-ink bg-warning-bg px-3.5 py-3 shadow-memphis-md-amber">
              <span aria-hidden className="text-md leading-none">
                🔒
              </span>
              <p className="text-xs leading-[1.55] text-warning-text">
                <span className="font-bold">{t('bridgePiiNoticeStrong')}</span>{' '}
                {t('bridgePiiNoticeBody')}{' '}
                <span className="text-warning-text-deep">
                  {t('bridgePiiNoticePolicy')}
                </span>
              </p>
            </div>

            {/* 선택 응답자 리스트 (마스킹 연락처 + fit pill) */}
            <div className="overflow-hidden rounded-sm border border-ink/[0.14]">
              {candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-[11px] border-b border-ink/[0.07] px-3.5 py-2.5 last:border-b-0"
                >
                  <span className="font-mono-label text-xs font-extrabold text-ink-2">
                    {c.num != null ? `#${c.num}` : '—'}
                  </span>
                  <span className="text-sm font-bold text-ink">
                    {t('bridgeRespondentLabel')}
                  </span>
                  {c.demo ? (
                    <span className="text-xs text-mute-soft">{c.demo}</span>
                  ) : null}
                  <span className="ml-auto font-mono-label text-xs-soft text-faint">
                    🔒 {CONTACT_MASK}
                  </span>
                  {c.fit ? (
                    <span
                      className={`inline-flex shrink-0 items-center rounded-pill border px-2 py-0.5 text-xs-soft font-bold ${FIT_PILL[c.fit].cls}`}
                    >
                      {t(FIT_PILL[c.fit].labelKey)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* 푸터 — dedup 노트 + 취소 / N명 보내기 */}
          <footer className="flex shrink-0 items-center gap-[10px] border-t-2 border-ink bg-paper-soft px-5 py-3">
            <span className="text-xs text-mute-soft">{t('bridgeDedupNote')}</span>
            <div className="ml-auto flex gap-[9px]">
              {/* eslint-disable-next-line react/forbid-elements -- CD N4 취소 는 radius-pill·1.5px ink·white 전용 chrome 으로 Button primitive radius/variant 와 불일치(§7.11). 모달 푸터 조각. */}
              <button
                type="button"
                disabled={sending}
                onClick={() => setOpen(false)}
                className="rounded-pill border-[1.5px] border-ink bg-paper px-[17px] py-2 text-sm font-bold text-ink disabled:opacity-40"
              >
                {t('bridgeCancel')}
              </button>
              {/* eslint-disable-next-line react/forbid-elements -- CD N4 보내기 는 radius-pill·2px ink·bg-ink·white·memphis-sm 전용 chrome 으로 Button primitive radius/variant 와 불일치(§7.11). 모달 푸터 조각. */}
              <button
                type="button"
                disabled={sending}
                onClick={() => void send()}
                className="rounded-pill border-2 border-ink bg-ink px-5 py-2 text-sm font-extrabold text-white shadow-memphis-sm disabled:opacity-40"
              >
                {sending
                  ? t('bridgeSending')
                  : t('bridgeConfirm', { count: candidates.length })}
              </button>
            </div>
          </footer>
        </div>
      </Modal>
    </>
  );
}
