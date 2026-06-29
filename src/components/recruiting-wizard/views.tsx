'use client';

import { type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChromeInput } from '@/components/ui/chrome-input';
import { Textarea } from '@/components/ui/textarea';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey, SurveyQuestion } from '@/lib/survey-schema';

type Criterion = RecruitingBrief['criteria'][number];

const QUESTION_KIND_LABEL: Record<SurveyQuestion['kind'], string> = {
  short_answer: '단답',
  long_answer: '장문',
  single_choice: '단일 선택',
  multi_choice: '복수 선택',
  dropdown: '드롭다운',
  scale: '척도',
};

export function CriteriaPreview({
  summary,
  criteria,
}: {
  summary: string;
  criteria: Criterion[];
}) {
  if (criteria.length === 0) {
    return <EmptyState tone="subtle" title="추출된 조건이 없습니다." />;
  }
  return (
    <div className="space-y-4">
      {summary && (
        <Field label="요약">
          <p className="text-md leading-[1.65] text-ink-2">{summary}</p>
        </Field>
      )}
      <Field label={`대상자 조건 (${criteria.length})`}>
        <ul className="border-[2px] border-ink bg-paper shadow-[2px_2px_0_black] rounded-sm overflow-hidden">
          {criteria.map((c, i) => (
            <li key={i} className="px-3 py-2 text-md border-b-[1.5px] border-ink/15 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-xs-soft uppercase tracking-[0.04em] text-mute-soft">
                  {c.category}
                </span>
                <span
                  className={
                    c.required
                      ? 'border border-amore px-1.5 py-px text-xs text-amore [border-radius:3px]'
                      : 'border border-line px-1.5 py-px text-xs text-mute [border-radius:3px]'
                  }
                >
                  {c.required ? '필수' : '우대'}
                </span>
              </div>
              <div className="mt-1 font-semibold text-ink">{c.label}</div>
              <div className="mt-0.5 text-mute">{c.detail}</div>
            </li>
          ))}
        </ul>
      </Field>
    </div>
  );
}

export function CriteriaEditor({
  summary,
  criteria,
  onSummaryChange,
  onCriteriaChange,
}: {
  summary: string;
  criteria: Criterion[];
  onSummaryChange: (s: string) => void;
  onCriteriaChange: (next: Criterion[]) => void;
}) {
  function update<K extends keyof Criterion>(
    idx: number,
    field: K,
    value: Criterion[K],
  ) {
    const next = criteria.map((c, i) =>
      i === idx ? { ...c, [field]: value } : c,
    );
    onCriteriaChange(next);
  }
  function remove(idx: number) {
    onCriteriaChange(criteria.filter((_, i) => i !== idx));
  }
  function add() {
    onCriteriaChange([
      ...criteria,
      { category: '기타', label: '', detail: '', required: false },
    ]);
  }

  return (
    <div className="space-y-4">
      <Field label="요약">
        <Textarea
          value={summary}
          onChange={(e) => onSummaryChange(e.target.value)}
          rows={2}
          className="text-md text-ink-2"
        />
      </Field>
      <Field
        label={`대상자 조건 (${criteria.length})`}
        right={
          <Button variant="link" size="xs" onClick={add} className="text-sm">
            + 항목 추가
          </Button>
        }
      >
        {criteria.length === 0 ? (
          <EmptyState tone="subtle" title="조건이 없습니다." />
        ) : (
          <ul className="border-[2px] border-ink bg-paper shadow-[2px_2px_0_black] rounded-sm overflow-hidden">
            {criteria.map((c, i) => (
              <li key={i} className="space-y-1 px-3 py-2 text-md border-b-[1.5px] border-ink/15 last:border-b-0">
                <div className="flex items-center gap-2">
                  <ChromeInput
                    type="text"
                    value={c.category}
                    onChange={(e) => update(i, 'category', e.target.value)}
                    placeholder="카테고리"
                    className="w-[140px] text-xs-soft uppercase tracking-[0.04em] text-mute-soft"
                  />
                  <label className="flex items-center gap-1 text-xs-soft text-mute">
                    <Checkbox
                      checked={c.required}
                      onChange={(e) => update(i, 'required', e.target.checked)}
                    />
                    필수
                  </label>
                  <Button
                    variant="destructive-link"
                    size="xs"
                    onClick={() => remove(i)}
                    className="ml-auto"
                  >
                    삭제
                  </Button>
                </div>
                <ChromeInput
                  type="text"
                  value={c.label}
                  onChange={(e) => update(i, 'label', e.target.value)}
                  placeholder="라벨"
                  className="w-full font-semibold text-ink"
                />
                <Textarea
                  value={c.detail}
                  onChange={(e) => update(i, 'detail', e.target.value)}
                  placeholder="세부 설명"
                  rows={2}
                  className="resize-none px-2 py-1 text-md leading-[1.5] text-mute rounded-xs"
                />
              </li>
            ))}
          </ul>
        )}
      </Field>
    </div>
  );
}

