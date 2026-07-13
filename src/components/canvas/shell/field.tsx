/* ────────────────────────────────────────────────────────────────────
   Field — canvas widget 본문의 form field wrapper.

   SSOT: desk-card-body 의 local `Field` 함수를 primitive 로 추출. 라벨
   (SectionLabel) + 자식 영역 + 선택적 description. 모든 위젯의 라벨 +
   입력 묶음이 이 컴포넌트를 거치도록 통일 — `text-xs uppercase
   tracking-[0.22em] text-mute-soft` 인라인 재현 0.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { SectionLabel } from './widget-outputs';

export type FieldProps = {
  // 라벨 텍스트. 시각은 SectionLabel (UPPERCASE + tracking) 로 통일.
  label: string;
  // 라벨 아래/우측 hint. 필요한 경우만.
  description?: ReactNode;
  // 라벨 옆 `*` 표시. form validation 강제는 호출부 책임.
  required?: boolean;
  // 라벨과 묶일 native control 의 id — `htmlFor` 로 연결. label primitive
  // 가 `<div>` 라 `<label>` 의 accessibility 를 잃지 않도록 호출부에서
  // 직접 `<input id={...}>` 매칭. 미지정 시 `<label>` 생략.
  htmlFor?: string;
  children: ReactNode;
};

export function Field({
  label,
  description,
  required,
  htmlFor,
  children,
}: FieldProps) {
  return (
    <div data-ds-primitive="Field">
      <div className="mb-1.5">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="block text-xs uppercase tracking-[0.22em] text-mute-soft"
          >
            {label}
            {required && (
              <span className="ml-1 text-amore" aria-hidden>
                *
              </span>
            )}
          </label>
        ) : (
          <SectionLabel>
            {label}
            {required && (
              <span className="ml-1 text-amore" aria-hidden>
                *
              </span>
            )}
          </SectionLabel>
        )}
      </div>
      {children}
      {description && (
        <div className="mt-1.5 text-xs text-mute-soft">{description}</div>
      )}
    </div>
  );
}
