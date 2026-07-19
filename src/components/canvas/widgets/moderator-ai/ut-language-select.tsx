'use client';

/* ────────────────────────────────────────────────────────────────────
   UtLanguageSelect — AI UT 세션생성용 예상 참여자 언어 셀렉터.

   전사 정확도의 단일 최대 회귀 = Scribe 를 언어 힌트 없이 호출(auto-detect).
   그래서 리서처가 세션 시작 전에 참여자 언어를 반드시 고르게 강제한다. 빈
   값('')= 미선택 → 시작 버튼 비활성(호출부 가드) + 서버 400 이중 방어.

   ▸ 'multi'(자동 감지)는 의도적으로 제외 — 강제 선택의 취지가 추측 배제라
     auto-detect 를 선택지로 두면 안 된다.
   ▸ 표시명은 quotes 전사 셀렉터와 동일하게 `Languages` 4로케일 라벨 재사용
     (languages.ts 코드 → tLang(code)). 값(value)= languages.ts 내부 코드.

   컨트롤 껍데기는 SelectMenu primitive(원격 폼의 session_kind 셀렉터와 동형).
   색/radius 는 primitive 소유 — 여기선 토큰/레이아웃만.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { SelectMenu } from '@/components/ui/select-menu';
import { LANGUAGES } from '@/lib/transcripts/languages';

// 자동 감지(multi) 제외 — 나머지 전 언어. 렌더 밖 상수라 매 렌더 재생성 없음.
const SELECTABLE = LANGUAGES.filter((l) => l.code !== 'multi');

export function UtLanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('AiUt');
  const tLang = useTranslations('Languages');
  const options = SELECTABLE.map((l) => ({
    value: l.code,
    label: `${l.flag} ${tLang(l.code)}`,
  }));
  return (
    <SelectMenu
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={t('language.placeholder')}
      aria-label={t('language.label')}
      options={options}
    />
  );
}
