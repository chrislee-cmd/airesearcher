const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'notion-version': NOTION_VERSION,
  };
}

// Minimal markdown → Notion blocks converter.
// Handles: h1/h2/h3, bullets (- *), numbered lists, horizontal rules, paragraphs.
function markdownToBlocks(md: string): object[] {
  const lines = md.split('\n');
  const blocks: object[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^### /.test(line)) {
      blocks.push(heading(3, line.slice(4)));
    } else if (/^## /.test(line)) {
      blocks.push(heading(2, line.slice(3)));
    } else if (/^# /.test(line)) {
      blocks.push(heading(1, line.slice(2)));
    } else if (/^[-*] /.test(line)) {
      blocks.push(bullet(line.slice(2)));
    } else if (/^\d+\. /.test(line)) {
      blocks.push(numbered(line.replace(/^\d+\. /, '')));
    } else if (/^---+$/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (line === '') {
      // skip blank lines (Notion handles spacing itself)
    } else {
      blocks.push(paragraph(line));
    }
  }

  return blocks;
}

function richText(content: string) {
  return [{ type: 'text', text: { content } }];
}

function heading(level: 1 | 2 | 3, content: string) {
  const type = `heading_${level}` as const;
  return { object: 'block', type, [type]: { rich_text: richText(content) } };
}

function paragraph(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(content) },
  };
}

function bullet(content: string) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(content) },
  };
}

function numbered(content: string) {
  return {
    object: 'block',
    type: 'numbered_list_item',
    numbered_list_item: { rich_text: richText(content) },
  };
}

export async function createNotionPage(
  accessToken: string,
  title: string,
  markdown: string,
): Promise<{ url: string; pageId: string }> {
  // Notion limits children to 100 blocks per request.
  const allBlocks = markdownToBlocks(markdown);
  const firstChunk = allBlocks.slice(0, 100);

  const body = {
    parent: { type: 'workspace', workspace: true },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: title } }],
      },
    },
    children: firstChunk,
  };

  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`notion_create_failed: ${res.status} ${msg}`);
  }
  const page = (await res.json()) as { id: string; url: string };

  // Append remaining blocks in batches of 100
  if (allBlocks.length > 100) {
    for (let i = 100; i < allBlocks.length; i += 100) {
      const chunk = allBlocks.slice(i, i + 100);
      const appendRes = await fetch(`${NOTION_API}/blocks/${page.id}/children`, {
        method: 'PATCH',
        headers: notionHeaders(accessToken),
        body: JSON.stringify({ children: chunk }),
      });
      if (!appendRes.ok) break; // non-fatal: partial content is still useful
    }
  }

  return { pageId: page.id, url: page.url };
}

export function getNotionEnv() {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('missing_notion_oauth_env');
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildNotionAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getNotionEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    owner: 'user',
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export async function exchangeNotionCode(code: string): Promise<{
  access_token: string;
  workspace_id: string;
  workspace_name: string | null;
  bot_id: string;
}> {
  const { clientId, clientSecret, redirectUri } = getNotionEnv();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${NOTION_API}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`notion_token_exchange_failed: ${res.status} ${msg}`);
  }
  return res.json() as Promise<{
    access_token: string;
    workspace_id: string;
    workspace_name: string | null;
    bot_id: string;
  }>;
}
