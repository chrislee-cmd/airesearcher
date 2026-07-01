/* ────────────────────────────────────────────────────────────────────
   WidgetSettingsModal — 위젯 서브헤더 "설정" 버튼이 여는 세부 설정 모달.

   3 위젯 (데스크 / 동시통역 / 프로빙) 이 옛 서브헤더 필드 (캡처방식·언어·
   지역·기간·키워드·용어집·소스 등) 를 이 모달 children 으로 담는다. 공유
   Modal primitive (size=md, Memphis chrome, Esc/backdrop close, focus trap)
   를 그대로 재사용 — 여기서는 3 위젯 공통의 title + "닫기" footer 만 규격화.

   값 변경은 즉시 반영 (staging 없음) — 각 필드의 onChange 가 위젯 state 를
   바로 갱신하고, 모달을 닫는 것 = 확정. footer 의 "닫기" 는 dismiss 이자
   확정 (rollback 없음).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

export type WidgetSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  // 모달 헤더 타이틀. 한국어 default — desk / translate 는 next-intl 값 주입.
  title?: string;
  // footer 닫기 버튼 라벨.
  closeLabel?: string;
  // 각 위젯의 옛 필드 묶음 (Field / select / ChipInput 등).
  children: ReactNode;
};

export function WidgetSettingsModal({
  open,
  onClose,
  title = '설정',
  closeLabel = '닫기',
  children,
}: WidgetSettingsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {closeLabel}
        </Button>
      }
    >
      <div className="space-y-4">{children}</div>
    </Modal>
  );
}
