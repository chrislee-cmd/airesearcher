"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChromeButton } from "@/components/ui/chrome-button";
import { Input } from "@/components/ui/input";

export type WordPressConfig = {
  url: string;
  username: string;
  appPassword: string;
};

export type NotionConfig = {
  integrationToken: string;
  parentPageId: string;
};

export type PdfConfig = Record<string, never>;
export type DocxConfig = Record<string, never>;

export type DeployChannel =
  | { id: string; kind: "wordpress"; name: string; config: WordPressConfig }
  | { id: string; kind: "notion"; name: string; config: NotionConfig }
  | { id: string; kind: "pdf"; name: string; config: PdfConfig }
  | { id: string; kind: "docx"; name: string; config: DocxConfig };

export type DeployChannelKind = DeployChannel["kind"];

export const CHANNEL_KIND_META: Record<
  DeployChannelKind,
  { icon: string; label: string }
> = {
  wordpress: { icon: "🌐", label: "사이트, 자동 배포" },
  notion: { icon: "📒", label: "Notion 연동" },
  pdf: { icon: "📄", label: "PDF 추출" },
  docx: { icon: "📝", label: "DOCX 추출" },
};

export type DeployJob = {
  id: string;
  resultId: string;
  channelId: string;
  channelName: string;
  channelKind: DeployChannelKind;
  status: "queued" | "publishing" | "published" | "failed";
  publishedUrl?: string;
  error?: string;
  createdAt: number;
};

export type DeployInspectorResult = {
  id: string;
  customizeName: string;
  theme: string;
  prompt: string;
  output: string;
};

type EditorKind = "wordpress" | "notion";

type Props = {
  result: DeployInspectorResult | null;
  channels: DeployChannel[];
  onAddChannel: (channel: Omit<DeployChannel, "id">) => void;
  onUpdateChannel: (id: string, payload: Omit<DeployChannel, "id">) => void;
  onRemoveChannel: (id: string) => void;
  onQuickExport: (kind: "pdf" | "docx") => void;
  onPublishChannel: (channelId: string, status: "draft" | "publish") => void;
  publishingChannelIds: Set<string>;
  quickExporting: Set<"pdf" | "docx">;
  jobs: DeployJob[];
  onCloseSelection: () => void;
};

