'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';

// Client-side wrappers for catalog primitives that need interaction
// (open/close state for Modal, drag/click state for FileDropZone).
// Kept in a separate file so the catalog page itself can remain a
// server component (super-admin gate uses server-only APIs).

export function ModalDemo() {
  const [openSm, setOpenSm] = useState(false);
  const [openMd, setOpenMd] = useState(false);
  const [openLg, setOpenLg] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setOpenSm(true)}>Open size=sm</Button>
      <Button onClick={() => setOpenMd(true)}>Open size=md (default)</Button>
      <Button onClick={() => setOpenLg(true)}>Open size=lg</Button>

      <Modal
        open={openSm}
        onClose={() => setOpenSm(false)}
        size="sm"
        title="Small Modal"
        description="max-w-[420px]. 단순 확인 / 짧은 폼에 적합."
        footer={
          <>
            <Button variant="link" onClick={() => setOpenSm(false)}>
              취소
            </Button>
            <Button onClick={() => setOpenSm(false)}>확인</Button>
          </>
        }
      >
        Esc / backdrop 클릭 / 우측 하단 버튼 — 세 방법 모두 닫힙니다.
      </Modal>

      <Modal
        open={openMd}
        onClose={() => setOpenMd(false)}
        size="md"
        title="Medium Modal"
        description="max-w-[560px]. 가장 흔한 폼 / 설정 모달 크기."
        footer={
          <>
            <Button variant="link" onClick={() => setOpenMd(false)}>
              취소
            </Button>
            <Button onClick={() => setOpenMd(false)}>저장</Button>
          </>
        }
      >
        본문 영역. 줄바꿈은 padding 안에서 자유. 헤더 / 본문 / 푸터 3분할.
      </Modal>

      <Modal
        open={openLg}
        onClose={() => setOpenLg(false)}
        size="lg"
        title="Large Modal"
        description="max-w-[760px]. 표 / 긴 컨텐츠 / 다단 폼에 적합."
        footer={
          <Button onClick={() => setOpenLg(false)} variant="link">
            닫기
          </Button>
        }
      >
        큰 컨텐츠 영역. 워크스페이스 패널 confirm, 결제 모달 등 정보량 많은 케이스.
      </Modal>
    </div>
  );
}

export function FileDropZoneDemo() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div className="space-y-3">
      <FileDropZone
        accept=".csv,.xlsx,.pdf"
        multiple
        maxSizeBytes={10 * 1024 * 1024}
        onFiles={(fs) => setFiles((prev) => [...prev, ...fs])}
        label="파일을 드래그하거나 클릭해서 업로드"
        helperText="CSV / XLSX / PDF · 최대 10MB"
        className="px-6 py-10"
      />
      {files.length > 0 ? (
        <ul className="text-md text-mute">
          {files.map((f, i) => (
            <li key={i}>
              {f.name} — {(f.size / 1024).toFixed(1)} KB
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-mute-soft">
          파일을 드롭하면 여기에 목록이 표시됩니다 (실제 업로드 없음 — 데모용).
        </p>
      )}
    </div>
  );
}

export function DropdownMenuDemo() {
  const [picked, setPicked] = useState<string | null>(null);

  const items: DropdownItem[] = [
    { key: 'rename', label: '이름 변경', onSelect: () => setPicked('rename') },
    { key: 'duplicate', label: '복제', onSelect: () => setPicked('duplicate') },
    { key: 'move', label: '폴더 이동', hint: '⌘M', onSelect: () => setPicked('move') },
    { key: 'archive', label: '아카이브', disabled: true, onSelect: () => setPicked('archive') },
    { key: 'delete', label: '삭제', onSelect: () => setPicked('delete') },
  ];

  const itemsWithLabel: DropdownItem[] = [
    { key: 'docx', label: 'Microsoft Word', hint: '.docx', onSelect: () => setPicked('docx') },
    { key: 'pdf', label: 'PDF', hint: '.pdf', onSelect: () => setPicked('pdf') },
    { key: 'md', label: 'Markdown', hint: '.md', onSelect: () => setPicked('md') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <DropdownMenu
          items={items}
          trigger={({ open, onClick, ...aria }) => (
            <Button {...aria} onClick={onClick} variant="ghost" size="sm">
              align=start {open ? '▴' : '▾'}
            </Button>
          )}
        />
        <DropdownMenu
          align="end"
          items={items}
          trigger={({ open, onClick, ...aria }) => (
            <Button {...aria} onClick={onClick} variant="ghost" size="sm">
              align=end {open ? '▴' : '▾'}
            </Button>
          )}
        />
        <DropdownMenu
          side="top"
          items={items}
          trigger={({ open, onClick, ...aria }) => (
            <Button {...aria} onClick={onClick} variant="ghost" size="sm">
              side=top {open ? '▾' : '▴'}
            </Button>
          )}
        />
        <DropdownMenu
          label="Export as"
          items={itemsWithLabel}
          minWidth={180}
          trigger={({ open, onClick, ...aria }) => (
            <Button {...aria} onClick={onClick} variant="secondary" size="sm">
              with label {open ? '▴' : '▾'}
            </Button>
          )}
        />
      </div>
      {picked ? (
        <p className="text-sm text-mute">
          마지막 선택: <code className="font-mono text-ink-2">{picked}</code>
        </p>
      ) : (
        <p className="text-sm text-mute-soft">
          항목 클릭 또는 키보드 (↓↑ / Enter / Esc) 로 선택. 메뉴 밖 클릭 시 닫힘.
        </p>
      )}
    </div>
  );
}
