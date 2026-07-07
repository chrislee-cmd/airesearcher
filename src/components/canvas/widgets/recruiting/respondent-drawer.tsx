'use client';

/* ────────────────────────────────────────────────────────────────────
   RespondentDrawer — 부합도 요약 리스트(judged-list-table)에서 한 행을
   클릭하면 fullview 우측에 slide-in 되는 응답자 상세 패널.

   - 상단  = 응답자 요약 헤더 (익명 라벨 #N + demographics + 부합도 배지
     + fit_reason 전문 + 불성실 flags).
   - 본문  = 전 문항 Q→A 세로 한 장 정리 (질문 원문 + 답변).
   - PII 문항(이름/전화) = 🔒 잠금 배지 + 마스킹된 값. 현재 앱에서 크레딧
     잠금-해제 흐름은 폐기됐고(responses-spreadsheet.tsx 참고) responses
     엔드포인트가 PII 값을 서버에서 `••••` 로 마스킹하므로, drawer 는 문항의
     존재만 보이고 값은 잠금 상태로 유지한다(재과금 없음 = 재과금 방지 정책
     준수). 별도 unlock UI 를 새로 만들지 않는 게 현 아키텍처의 보수적 해석.

   신규 primitive 를 만들지 않는다(스펙 제약): 닫기는 IconButton, 이전/다음
   네비는 Button, 배지/칩은 토큰 클래스만 사용. 패널 자체는 fullview 우측
   영역 위에 absolute 오버레이로 얹는다(모바일/좁은 폭 = 전폭 fallback).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { isPiiColumn } from '@/lib/recruiting-pii';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import type { ResponseJudgment } from '@/lib/recruiting/persona-fit';
import { FitBadge, FLAG_LABEL } from './judged-list-table';

export function RespondentDrawer({
  open,
  label,
  judgment,
  columns,
  row,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  open: boolean;
  // 익명 응답자 라벨 (예: "#3"). 응답 순서 기준 고정 번호.
  label: string;
  judgment: ResponseJudgment | null;
  // 응답 폼의 컬럼(동의 컬럼 제외, responses 라우트가 걸러줌).
  columns: FormColumn[];
  // 이 응답자의 원본 응답 row (PII 값은 서버에서 이미 마스킹). null = 원본을
  // 아직 못 불러왔거나(응답 로딩 중) response_key 매칭 실패.
  row: FormResponseRow | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  // Esc = 닫기, ←/→ = 이전/다음 (Modal primitive 과 동일한 키보드 관습).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPrev, onNext, hasPrev, hasNext]);

  if (!open || !judgment) return null;

  const demographics = [judgment.gender, judgment.age_group, judgment.region]
    .filter((v): v is string => Boolean(v));

  return (
    // fullview 우측 영역 위 오버레이. 좌측 backdrop 클릭 = 닫기 (Modal
    // primitive 과 동일한 div+onClick+aria-hidden 패턴).
    <div className="absolute inset-0 z-overlay flex">
      <div
        className="min-w-0 flex-1 bg-ink/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 우측 slide-in 패널. 모바일/좁은 폭 = 전폭(w-full), 넓은 폭 = 고정 420px. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`응답자 ${label} 상세`}
        className="flex h-full w-full flex-col border-l-[2px] border-ink bg-paper shadow-[-4px_0_0_var(--color-line-soft)] sm:w-[420px]"
      >
        {/* 헤더 = 응답자 요약 */}
        <header className="shrink-0 border-b border-line-soft px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold tabular-nums text-ink-2">
                  응답자 {label}
                </span>
                <FitBadge fit={judgment.fit} />
              </div>
              {demographics.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {demographics.map((d) => (
                    <span
                      key={d}
                      className="rounded-full border border-line-soft bg-paper-soft px-2 py-0.5 text-sm text-mute"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-mute-soft">
                  인구통계 정보 없음
                </p>
              )}
            </div>
            <IconButton
              variant="ghost"
              size="md"
              onClick={onClose}
              aria-label="닫기"
            >
              <CloseIcon />
            </IconButton>
          </div>

          {judgment.fit_reason ? (
            <p className="mt-3 rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-md leading-[1.6] text-ink-2">
              {judgment.fit_reason}
            </p>
          ) : (
            <p className="mt-3 text-sm text-mute-soft">
              참여자 조건이 설정되지 않아 부합도 근거가 없습니다.
            </p>
          )}

          {judgment.flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {judgment.flags.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-warning-line bg-warning-bg px-2 py-0.5 text-xs-soft font-semibold text-ink-2"
                >
                  ⚠ {FLAG_LABEL(f)}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* 본문 = 전 문항 Q→A 세로 한 장 */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {!row ? (
            <p className="py-8 text-center text-md text-mute-soft">
              응답 원본을 불러오는 중이거나 찾을 수 없습니다.
            </p>
          ) : columns.length === 0 ? (
            <p className="py-8 text-center text-md text-mute-soft">
              표시할 문항이 없습니다.
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              {columns.map((col, i) => {
                const pii = isPiiColumn(col.title);
                const answer = row.answers[col.questionId] ?? '';
                return (
                  <li key={col.questionId} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="shrink-0 text-xs-soft font-semibold tabular-nums text-mute-soft">
                        Q{i + 1}
                      </span>
                      <span className="text-sm font-semibold text-ink-2">
                        {col.title}
                        {pii && (
                          <span className="ml-1.5 align-middle text-xs-soft font-normal text-mute-soft">
                            🔒 개인정보
                          </span>
                        )}
                      </span>
                    </div>
                    {pii ? (
                      <p className="rounded-xs border border-dashed border-line-soft bg-paper-soft px-3 py-2 text-md text-mute-soft">
                        개인정보 보호를 위해 값이 가려져 있습니다.
                      </p>
                    ) : answer ? (
                      <p className="whitespace-pre-wrap break-words rounded-xs border border-line-soft bg-paper px-3 py-2 text-md leading-[1.6] text-ink-2">
                        {answer}
                      </p>
                    ) : (
                      <p className="px-3 py-2 text-md text-mute-soft">
                        (응답 없음)
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* 푸터 = 이전 / 다음 응답자 네비 */}
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft bg-paper-soft px-5 py-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasPrev}
            onClick={onPrev}
          >
            ← 이전
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasNext}
            onClick={onNext}
          >
            다음 →
          </Button>
        </footer>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
