export type Topic = {
  id: number;
  theme: string;
  prompt: string;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

const PROMPT_NAMES = ["prompt", "question", "토픽", "질문"];
const THEME_NAMES = ["theme", "category", "section", "테마", "카테고리"];

function findColIdx(header: string[], candidates: string[]): number {
  const norm = header.map((h) => (h ?? "").trim().toLowerCase());
  for (const c of candidates) {
    const idx = norm.findIndex((h) => h === c);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function rowsToTopics(rows: string[][]): Topic[] {
  const cleaned = rows.filter((r) =>
    r.some((c) => (c ?? "").trim().length > 0),
  );
  if (cleaned.length === 0) return [];
  const [header, ...body] = cleaned;

  let promptIdx = findColIdx(header, PROMPT_NAMES);
  let themeIdx = findColIdx(header, THEME_NAMES);

  // "Topic" is ambiguous — it can mean either theme (group) or the prompt itself.
  // If a real prompt column exists, treat "Topic" as theme.
  // Otherwise, treat "Topic" as the prompt column (back-compat).
  const norm = header.map((h) => (h ?? "").trim().toLowerCase());
  const topicIdx = norm.indexOf("topic");
  if (topicIdx >= 0) {
    if (promptIdx >= 0 && themeIdx < 0 && topicIdx !== promptIdx) {
      themeIdx = topicIdx;
    } else if (promptIdx < 0) {
      promptIdx = topicIdx;
    }
  }

  // If we still can't find a prompt column, fall back to first column.
  const pIdx = promptIdx >= 0 ? promptIdx : 0;

  const seen = new Set<string>();
  return body
    .map((r, i): Topic => ({
      id: i,
      theme:
        themeIdx >= 0 ? ((r[themeIdx] ?? "").trim() || "Etc") : "Etc",
      prompt: (r[pIdx] ?? "").trim(),
    }))
    .filter((t) => {
      if (t.prompt.length === 0) return false;
      const key = t.prompt.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseSheetsUrlToCsvExport(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const id = m[1];
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
