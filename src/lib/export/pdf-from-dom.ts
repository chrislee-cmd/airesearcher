import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// exportDomToPdf — 주어진 DOM 엘리먼트를 그대로 캡쳐해 PDF 로 저장한다.
// client-side 전용 (html2canvas 는 브라우저 DOM API 에 의존) — server 부담 0.
//
// 캡쳐 대상은 렌더된 layout 그대로. 캔버스 종횡비에 따라 landscape/portrait
// 를 자동 선택하고, 페이지 크기 = 캔버스 픽셀 크기로 잡아 단일 페이지에
// 손실 없이 담는다.
export async function exportDomToPdf(
  el: HTMLElement,
  filename: string,
): Promise<void> {
  const canvas = await html2canvas(el, {
    scale: 2, // retina 품질
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
  });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(filename);
}
