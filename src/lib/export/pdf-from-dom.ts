import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// exportDomToPdf — 주어진 DOM 엘리먼트를 캡쳐해 PDF 로 저장한다.
// client-side 전용 (html2canvas 는 브라우저 DOM API 에 의존) — server 부담 0.
//
// 원본을 그대로 캡쳐하지 않고 **화면 밖(off-screen) export 컨테이너** 를 구성해
// 캡쳐한다. 이유:
//   1. 여백/양식 — 원본 grid 는 패널이 컨테이너 끝까지 붙어 "성의없는" 이미지가
//      된다. padding + 문서 헤더(제목/일시) 를 감싸 문서 형태로 승격.
//   2. 텍스트 깨짐 — html2canvas 는 letter-spacing(tracking) + CJK 조합에서
//      받침이 잘리거나 글자가 벌어지는 알려진 버그가 있다. 클론 전체에
//      letter-spacing:normal + truncate 해제를 적용해 한글이 온전히 렌더된다.
//   3. 결정론적 폭 — 뷰포트 폭에 따라 grid 컬럼 수가 흔들리지 않도록 고정 폭 +
//      명시적 grid-template-columns 로 항상 같은 레이아웃을 만든다.
//   4. hideSelector — × 삭제 / "위젯 추가" 같은 인터랙션 전용 affordance 는
//      클론에서 아예 제거 → grid 가 자연 reflow 되어 빈 칸이 남지 않는다.
// 라이브 DOM 은 clone 만 다루므로 전혀 건드리지 않는다.
export async function exportDomToPdf(
  el: HTMLElement,
  filename: string,
  options?: {
    // 캡쳐에서 제거할 요소 CSS 선택자 (기본 '[data-export-hide]').
    hideSelector?: string;
    // 문서 상단 헤더 (한글은 DOM 렌더라 Pretendard 로 온전히 표시).
    header?: { eyebrow?: string; title?: string; subtitle?: string };
    // 캡쳐 컨테이너 내부 폭(px). grid 는 이 폭 안에서 columns 로 배치.
    width?: number;
    // 사방 여백(px).
    padding?: number;
    // 강제 grid 컬럼 수 (clone 루트가 grid 일 때). 뷰포트 무관 결정론적 배치.
    columns?: number;
  },
): Promise<void> {
  const hideSelector = options?.hideSelector ?? '[data-export-hide]';
  const width = options?.width ?? 880;
  const padding = options?.padding ?? 40;
  const columns = options?.columns;
  const header = options?.header;

  // 웹폰트(Pretendard) 가 완전히 로드된 뒤 캡쳐 — 폴백 폰트로 측정되면
  // 글리프 폭이 어긋나 CJK 깨짐이 악화된다.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 폰트 로딩 상태 조회 실패는 무시 — 캡쳐는 진행.
    }
  }

  // ── off-screen 컨테이너 구성 ──────────────────────────────────────
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.zIndex = '-1';
  holder.style.pointerEvents = 'none';
  holder.style.width = `${width + padding * 2}px`;
  holder.style.boxSizing = 'border-box';
  holder.style.padding = `${padding}px`;
  holder.style.background = 'var(--color-paper, #ffffff)';
  holder.style.fontFamily = getComputedStyle(document.body).fontFamily;
  // 클론 전역 — CJK letter-spacing 깨짐 방지.
  holder.style.letterSpacing = 'normal';

  // 문서 헤더 (선택).
  if (header && (header.title || header.eyebrow || header.subtitle)) {
    const head = document.createElement('div');
    head.style.marginBottom = '24px';
    head.style.paddingBottom = '16px';
    head.style.borderBottom = '2px solid var(--canvas-card-border, #1a1a1a)';
    head.style.letterSpacing = 'normal';

    if (header.eyebrow) {
      const eyebrow = document.createElement('div');
      eyebrow.textContent = header.eyebrow;
      eyebrow.style.fontSize = '11px';
      eyebrow.style.fontWeight = '600';
      eyebrow.style.color = 'var(--color-mute-soft, #9ca3af)';
      head.appendChild(eyebrow);
    }
    if (header.title) {
      const title = document.createElement('div');
      title.textContent = header.title;
      title.style.fontSize = '22px';
      title.style.fontWeight = '700';
      title.style.lineHeight = '1.3';
      title.style.marginTop = '4px';
      title.style.color = 'var(--color-ink-2, #1a1a1a)';
      head.appendChild(title);
    }
    if (header.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.textContent = header.subtitle;
      subtitle.style.fontSize = '12px';
      subtitle.style.marginTop = '6px';
      subtitle.style.color = 'var(--color-mute, #6b7280)';
      head.appendChild(subtitle);
    }
    holder.appendChild(head);
  }

  // 타겟 deep-clone → 컨테이너에 삽입.
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = '100%';
  if (typeof columns === 'number') {
    clone.style.display = 'grid';
    clone.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  }
  holder.appendChild(clone);
  document.body.appendChild(holder);

  try {
    // 인터랙션 전용 요소 제거 (grid 자연 reflow).
    holder.querySelectorAll<HTMLElement>(hideSelector).forEach((n) => n.remove());
    // letter-spacing 정상화 + 제목 truncate(overflow clip) 해제 → 한글 온전.
    holder.querySelectorAll<HTMLElement>('*').forEach((n) => {
      n.style.letterSpacing = 'normal';
    });
    holder.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((n) => {
      n.style.whiteSpace = 'normal';
      n.style.overflow = 'visible';
      n.style.textOverflow = 'clip';
    });

    const canvas = await html2canvas(holder, {
      scale: 2, // retina 품질
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      windowWidth: holder.offsetWidth,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(filename);
  } finally {
    document.body.removeChild(holder);
  }
}
