'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { WidgetFullviewModal } from '@/components/canvas/shell/widget-fullview-modal';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { ControlDropzone } from '@/components/ui/control-dropzone';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { ChipInput } from '@/components/ui/chip-input';
import { ChipField } from '@/components/ui/chip-field';
import { IconButton } from '@/components/ui/icon-button';
import { ModeCardGroup, type ModeOption } from '@/components/ui/mode-button';

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

export function WidgetFullviewModalDemo() {
  const [openWide, setOpenWide] = useState(false);
  const [openWideNoFooter, setOpenWideNoFooter] = useState(false);
  const [openFull, setOpenFull] = useState(false);

  // Placeholder body — real consumers (probing 등) drop their own dense
  // grid here. The grey block just shows the scrollable body slot filling
  // the panel between header and footer.
  const body = (
    <div className="space-y-3 p-6">
      <p className="text-md text-mute">
        본문 slot — 소비 위젯이 자체 grid / 표 / 스트리밍 영역을 여기에 채웁니다.
        header(제목·부제·닫기) 와 footer 사이를 채우며, 길어지면 이 영역만
        스크롤됩니다 (헤더/푸터 고정).
      </p>
      <div className="space-y-2">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="rounded-xs border border-line bg-paper-soft px-4 py-3 text-md text-ink-2"
          >
            본문 row {i + 1}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setOpenWide(true)}>Open wide + footer</Button>
      <Button onClick={() => setOpenWideNoFooter(true)}>Open wide (no footer)</Button>
      <Button onClick={() => setOpenFull(true)}>Open full</Button>

      <WidgetFullviewModal
        open={openWide}
        onClose={() => setOpenWide(false)}
        title="프로빙 전체보기"
        subtitle="size=wide · 90vw × 90vh (기본). 제목 + 부제 + 닫기 chrome."
        footer={
          <>
            <Button variant="link" onClick={() => setOpenWide(false)}>
              취소
            </Button>
            <Button onClick={() => setOpenWide(false)}>적용</Button>
          </>
        }
      >
        {body}
      </WidgetFullviewModal>

      <WidgetFullviewModal
        open={openWideNoFooter}
        onClose={() => setOpenWideNoFooter(false)}
        title="부제 없는 변형"
        size="wide"
      >
        {body}
      </WidgetFullviewModal>

      <WidgetFullviewModal
        open={openFull}
        onClose={() => setOpenFull(false)}
        title="전체화면 변형"
        subtitle="size=full · edge-to-edge. 다단 layout 을 끝까지 owning 하는 표면."
        size="full"
        footer={
          <Button variant="link" onClick={() => setOpenFull(false)}>
            닫기
          </Button>
        }
      >
        {body}
      </WidgetFullviewModal>
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

export function ControlDropzoneDemo() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div className="space-y-3">
      {/* 레이아웃 className prop 이 아예 없다 — 폭(w-full) + py(FILE_DROP_ZONE_PY)
          가 primitive 안에 박제되어 있어 위젯이 치수를 정할 수 없다. */}
      <ControlDropzone
        accept=".csv,.xlsx,.pdf"
        multiple
        maxSizeBytes={10 * 1024 * 1024}
        onFiles={(fs) => setFiles((prev) => [...prev, ...fs])}
        label="파일을 드래그하거나 클릭해서 업로드"
        helperText="CSV / XLSX / PDF · 최대 10MB"
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
          폭·세로 규격이 primitive 에 고정 — 어느 컨트롤 위젯에서 써도 픽셀 동일 (데모용, 실제 업로드 없음).
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

export function SliderDemo() {
  const [value, setValue] = useState(40);
  const [disabledValue] = useState(20);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <Slider
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="flex-1"
          aria-label="Slider example"
        />
        <span className="min-w-[40px] text-right text-md tabular-nums text-ink">
          {value}
        </span>
      </div>
      <div className="flex items-center gap-3 opacity-100">
        <Slider
          min={0}
          max={100}
          step={1}
          value={disabledValue}
          onChange={() => {}}
          disabled
          className="flex-1"
          aria-label="Disabled slider"
        />
        <span className="min-w-[40px] text-right text-md tabular-nums text-mute-soft">
          disabled
        </span>
      </div>
    </div>
  );
}

