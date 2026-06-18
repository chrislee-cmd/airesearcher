'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { Textarea } from '@/components/ui/textarea';
import { buildDeckSpec } from './classifier';
import { composeSlide } from './renderer';
import { SlideCanvas } from './slide-canvas';
import type { DeckSpec } from './types';

// PR1 console — paste a report, hit 생성, scroll through deterministic
// bullet_body slides. No editor, no LLM, no export yet (see SPEC §11).

const SAMPLE_TEXT = `## 시장 진단
> 모바일 광고 시장은 정체기에 진입했습니다.
- iOS 추적 제한으로 타겟 광고 성과 하락
- 광고주는 측정 가능한 채널로 예산을 재배치
- 크리에이티브 자동화 수요가 빠르게 증가

## 핵심 가설
- AI 크리에이티브로 제작 시간 70% 단축
- 브랜드 가이드 학습 후 자율 생성
- 캠페인별 성과 피드백을 다음 변형에 반영

## 제안
- 6개월 파일럿: 톱티어 광고주 3사
- KPI: 제작 리드타임 · 클릭률 · 광고비 효율
- 성공 시 SaaS 모델로 확대`;

export function SlidegenConsole() {
  const [text, setText] = useState('');
  const [deck, setDeck] = useState<DeckSpec | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const composedSlides = useMemo(() => {
    if (!deck) return [];
    return deck.slides.map(composeSlide);
  }, [deck]);

  const activeSlide = composedSlides[activeIdx];
  const slideCount = deck?.slides.length ?? 0;

  function handleGenerate() {
    const input = text.trim().length > 0 ? text : SAMPLE_TEXT;
    setDeck(buildDeckSpec(input));
    setActiveIdx(0);
  }

  function handleLoadSample() {
    setText(SAMPLE_TEXT);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Textarea
          label="보고서 텍스트"
          helper="`---` 또는 `##` 헤딩 단위로 슬라이드를 분할합니다. 둘 다 없으면 전체 1장."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="여기에 보고서를 붙여넣으세요…"
        />
        <div className="flex items-center gap-2">
          <Button onClick={handleGenerate}>덱 생성</Button>
          <Button variant="ghost" onClick={handleLoadSample}>
            샘플 불러오기
          </Button>
          {deck ? (
            <span className="ml-auto text-[11.5px] text-mute-soft tabular-nums">
              {slideCount}장 생성 · 모두 bullet_body 폴백 (PR1)
            </span>
          ) : null}
        </div>
      </section>

      {deck && activeSlide ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
                disabled={activeIdx === 0}
              >
                ← 이전
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setActiveIdx(Math.min(slideCount - 1, activeIdx + 1))
                }
                disabled={activeIdx >= slideCount - 1}
              >
                다음 →
              </Button>
              <span className="text-[12px] text-mute tabular-nums">
                {activeIdx + 1} / {slideCount}
              </span>
            </div>
            <span className="text-[11.5px] text-mute-soft">
              {deck.slides[activeIdx]?.layoutType}
            </span>
          </div>
          <SlideCanvas elements={activeSlide} />
          <ul className="grid grid-cols-2 gap-1 md:grid-cols-4">
            {deck.slides.map((slide, i) => (
              <li key={slide.id}>
                <ChromeButton
                  fullWidth
                  variant={i === activeIdx ? 'primary' : 'mute'}
                  size="sm"
                  onClick={() => setActiveIdx(i)}
                  className="truncate text-left"
                >
                  {i + 1}. {slide.actionTitle}
                </ChromeButton>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-[12.5px] text-mute">
          위에 텍스트를 붙여넣고 <b>덱 생성</b> 을 누르면 슬라이드 미리보기가
          여기에 표시됩니다.
        </p>
      )}
    </div>
  );
}
