import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Static brand banner served as the Open Graph / Twitter share image.
// Replaces the #578 Memphis dynamic ImageResponse: the banner is a
// pixel-perfect PNG supplied by design (English-only, no ko/en split), so we
// stream the file straight through instead of re-rendering it with Satori.
export const alt = 'Research-Canvas — Your research workflow, in one place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const buffer = await readFile(
    join(process.cwd(), 'public/branding/social/OG_1200x630.png'),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
