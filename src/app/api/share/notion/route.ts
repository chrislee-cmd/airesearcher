import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createNotionPage } from '@/lib/share/notion';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: oauth } = await supabase
    .from('user_notion_oauth')
    .select('access_token')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!oauth) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string; markdown?: string };
  const title = body.title?.trim() || '리서치 노트';
  const markdown = body.markdown?.trim() || '';

  try {
    const result = await createNotionPage(oauth.access_token, title, markdown);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