export function SurveyPreview({ survey }: { survey: Survey }) {
  if (!survey.sections.length) {
    return <EmptyState tone="subtle" title="설문 항목이 없습니다." />;
  }
  return (
    <div className="space-y-5">
      <Field label="제목">
        <div className="text-lg font-semibold text-ink">
          {survey.title || '제목 없음'}
        </div>
        {survey.description && (
          <p className="mt-1 text-md text-mute">{survey.description}</p>
        )}
      </Field>
      <Field label={`섹션 (${survey.sections.length})`}>
        <div className="space-y-4">
          {survey.sections.map((section, si) => (
            <section
              key={si}
              className="border-[2px] border-ink bg-paper shadow-[2px_2px_0_black] p-4 rounded-sm"
            >
              <header className="mb-3 text-md font-semibold text-ink-2">
                {section.title || '제목 없는 섹션'}
              </header>
              <ol className="space-y-3">
                {section.questions.map((q, qi) => (
                  <li key={qi} className="text-md">
                    <div className="flex items-baseline gap-2">
                      <span className="tabular-nums text-mute-soft">{qi + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink">{q.title}</div>
                        {q.description && (
                          <div className="mt-0.5 text-sm text-mute">
                            {q.description}
                          </div>
                        )}
                        <div className="mt-1 text-xs-soft text-mute-soft">
                          {QUESTION_KIND_LABEL[q.kind] ?? q.kind} ·{' '}
                          {q.required ? '필수' : '선택'}
                          {q.kind === 'scale' &&
                            ` · ${q.scaleMin}~${q.scaleMax}`}
                        </div>
                        {q.options.length > 0 && (
                          <ul className="mt-1 ml-3 list-disc text-md text-mute">
                            {q.options.map((opt, oi) => (
                              <li key={oi}>{opt}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function SurveyEditor({
  survey,
  onChange,
}: {
  survey: Survey;
  onChange: (next: Survey) => void;
}) {
  function setTitle(v: string) {
    onChange({ ...survey, title: v });
  }
  function setDescription(v: string) {
    onChange({ ...survey, description: v });
  }
  function updateSection(si: number, patch: Partial<Survey['sections'][number]>) {
    const sections = survey.sections.map((s, i) =>
      i === si ? { ...s, ...patch } : s,
    );
    onChange({ ...survey, sections });
  }
  function updateQuestion(si: number, qi: number, patch: Partial<SurveyQuestion>) {
    const sections = survey.sections.map((s, i) => {
      if (i !== si) return s;
      const questions = s.questions.map((q, j) =>
        j === qi ? { ...q, ...patch } : q,
      );
      return { ...s, questions };
    });
    onChange({ ...survey, sections });
  }
  function removeQuestion(si: number, qi: number) {
    const sections = survey.sections.map((s, i) => {
      if (i !== si) return s;
      return { ...s, questions: s.questions.filter((_, j) => j !== qi) };
    });
    onChange({ ...survey, sections });
  }

  return (
    <div className="space-y-5">
      <Field label="제목">
        <ChromeInput
          type="text"
          value={survey.title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-lg font-semibold text-ink"
        />
      </Field>
      <Field label="안내문">
        <Textarea
          value={survey.description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="text-md text-mute"
        />
      </Field>
      <Field label={`섹션 (${survey.sections.length})`}>
        <div className="space-y-4">
          {survey.sections.map((section, si) => (
            <section
              key={si}
              className="border-[2px] border-ink bg-paper shadow-[2px_2px_0_black] p-4 rounded-sm"
            >
              <ChromeInput
                type="text"
                value={section.title}
                onChange={(e) => updateSection(si, { title: e.target.value })}
                className="mb-3 w-full text-md font-semibold text-ink-2"
              />
              <ol className="space-y-3">
                {section.questions.map((q, qi) => (
                  <li key={qi} className="border-[1.5px] border-ink/30 p-3 text-md rounded-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 tabular-nums text-mute-soft">
                        {qi + 1}.
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <ChromeInput
                          type="text"
                          value={q.title}
                          onChange={(e) =>
                            updateQuestion(si, qi, { title: e.target.value })
                          }
                          placeholder="질문"
                          className="w-full font-semibold text-ink"
                        />
                        <ChromeInput
                          type="text"
                          value={q.description}
                          onChange={(e) =>
                            updateQuestion(si, qi, {
                              description: e.target.value,
                            })
                          }
                          placeholder="보충 설명 (선택)"
                          className="w-full text-sm text-mute"
                        />
                        <div className="flex flex-wrap items-center gap-3 text-xs-soft text-mute">
                          <span className="uppercase tracking-[0.04em] text-mute-soft">
                            {QUESTION_KIND_LABEL[q.kind] ?? q.kind}
                          </span>
                          <label className="flex items-center gap-1">
                            <Checkbox
                              checked={q.required}
                              onChange={(e) =>
                                updateQuestion(si, qi, {
                                  required: e.target.checked,
                                })
                              }
                            />
                            필수
                          </label>
                          <Button
                            variant="destructive-link"
                            size="xs"
                            onClick={() => removeQuestion(si, qi)}
                            className="ml-auto"
                          >
                            삭제
                          </Button>
                        </div>
                        {q.options.length > 0 && (
                          <ul className="ml-3 space-y-1">
                            {q.options.map((opt, oi) => (
                              <li key={oi} className="flex items-center gap-2">
                                <span className="text-mute-soft">·</span>
                                <ChromeInput
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const options = q.options.map((o, k) =>
                                      k === oi ? e.target.value : o,
                                    );
                                    updateQuestion(si, qi, { options });
                                  }}
                                  className="flex-1 text-md text-ink-2"
                                />
                                <Button
                                  variant="destructive-link"
                                  size="xs"
                                  onClick={() => {
                                    const options = q.options.filter(
                                      (_, k) => k !== oi,
                                    );
                                    updateQuestion(si, qi, { options });
                                  }}
                                >
                                  삭제
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </Field>
    </div>
  );
}

function Field({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-[0.04em] text-mute-soft">
          {label}
        </div>
        {right ?? null}
      </div>
      {children}
    </div>
  );
}