export function ModeButtonDemo() {
  const singleOptions: ModeOption[] = [
    {
      key: 'trend',
      icon: '🔥',
      label: '트렌드 리서치',
      description: '지금 뜨는 주제·시그널을 빠르게 훑습니다.',
    },
    {
      key: 'market',
      icon: '📊',
      label: '시장조사',
      description: '규모·경쟁·수요를 구조적으로 정리합니다.',
    },
    {
      key: 'custom',
      icon: '🧪',
      label: '커스텀',
      soon: true,
      soonLabel: '곧 제공',
      disabled: true,
    },
  ];
  const multiOptions: ModeOption[] = [
    { key: 'pain', icon: '😣', label: '페인포인트', description: '불편·불만 지점 탐색.' },
    { key: 'motiv', icon: '🎯', label: '동기', description: '구매/사용 동기 파악.' },
    { key: 'habit', icon: '🔁', label: '습관', description: '반복 행동 패턴.' },
  ];
  const [mode, setMode] = useState('trend');
  const [selected, setSelected] = useState<string[]>(['pain', 'habit']);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs uppercase tracking-[0.22em] text-mute-soft">
          selection=&quot;single&quot; (radiogroup) — 데스크 트렌드/시장조사 + soon/disabled
        </div>
        <ModeCardGroup
          ariaLabel="리서치 목적"
          columns={3}
          options={singleOptions}
          value={mode}
          onChange={setMode}
        />
        <p className="mt-2 text-sm text-mute">
          선택: <code className="font-mono text-ink-2">{mode}</code>
        </p>
      </div>

      <div>
        <div className="mb-2 text-xs uppercase tracking-[0.22em] text-mute-soft">
          selection=&quot;multi&quot; (toggle group) — 프로빙 섹션 on/off (#470)
        </div>
        <ModeCardGroup
          selection="multi"
          ariaLabel="프로빙 섹션"
          columns={3}
          options={multiOptions}
          selected={selected}
          onToggle={(key) =>
            setSelected((prev) =>
              prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
            )
          }
        />
        <p className="mt-2 text-sm text-mute">
          켜짐: <code className="font-mono text-ink-2">{selected.join(', ') || '없음'}</code>
        </p>
      </div>
    </div>
  );
}

export function ChipInputDemo() {
  const [chips, setChips] = useState<string[]>(['리서치', '브랜드']);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!chips.includes(v)) setChips((prev) => [...prev, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-2 border-ink bg-paper px-3 py-2 focus-within:border-amore">
      {chips.map((c, idx) => (
        <span
          key={`${c}-${idx}`}
          className="inline-flex items-center gap-1 rounded-pill border border-amore bg-paper px-2.5 py-0.5 text-xs text-amore"
        >
          {c}
          <IconButton
            variant="ghost-brand"
            onClick={() => setChips((prev) => prev.filter((_, i) => i !== idx))}
            aria-label={`remove ${c}`}
          >
            ×
          </IconButton>
        </span>
      ))}
      <ChipInput
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onCommit={commit}
        commitOnComma
        onBlur={commit}
        placeholder={chips.length === 0 ? '키워드 입력 후 Enter' : '추가 키워드…'}
        className="min-w-[140px] flex-1"
      />
    </div>
  );
}

export function ChipFieldDemo() {
  const [bordered, setBordered] = useState<string[]>(['리서치', '브랜드']);
  const [subtle, setSubtle] = useState<string[]>(['tag']);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-sm text-mute">variant=&quot;bordered&quot; (default) · plain × 제거</p>
        <ChipField
          values={bordered}
          onChange={setBordered}
          commitOnComma
          maxItems={8}
          placeholderEmpty="키워드 입력 후 Enter"
          placeholderAdd="추가 키워드…"
          chipRemoveLabel={(v) => `${v} 제거`}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm text-mute">variant=&quot;subtle&quot; (border-line)</p>
        <ChipField
          variant="subtle"
          values={subtle}
          onChange={setSubtle}
          placeholderEmpty="태그 추가"
          placeholderAdd=""
          chipRemoveLabel={(v) => `${v} 제거`}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm text-mute">disabled</p>
        <ChipField
          disabled
          values={['읽기 전용']}
          onChange={() => {}}
          placeholderEmpty="비활성"
          chipRemoveLabel={(v) => `${v} 제거`}
        />
      </div>
    </div>
  );
}
