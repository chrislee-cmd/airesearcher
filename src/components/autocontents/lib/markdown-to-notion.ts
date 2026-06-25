// Minimal markdown → Notion blocks converter.
// Covers: H1-H3, paragraphs, bulleted/numbered lists, quotes, code, images.
// Inline: bold (**), italic (*/_), inline code (`).

type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    color?: string;
  };
};

type NotionBlock = {
  object: "block";
  type: string;
  [key: string]: unknown;
};

const NOTION_TEXT_LIMIT = 2000;

function splitForLimit(s: string): string[] {
  if (s.length <= NOTION_TEXT_LIMIT) return [s];
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    parts.push(s.slice(i, i + NOTION_TEXT_LIMIT));
    i += NOTION_TEXT_LIMIT;
  }
  return parts;
}

function richText(raw: string): RichText[] {
  if (!raw) return [{ type: "text", text: { content: "" } }];
  // Tokenize for **bold**, *italic* / _italic_, `code`
  const out: RichText[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushPlain = (text: string) => {
    if (!text) return;
    for (const part of splitForLimit(text)) {
      out.push({ type: "text", text: { content: part } });
    }
  };
  while ((m = pattern.exec(raw)) !== null) {
    if (m.index > last) pushPlain(raw.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push({
        type: "text",
        text: { content: tok.slice(2, -2) },
        annotations: { bold: true },
      });
    } else if (tok.startsWith("`")) {
      out.push({
        type: "text",
        text: { content: tok.slice(1, -1) },
        annotations: { code: true },
      });
    } else {
      // single * or _ → italic
      out.push({
        type: "text",
        text: { content: tok.slice(1, -1) },
        annotations: { italic: true },
      });
    }
    last = m.index + tok.length;
  }
  if (last < raw.length) pushPlain(raw.slice(last));
  return out.length > 0 ? out : [{ type: "text", text: { content: raw } }];
}

function block(type: string, payload: Record<string, unknown>): NotionBlock {
  return { object: "block", type, [type]: payload };
}

export function mdToNotionBlocks(md: string): NotionBlock[] {
  const lines = md.split(/\r?\n/);
  const out: NotionBlock[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join(" ");
    out.push(
      block("paragraph", { rich_text: richText(text) }),
    );
    paraBuf = [];
  };

  for (const raw of lines) {
    const line = raw ?? "";

    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push(
          block("code", {
            rich_text: [
              {
                type: "text",
                text: { content: codeBuf.join("\n").slice(0, NOTION_TEXT_LIMIT) },
              },
            ],
            language: codeLang || "plain text",
          }),
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      } else {
        flushPara();
        inCode = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      continue;
    }

    let m: RegExpMatchArray | null;
    // Image: alone on a line ![alt](url)
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
      flushPara();
      const url = m[2].trim();
      out.push(
        block("image", {
          type: "external",
          external: { url },
        }),
      );
      continue;
    }
    // Headings
    if ((m = line.match(/^###\s+(.+)$/))) {
      flushPara();
      out.push(block("heading_3", { rich_text: richText(m[1]) }));
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      flushPara();
      out.push(block("heading_2", { rich_text: richText(m[1]) }));
      continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) {
      flushPara();
      out.push(block("heading_1", { rich_text: richText(m[1]) }));
      continue;
    }
    // Quote
    if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      out.push(block("quote", { rich_text: richText(m[1] ?? "") }));
      continue;
    }
    // Numbered list
    if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      flushPara();
      out.push(
        block("numbered_list_item", { rich_text: richText(m[1]) }),
      );
      continue;
    }
    // Bulleted list
    if ((m = line.match(/^[-*+]\s+(.+)$/))) {
      flushPara();
      out.push(
        block("bulleted_list_item", { rich_text: richText(m[1]) }),
      );
      continue;
    }
    // Inline image inside text? leave as paragraph; image inside paragraph blocks aren't rendered standalone.
    paraBuf.push(line);
  }
  flushPara();
  return out;
}