export default function DeployInspector({
  result,
  channels,
  onAddChannel,
  onUpdateChannel,
  onRemoveChannel,
  onQuickExport,
  onPublishChannel,
  publishingChannelIds,
  quickExporting,
  jobs,
  onCloseSelection,
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorKind, setEditorKind] = useState<EditorKind>("wordpress");

  const wpChannel = channels.find((c) => c.kind === "wordpress");
  const notionChannel = channels.find((c) => c.kind === "notion");

  function openNewEditor(kind: EditorKind) {
    setEditingId(null);
    setEditorKind(kind);
    setEditorOpen(true);
  }
  function openEditEditor(id: string) {
    const ch = channels.find((c) => c.id === id);
    if (!ch || (ch.kind !== "wordpress" && ch.kind !== "notion")) return;
    setEditingId(id);
    setEditorKind(ch.kind);
    setEditorOpen(true);
  }
  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
  }

  if (!result) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-mute">
          배포
        </div>
        <div className="rounded-xs border border-dashed border-line px-3 py-4 text-xs text-mute ">
          위젯의 컨텐츠 chip을 클릭하면 4가지 배포·추출 액션이 열립니다. 사이트·Notion
          연결은 한 번 등록하면 다른 컨텐츠에서도 재사용됩니다.
        </div>
        <QuickActionGrid
          disabled
          pdfBusy={false}
          docxBusy={false}
          wpChannel={wpChannel}
          notionChannel={notionChannel}
          publishingChannelIds={publishingChannelIds}
          onQuickExport={() => {}}
          onPublishChannel={() => {}}
          onConnect={() => {}}
          onEdit={() => {}}
          onRemove={() => {}}
        />
      </div>
    );
  }

  const wordCount = result.output.replace(/\s+/g, " ").trim().split(" ").length;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 ">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-xs bg-paper-soft px-1.5 py-0.5 font-medium text-ink-2 ">
            🎨 {result.customizeName}
          </span>
          <span className="text-mute">{wordCount}단어</span>
        </div>
        <ChromeButton onClick={onCloseSelection} size="xs" variant="mute">
          닫기
        </ChromeButton>
      </div>

      <div className="space-y-3 border-b border-line px-4 py-3 ">
        <div>
          <div className="text-xs uppercase tracking-wider text-mute">
            {result.theme}
          </div>
          <div className="text-sm font-medium">{result.prompt}</div>
        </div>

        <QuickActionGrid
          pdfBusy={quickExporting.has("pdf")}
          docxBusy={quickExporting.has("docx")}
          wpChannel={wpChannel}
          notionChannel={notionChannel}
          publishingChannelIds={publishingChannelIds}
          onQuickExport={onQuickExport}
          onPublishChannel={onPublishChannel}
          onConnect={openNewEditor}
          onEdit={openEditEditor}
          onRemove={onRemoveChannel}
        />

        <div className="text-xs text-mute">
          제목은 컨텐츠 첫 줄(또는 프롬프트)을 사용합니다. 본문은 Markdown
          그대로 전송됩니다.
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        <div className="text-sm font-semibold uppercase tracking-wider text-mute">
          최근 게시 ({jobs.length})
        </div>
        {jobs.length === 0 ? (
          <div className="rounded-xs border border-dashed border-line px-3 py-3 text-xs text-mute ">
            아직 게시 기록이 없습니다.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {jobs
              .slice()
              .reverse()
              .map((j) => (
                <li
                  key={j.id}
                  className="rounded-xs border border-line px-2.5 py-1.5 text-sm "
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      <span className="mr-1">
                        {CHANNEL_KIND_META[j.channelKind].icon}
                      </span>
                      {j.channelName}
                    </span>
                    <JobStatusBadge status={j.status} />
                  </div>
                  {j.publishedUrl && (
                    <a
                      href={j.publishedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-amore hover:underline"
                    >
                      {j.publishedUrl}
                    </a>
                  )}
                  {j.error && (
                    <div className="text-xs text-warning">{j.error}</div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      {editorOpen && (
        <ChannelEditor
          channels={channels}
          channelId={editingId}
          lockedKind={editorKind}
          onSave={(payload) => {
            if (editingId) {
              onUpdateChannel(editingId, payload);
            } else {
              onAddChannel(payload);
            }
            closeEditor();
          }}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
}

function QuickActionGrid({
  pdfBusy,
  docxBusy,
  wpChannel,
  notionChannel,
  publishingChannelIds,
  onQuickExport,
  onPublishChannel,
  onConnect,
  onEdit,
  onRemove,
  disabled,
}: {
  pdfBusy: boolean;
  docxBusy: boolean;
  wpChannel: DeployChannel | undefined;
  notionChannel: DeployChannel | undefined;
  publishingChannelIds: Set<string>;
  onQuickExport: (kind: "pdf" | "docx") => void;
  onPublishChannel: (channelId: string, status: "draft" | "publish") => void;
  onConnect: (kind: EditorKind) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ExtractTile
        icon="📄"
        title="PDF 추출"
        description="브라우저 프린트로 PDF 저장"
        busy={pdfBusy}
        disabled={disabled}
        onExtract={() => onQuickExport("pdf")}
      />
      <ExtractTile
        icon="📝"
        title="DOCX 추출"
        description=".docx 파일로 다운로드"
        busy={docxBusy}
        disabled={disabled}
        onExtract={() => onQuickExport("docx")}
      />
      <ChannelTile
        icon="🌐"
        title="사이트 자동 배포"
        connectLabel="WordPress 연결"
        kind="wordpress"
        channel={wpChannel}
        publishingChannelIds={publishingChannelIds}
        onConnect={onConnect}
        onEdit={onEdit}
        onRemove={onRemove}
        onPublish={onPublishChannel}
        disabled={disabled}
      />
      <ChannelTile
        icon="📒"
        title="Notion 연동"
        connectLabel="Notion 연결"
        kind="notion"
        channel={notionChannel}
        publishingChannelIds={publishingChannelIds}
        onConnect={onConnect}
        onEdit={onEdit}
        onRemove={onRemove}
        onPublish={onPublishChannel}
        disabled={disabled}
      />
    </div>
  );
}

function ExtractTile({
  icon,
  title,
  description,
  busy,
  disabled,
  onExtract,
}: {
  icon: string;
  title: string;
  description: string;
  busy: boolean;
  disabled?: boolean;
  onExtract: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xs border border-line bg-paper p-2.5 ">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{title}</div>
          <div className="truncate text-xs text-mute">{description}</div>
        </div>
      </div>
      <Button
        onClick={onExtract}
        disabled={disabled || busy}
        size="xs"
        variant="primary"
        fullWidth
      >
        {busy ? "추출 중…" : "추출"}
      </Button>
    </div>
  );
}

function ChannelTile({
  icon,
  title,
  connectLabel,
  kind,
  channel,
  publishingChannelIds,
  onConnect,
  onEdit,
  onRemove,
  onPublish,
  disabled,
}: {
  icon: string;
  title: string;
  connectLabel: string;
  kind: EditorKind;
  channel: DeployChannel | undefined;
  publishingChannelIds: Set<string>;
  onConnect: (kind: EditorKind) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onPublish: (channelId: string, status: "draft" | "publish") => void;
  disabled?: boolean;
}) {
  const connected = !!channel;
  const publishing = channel ? publishingChannelIds.has(channel.id) : false;
  const summary = channel ? channelSummary(channel) : null;

  return (
    <div className="flex flex-col gap-2 rounded-xs border border-line bg-paper p-2.5 ">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{title}</div>
          {connected && channel ? (
            <div className="truncate text-xs text-mute">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" />
              {channel.name}
            </div>
          ) : (
            <div className="text-xs text-mute">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-paper-soft align-middle" />
              미연결
            </div>
          )}
        </div>
      </div>
      {connected && channel ? (
        <>
          <Button
            onClick={() => onPublish(channel.id, "publish")}
            disabled={disabled || publishing}
            size="xs"
            variant="primary"
            fullWidth
          >
            {publishing ? "게시 중…" : "▲ 게시"}
          </Button>
          <div className="flex gap-1">
            <Button
              onClick={() => onPublish(channel.id, "draft")}
              disabled={disabled || publishing}
              size="xs"
              variant="ghost"
              className="flex-1"
            >
              초안
            </Button>
            <Button
              onClick={() => onEdit(channel.id)}
              disabled={disabled}
              size="xs"
              variant="ghost"
              className="flex-1"
            >
              편집
            </Button>
            <Button
              onClick={() => {
                if (
                  confirm(
                    `"${channel.name}" 연결을 해제할까요? (등록된 게시 기록은 유지)`,
                  )
                )
                  onRemove(channel.id);
              }}
              disabled={disabled}
              size="xs"
              variant="destructive"
              aria-label="연결 해제"
            >
              ✕
            </Button>
          </div>
          {summary && (
            <div className="truncate text-xs text-mute-soft">{summary}</div>
          )}
        </>
      ) : (
        <Button
          onClick={() => onConnect(kind)}
          disabled={disabled}
          size="xs"
          variant="ghost"
          fullWidth
        >
          {connectLabel}
        </Button>
      )}
    </div>
  );
}

function channelSummary(c: DeployChannel): string {
  if (c.kind === "wordpress") return `WordPress · ${c.config.url}`;
  if (c.kind === "notion")
    return `Notion · 부모 ${c.config.parentPageId.slice(0, 8)}…`;
  if (c.kind === "pdf") return "PDF · 브라우저 프린트";
  return "DOCX · 클라이언트 다운로드";
}

function JobStatusBadge({ status }: { status: DeployJob["status"] }) {
  if (status === "publishing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amore-bg px-1.5 py-0.5 text-xs font-medium text-amore ">
        <span className="h-1 w-1 animate-pulse rounded-full bg-amore" />
        전송 중
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning ">
        실패
      </span>
    );
  }
  if (status === "published") {
    return (
      <span className="rounded-full bg-mint px-1.5 py-0.5 text-xs font-medium text-success ">
        게시됨
      </span>
    );
  }
  return (
    <span className="rounded-full bg-paper-soft px-1.5 py-0.5 text-xs text-mute ">
      대기
    </span>
  );
}

function ChannelEditor({
  channels,
  channelId,
  lockedKind,
  onSave,
  onCancel,
}: {
  channels: DeployChannel[];
  channelId: string | null;
  lockedKind: EditorKind;
  onSave: (payload: Omit<DeployChannel, "id">) => void;
  onCancel: () => void;
}) {
  const editing = channelId
    ? channels.find((c) => c.id === channelId)
    : undefined;
  const kind: EditorKind =
    editing && (editing.kind === "wordpress" || editing.kind === "notion")
      ? editing.kind
      : lockedKind;
  const [name, setName] = useState(editing?.name ?? "");
  const [url, setUrl] = useState(
    editing?.kind === "wordpress" ? editing.config.url : "",
  );
  const [username, setUsername] = useState(
    editing?.kind === "wordpress" ? editing.config.username : "",
  );
  const [appPassword, setAppPassword] = useState(
    editing?.kind === "wordpress" ? editing.config.appPassword : "",
  );
  const [integrationToken, setIntegrationToken] = useState(
    editing?.kind === "notion" ? editing.config.integrationToken : "",
  );
  const [parentPageId, setParentPageId] = useState(
    editing?.kind === "notion" ? editing.config.parentPageId : "",
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("연결 이름을 입력하세요.");
      return;
    }
    if (kind === "wordpress") {
      if (!url.trim() || !username.trim() || !appPassword.trim()) {
        setError("WordPress 연결의 모든 필드를 입력하세요.");
        return;
      }
      try {
        new URL(url.trim());
      } catch {
        setError("유효한 URL이 아닙니다.");
        return;
      }
      onSave({
        kind: "wordpress",
        name: name.trim(),
        config: {
          url: url.trim().replace(/\/$/, ""),
          username: username.trim(),
          appPassword: appPassword.trim(),
        },
      });
      return;
    }
    if (!integrationToken.trim() || !parentPageId.trim()) {
      setError("Integration token과 부모 페이지 ID를 모두 입력하세요.");
      return;
    }
    onSave({
      kind: "notion",
      name: name.trim(),
      config: {
        integrationToken: integrationToken.trim(),
        parentPageId: parentPageId.trim(),
      },
    });
  }

  const titleIcon = CHANNEL_KIND_META[kind].icon;
  const titleLabel = CHANNEL_KIND_META[kind].label;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-ink/40 p-4 "
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-sm border border-line bg-paper p-4 shadow-bento "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editing
              ? `${titleIcon} ${titleLabel} 편집`
              : `${titleIcon} ${titleLabel} 연결`}
          </h3>
          <ChromeButton onClick={onCancel} size="xs" variant="mute">
            ✕
          </ChromeButton>
        </div>
        <div className="space-y-2">
          <Field label="연결 이름">
            <Input
              type="text"
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "wordpress"
                  ? "예) Enkostay 블로그"
                  : "예) Notion 워크스페이스"
              }
            />
          </Field>

          {kind === "wordpress" && (
            <>
              <Field label="WordPress URL">
                <Input
                  type="url"
                  size="sm"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </Field>
              <Field label="WP 사용자명">
                <Input
                  type="text"
                  size="sm"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </Field>
              <Field
                label="Application Password"
                help={
                  <>
                    WP 대시보드 → Users → 본인 프로필 →{" "}
                    <em>Application Passwords</em>에서 발급. 비밀번호와
                    다릅니다.
                  </>
                }
              >
                <Input
                  type="password"
                  size="sm"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                />
              </Field>
            </>
          )}

          {kind === "notion" && (
            <>
              <Field
                label="Integration Token"
                help={
                  <>
                    <a
                      href="https://www.notion.so/my-integrations"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      notion.so/my-integrations
                    </a>
                    에서 Internal Integration 생성 후 secret 복사 (
                    <code>secret_…</code>로 시작).
                  </>
                }
              >
                <Input
                  type="password"
                  size="sm"
                  value={integrationToken}
                  onChange={(e) => setIntegrationToken(e.target.value)}
                  placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </Field>
              <Field
                label="부모 페이지 ID"
                help={
                  <>
                    페이지 URL의 마지막 32자(또는 하이픈 포함 36자).{" "}
                    <strong>중요</strong>: 해당 페이지에서 인테그레이션을 추가해야
                    합니다 (페이지 우상단 ⋯ → Connections → 본인 integration
                    선택).
                  </>
                }
              >
                <Input
                  type="text"
                  size="sm"
                  value={parentPageId}
                  onChange={(e) => setParentPageId(e.target.value)}
                  placeholder="abcdef0123456789abcdef0123456789"
                />
              </Field>
            </>
          )}
        </div>
        {error && <div className="text-xs text-warning">{error}</div>}
        <div className="rounded-xs border border-warning-line bg-warning-bg px-3 py-2 text-xs text-warning ">
          ⚠️ 자격증명은 브라우저 localStorage에 저장됩니다. 공용 PC에서는 사용하지
          마세요.
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel} size="xs" variant="ghost">
            취소
          </Button>
          <Button onClick={submit} size="xs" variant="primary">
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wider text-mute">
        {label}
      </div>
      {children}
      {help && <div className="text-xs text-mute">{help}</div>}
    </label>
  );
}
