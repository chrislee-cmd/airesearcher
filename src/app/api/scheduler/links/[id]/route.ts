import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const PatchBody = z.object({
  status: z.enum(['active', 'closed']).optional(),
  title: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data, error } = await supabase
    .from('scheduler_booking_links')
    .update(parsed.data)
    .eq('id', id)
    .select('id, slug, status')
    .single();
  if (error) {
    console.error('[scheduler/links/:id] patch failed', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('scheduler_booking_links')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('[scheduler/links/:id] delete failed', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
