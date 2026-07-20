'use client';

/* ────────────────────────────────────────────────────────────────────
   CaptureUseCaseCards — 캡처 입력 소스를 "인터뷰 방식 + 화자별 음성
   라우팅" 3-카드로 고르는 공유 프리미티브 (enum-agnostic).

   배경: probing / 동시통역 두 위젯이 각각 추상적인 캡처모드 셀렉터
   (mic / tab / both 드롭다운) 를 갖고 있었다. 값 자체는 의미가 명확하지
   않아 ("탭 오디오" 가 무슨 시나리오인지 사용자가 알기 어렵다), 이를
   유스케이스(🤝 오프라인 / 💻 온라인 / 👀 참관) + 진행자·참석자 음성이
   각각 어디로 들어오는지(마이크/탭) 로 재표현한다.

   enum-agnostic: 이 컴포넌트는 위젯의 모드 enum 을 모른다. 옵션 리스트
   (id 문자열 + 라벨) 만 받고 onChange(id) 로 되돌린다. probing 은
   'mic'|'tab'|'both' 로, 동시통역은 'mic-only'|'tab-only'|'both' 로 각자
   매핑한다 (enum 통일은 이 PR 범위 밖).

   접근성: role="radiogroup" + 각 카드 role="radio" aria-checked. 카드는
   native <button> (ui/ 는 react/forbid-elements 예외 — 프리미티브 정의
   지점). disabled 면 전체 그룹 비활성 (세션 중 소스 잠금).

   토큰: 선택 = border-amore + shadow-memphis-md-amore + amore 코너 체크.
   미선택 = border-line + shadow-memphis-sm-faint. rounded-sm / bg-paper.
   하드코딩 hex/px 없음 (design-system 가드 준수).
   ──────────────────────────────────────────────────────────────────── */

export type CaptureUseCaseOption = {
  // 위젯별 모드값 (예: 'mic' | 'both' | 'tab-only'). 이 컴포넌트는 불투명
  // 문자열로만 취급 — 의미 해석은 호출부 매핑 테이블 책임.
  id: string;
  // 유스케이스 이모지 (🤝 / 💻 / 👀). 장식이라 aria-hidden.
  icon: string;
  // 카드 제목 — 유스케이스 이름 (예: "오프라인 인터뷰").
  title: string;
  // 진행자 음성이 어디로 들어오는지 한 줄 (예: "진행자 · 마이크").
  hostVia: string;
  // 참석자 음성이 어디로 들어오는지 한 줄 (예: "참석자 · 탭 오디오").
  guestVia: string;
  // 선택 시 카드 하단에 노출되는 부가 안내 (선택 사항). 오프라인=화자 구분
  // 없음 정직 카피, 온라인=both 비용 경고 등. 미선택 카드엔 노출 안 함.
  note?: string;
};

export function CaptureUseCaseCards({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  options: CaptureUseCaseOption[];
  // 현재 선택된 id. 미선택('')이면 어떤 카드도 활성 표시 안 됨.
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  // 라디오 그룹 전체를 설명하는 라벨 (예: "인터뷰 방식").
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid grid-cols-3 gap-[11px]"
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={[
              // Canvas 1c method 카드 지오메트리(GEOMETRY.md §3): radius 13 ·
              // padding 13x11 · border 2 고정(상태 무관 → 선택 시 폭 변화로 인한
              // 레이아웃 shift 0). 선택 = amore border-2 + soft glow(shadow-select-
              // glow, R6 proposed) — 기존 memphis 하드 오프셋(shadow-memphis-md-
              // amore) 대신 은은한 blur 후광.
              'relative flex flex-col gap-1.5 rounded-[13px] border-2 bg-paper px-[11px] py-[13px] text-left',
              'transition-[border-color,box-shadow] duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-amore shadow-select-glow'
                : 'border-line shadow-memphis-sm-faint',
            ].join(' ')}
          >
            {/* 코너 체크 — 선택된 카드에만. amore 원형 + ✓ */}
            {selected && (
              <span
                aria-hidden
                className="absolute right-2 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-amore text-paper"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 6.5 5 9l4.5-5" />
                </svg>
              </span>
            )}
            <span aria-hidden className="text-xl leading-none">
              {opt.icon}
            </span>
            <span className="text-sm font-medium text-ink">{opt.title}</span>
            <span className="flex flex-col gap-0.5 text-xs text-mute">
              <span>{opt.hostVia}</span>
              <span>{opt.guestVia}</span>
            </span>
            {selected && opt.note && (
              <span className="mt-0.5 text-xs text-mute-soft">{opt.note}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
