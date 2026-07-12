'use client';

import { FileDropZone, FILE_DROP_ZONE_PY, type FileDropZoneProps } from './file-drop-zone';

// ─── ControlDropzone — 컨트롤 보드 dropzone 규격 SSOT (L2 컨트롤) ─────────────
// 위젯 컨트롤 보드(ControlBoardPanel) 문맥의 업로드 dropzone 치수를 한 곳에서
// 소유한다. ControlBoardPanel 이 wrapper 치수를 소유하듯, 이 primitive 는
// dropzone 치수를 소유한다.
//
// 문제: FileDropZone 이 className 을 열어놔 위젯마다 `w-full py-8`,
// `w-full max-w-md py-8` 등 치수를 제각각 주입 → 전사록(py-12) vs 인터뷰(py-10)
// 업로드 컨테이너 높이가 미세하게 어긋났다. #432·#436 이 값만 맞췄으나 구조가
// override 를 계속 허용해 재발.
//
// 해결 — 값 맞추기가 아니라 구조로 차단: 폭(w-full) + 세로 패딩
// (FILE_DROP_ZONE_PY) 을 primitive 안에 baked-in 하고, 레이아웃 className 을
// 타입에서 제거한다. 같은 컨트롤 문맥을 쓰는 위젯은 구조적으로 픽셀 동일해진다
// — 위젯이 치수를 정할 방법 자체가 없다.
//
// ⚠️  위젯은 데이터/동작/카피(onFiles / accept / label / helperText / disabled /
// onDropRaw 등)만 주입한다. w-*/max-w-*/py-*/mx-* 같은 레이아웃 className 은
// 노출하지 않는다 (아래 Omit<..., 'className'>). 컨트롤 문맥 dropzone 이 필요한
// 위젯은 FileDropZone 을 직접 쓰지 말고 이 primitive 를 쓴다. 모달/애널라이저 등
// 컨트롤-보드가 아닌 문맥은 FileDropZone 을 그대로 쓴다 (치수가 문맥마다 정당하게
// 다름).

// 레이아웃(className)은 primitive 가 소유 — 위젯이 override 못 하도록 타입에서
// 제거. 데이터/동작/카피 prop 만 노출한다.
export type ControlDropzoneProps = Omit<FileDropZoneProps, 'className'>;

export function ControlDropzone(props: ControlDropzoneProps) {
  // 폭 + 세로 패딩을 여기서 박제 — 위젯은 이 값을 바꿀 수 없다. 인스펙터에는
  // 내부 FileDropZone 이 아니라 이 primitive('ControlDropzone')로 노출.
  return (
    <FileDropZone
      {...props}
      className={`w-full ${FILE_DROP_ZONE_PY}`}
      dsPrimitive="ControlDropzone"
    />
  );
}
