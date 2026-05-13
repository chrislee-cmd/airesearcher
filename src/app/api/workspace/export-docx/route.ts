import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deskMarkdownToDocx } from '@/lib/desk-docx';

export const maxDuration = 30;

const Body = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(2_000_000),
  kind: z.enum(['md', 'html']),
});

// Map HTML to a markdown-ish string so the existing `deskMarkdownToDocx`
// (headings + bullets + plain paragraphs) can render it. Lossy on inline
// formatting and complex blocks (tables become flat text), but preserves
// document structure for the report-as-Word use case.
function htmlToMarkdownish(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asciiSafe(name: string): string {
  return (
    name.replace(/[/\\]/g, '_').replace(/[^A-Za-z0-9._-]+/g, '_') || 'artifact'
  );
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { title, content, kind } = parsed.data;

  const source = kind === 'html' ? htmlToMarkdownish(content) : content;
  const buf = await deskMarkdownToDocx(source, title);

  const safeTitle = asciiSafe(title).slice(0, 80) || 'artifact';
  const utf8Title = encodeURIComponent(title).slice(0, 200) || 'artifact';

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${safeTitle}.docx"; filename*=UTF-8''${utf8Title}.docx`,
      'content-length': String(buf.length),
    },
  });
}
