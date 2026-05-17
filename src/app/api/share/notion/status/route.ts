import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_notion_oauth')
    .select('workspace_name')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    workspaceName: data?.workspace_name ?? null,
  });
}
