// Create a Google Doc with rich formatting by uploading markdown as HTML
// to Drive with on-the-fly conversion. This preserves headings, bullets,
// bold, links, etc — instead of the plain-text result of inserting raw
// text via the Docs API batchUpdate.

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Apply inline markdown after HTML-escaping the raw text.
// Order matters: bold (**) before italic (*) so we don't double-match.
function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#';
    return `<a href="${safe}">${label}</a>`;
  });
  return s;
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeBuf: string[] = [];

  function closeList() {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');

    if (line.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const m = /^(#{1,6})\s+(.*)$/.exec(line)!;
      const level = m[1].length;
      out.push(`<h${level}>${inlineMarkdown(m[2])}</h${level}>`);
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      closeList();
      out.push('<hr/>');
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const ulMatch = /^[-*]\s+(.*)$/.exec(line);
    const olMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (ulMatch) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }
    if (olMatch) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }

  return `<html><body>${out.join('\n')}</body></html>`;
}

export async function createGoogleDoc(
  accessToken: string,
  title: string,
  markdown: string,
): Promise<{ url: string; documentId: string }> {
  const html = markdownToHtml(markdown || '');

  const boundary = `boundary_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
  };

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${html}\r\n` +
    `--${boundary}--`;

  const url = `${DRIVE_UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`drive_upload_failed: ${res.status} ${msg}`);
  }
  const data = (await res.json()) as { id: string };
  return {
    documentId: data.id,
    url: `https://docs.google.com/document/d/${data.id}/edit`,
  };
}
