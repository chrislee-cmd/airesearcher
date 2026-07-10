'use client';

import { useTranslations } from 'next-intl';
import { ChipField } from '@/components/ui/chip-field';

// Interview V2 — 프로젝트 카드/모달 안의 태그 chip 편집기.
//
// 칩 컨테이너 + × + 입력은 공유 <ChipField> 프리미티브(SSOT, #524)에 위임한다.
// 이전엔 데스크 키워드 컨테이너를 손수 복제했으나(focus-within frame + amore
// pill + ghost-brand × + ChipInput + draft/commit/backspace), ChipField 가 그
// 스켈레톤을 그대로 담아 4개 소비처를 하나로 합쳤다. bordered 변형 = 기존의
// 진한 border-2 border-ink 프레임 파리티.
//
// 검증은 서버(zod) 가 최종 강제한다. 클라이언트 선제 가드는 ChipField 표준을
// 따른다: trim · 공백 제거 · maxLength(20) slice · maxItems(10) · exact-match
// 중복 제거. (이전의 대소문자 무시 dedup + org 태그 자동완성 드롭다운 +
// pop-in/chip-out 애니메이션은 ChipField 미지원이라 이 마이그레이션에서
// 포기 — PR 본문 참고.)
//
// 이 편집기가 카드(role=button) 안에 놓일 수 있어, 클릭/키 이벤트가 카드로
// 전파돼 프로젝트를 열지 않도록 래퍼에서 stopPropagation 한다.

const MAX_TAGS = 10;
const MAX_LEN = 20;

export function ProjectTagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  // org 태그 유니버스(자동완성 소스). ChipField 에 아직 자동완성 표면이 없어
  // 현재는 미사용 — 소비처(rename-project-modal / project-list)의 prop 체인을
  // 그대로 두어(단일 파일 마이그레이션, parallel_safe) ChipField 가 suggestions
  // API 를 갖추면 재연결한다.
  suggestions?: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('InterviewsV2');

  return (
    <div
      // 카드로 클릭/키 이벤트 전파 차단 (아니면 태그 편집이 프로젝트를 연다).
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <ChipField
        values={tags}
        onChange={onChange}
        variant="bordered"
        maxItems={MAX_TAGS}
        maxLength={MAX_LEN}
        placeholderEmpty={t('tagPlaceholder')}
        chipRemoveLabel={(tag) => t('tagRemove', { tag })}
      />
    </div>
  );
}
