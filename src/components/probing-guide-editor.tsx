'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingGuideEditor — 프로젝트별 조사목적 / 핵심가설 / 질문의도 등록 UI.

   PR-3: probing 어시스턴트가 LLM 호출 prompt 에 박는 컨텍스트를 사용자가
   직접 입력. 저장은 PUT /api/projects/[id]/probing-guide → projects.
   interview_template jsonb 안의 PR-3 키들만 selective merge.

   디자인 토큰만 사용 — Textarea / Input / Button / Label primitive 조합.
   가이드 입력 화면이 분리된 페이지가 아니라 프로젝트 detail 페이지 안
   섹션으로 mount 되므로 카드형 컨테이너만 자체 처리.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/toast-provider';
import {
  EMPTY_GUIDE,
  newGuideEntryId,
  type ProbingGuide,
  type ProbingHypothesis,
  type ProbingIntent,
} from '@/lib/probing-guide';

type Props = {
  projectId: string;
};

// 가설 수 / 의도 수의 UI 한도. schema 는 30/40 까지 허용하지만 화면
// 가독성을 위해 추가 버튼이 한도에 닿으면 disable.
const HYPOTHESES_MAX = 30;
const INTENTS_MAX = 40;

export function ProbingGuideEditor({ projectId }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<ProbingGuide>(EMPTY_GUIDE);
  const [saved, setSaved] = useState<ProbingGuide>(EMPTY_GUIDE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 초기 fetch — 서버에서 PR-3 키들만 추출된 ProbingGuide 가 옴.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/probing-guide`);
        if (!alive) return;
        if (res.ok) {
          const json = (await res.json()) as { guide?: ProbingGuide };
          const next = json.guide ?? EMPTY_GUIDE;
          setDraft(next);
          setSaved(next);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const handleSave = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/probing-guide`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save_failed_${res.status}`);
      }
      const json = (await res.json()) as { guide?: ProbingGuide };
      const next = json.guide ?? draft;
      setDraft(next);
      setSaved(next);
      toast.push('가이드 저장됨', { tone: 'info', ttlMs: 1800 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장 실패';
      toast.push(`가이드 저장 실패: ${msg}`, { tone: 'warn' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 border border-line-soft bg-paper-soft p-6 text-md text-mute-soft rounded-sm">
        가이드 불러오는 중…
      </div>
    );
  }

  return (
    <div className="mt-3 border border-line bg-paper p-6 rounded-sm space-y-7">
      {/* 조사목적 */}
      <section>
        <Textarea
          label="조사목적"
          helper="이 인터뷰로 답을 얻고 싶은 핵심 질문 1-3 문장. probing 제안의 최상위 컨텍스트입니다."
          rows={3}
          value={draft.objective}
          onChange={(e) =>
            setDraft((d) => ({ ...d, objective: e.target.value }))
          }
          placeholder="예) 무료 사용자가 결제 직전 단계에서 이탈하는 핵심 원인을 파악한다."
          maxLength={800}
        />
      </section>

      {/* 핵심가설 list */}
      <section>
        <div className="flex items-baseline justify-between">
          <span className="block text-sm font-medium uppercase tracking-[0.22em] text-mute-soft">
            핵심가설
          </span>
          <span className="text-xs-soft text-mute-soft tabular-nums">
            {draft.hypotheses.length} / {HYPOTHESES_MAX}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-mute-soft">
          probing 어시스턴트가 현재 발화와 매칭해 우선 검증/반증 질문을 생성합니다.
        </p>
        <ul className="mt-3 space-y-3">
          {draft.hypotheses.map((h, idx) => (
            <li
              key={h.id}
              className="border border-line-soft bg-paper-soft p-4 rounded-sm"
            >
              <HypothesisRow
                value={h}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    hypotheses: d.hypotheses.map((cur, i) =>
                      i === idx ? next : cur,
                    ),
                  }))
                }
                onRemove={() =>
                  setDraft((d) => ({
                    ...d,
                    hypotheses: d.hypotheses.filter((_, i) => i !== idx),
                  }))
                }
              />
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={draft.hypotheses.length >= HYPOTHESES_MAX}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                hypotheses: [
                  ...d.hypotheses,
                  { id: newGuideEntryId(), label: '', detail: '' },
                ],
              }))
            }
          >
            + 가설 추가
          </Button>
        </div>
      </section>

      {/* 질문의도 list */}
      <section>
        <div className="flex items-baseline justify-between">
          <span className="block text-sm font-medium uppercase tracking-[0.22em] text-mute-soft">
            질문 의도
          </span>
          <span className="text-xs-soft text-mute-soft tabular-nums">
            {draft.question_intents.length} / {INTENTS_MAX}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-mute-soft">
          가이드에 적은 질문 한 줄 + 그 질문으로 확인하려는 의도 한 줄.
        </p>
        <ul className="mt-3 space-y-3">
          {draft.question_intents.map((q, idx) => (
            <li
              key={q.id}
              className="border border-line-soft bg-paper-soft p-4 rounded-sm"
            >
              <IntentRow
                value={q}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    question_intents: d.question_intents.map((cur, i) =>
                      i === idx ? next : cur,
                    ),
                  }))
                }
                onRemove={() =>
                  setDraft((d) => ({
                    ...d,
                    question_intents: d.question_intents.filter(
                      (_, i) => i !== idx,
                    ),
                  }))
                }
              />
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={draft.question_intents.length >= INTENTS_MAX}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                question_intents: [
                  ...d.question_intents,
                  { id: newGuideEntryId(), question: '', intent: '' },
                ],
              }))
            }
          >
            + 질문 의도 추가
          </Button>
        </div>
      </section>

      {/* 저장 */}
      <div className="flex items-center justify-end gap-3 border-t border-line-soft pt-4">
        <span className="text-sm text-mute-soft">
          {dirty ? '저장되지 않은 변경 있음' : '모든 변경이 저장됨'}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          loadingLabel="저장 중…"
        >
          저장
        </Button>
      </div>
    </div>
  );
}

function HypothesisRow({
  value,
  onChange,
  onRemove,
}: {
  value: ProbingHypothesis;
  onChange: (next: ProbingHypothesis) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <Input
        label="라벨"
        size="sm"
        value={value.label}
        onChange={(e) => onChange({ ...value, label: e.target.value })}
        placeholder="예) 가격 진입장벽"
        maxLength={80}
      />
      <Input
        label="설명"
        size="sm"
        value={value.detail}
        onChange={(e) => onChange({ ...value, detail: e.target.value })}
        placeholder="예) 월 $99 가 부담돼서 결제 직전 망설인다."
        maxLength={400}
      />
      <div className="flex justify-end">
        <Button variant="destructive-link" size="sm" onClick={onRemove}>
          삭제
        </Button>
      </div>
    </div>
  );
}

function IntentRow({
  value,
  onChange,
  onRemove,
}: {
  value: ProbingIntent;
  onChange: (next: ProbingIntent) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <Input
        label="질문"
        size="sm"
        value={value.question}
        onChange={(e) => onChange({ ...value, question: e.target.value })}
        placeholder="예) 무료 사용 중 가장 만족스러웠던 순간은 언제였나요?"
        maxLength={280}
      />
      <Input
        label="의도"
        size="sm"
        value={value.intent}
        onChange={(e) => onChange({ ...value, intent: e.target.value })}
        placeholder="예) 결제 동기가 될 만한 가치 인식 지점 파악"
        maxLength={400}
      />
      <div className="flex justify-end">
        <Button variant="destructive-link" size="sm" onClick={onRemove}>
          삭제
        </Button>
      </div>
    </div>
  );
}
