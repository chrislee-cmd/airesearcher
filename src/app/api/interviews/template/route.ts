import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  MAX_TEMPLATE_QUESTIONS,
  parseTemplateBufferByExt,
} from '@/lib/interview-template';

export const maxDuration = 30;

// Maximum upload size for the template file. 4 MB is enough for any
// reasonable interview guide; rejects pranks early.
const MAX_BYTES = 4 * 1024 * 1024;

type StoredTemplate = {
  questions: string[];
  source_filename: string;
  uploaded_at: string;
};

async function authAndProject(req: Request | URL) {
  const url = 'url' in req ? new URL((req as Request).url) : (req as URL);
  const projectId = url.searchParams.get('project_id');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const org = await getActiveOrg();
  if (!org) {
    return {
      error: NextResponse.json({ error: 'no_organization' }, { status: 403 }),
    };
  }
  if (!projectId) {
    return {
      error: NextResponse.json({ error: 'project_required' }, { status: 400 }),
    };
  }
  // Verify the project belongs to the active org so a forged project_id
  // can't be used to read another tenant's template.
  const { data: project } = await supabase
    .from('projects')
    .select('id, org_id, interview_template')
    .eq('id', projectId)
    .single();
  if (!project || project.org_id !== org.org_id) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { supabase, projectId, project };
}

export async function GET(request: Request) {
  const ctx = await authAndProject(request);
  if ('error' in ctx) return ctx.error;
  const template = ctx.project.interview_template as StoredTemplate | null;
  return NextResponse.json({ template: template ?? null });
}

export async function DELETE(request: Request) {
  const ctx = await authAndProject(request);
  if ('error' in ctx) return ctx.error;
  const { error } = await ctx.supabase
    .from('projects')
    .update({ interview_template: null })
    .eq('id', ctx.projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// POST = upload a file → parse → save. multipart/form-data with a single
// `file` field. The active project must already exist; we don't create
// projects implicitly.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) {
    return NextResponse.json({ error: 'project_required' }, { status: 400 });
  }
  const ctx = await authAndProject(url);
  if ('error' in ctx) return ctx.error;

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  let questions: string[];
  try {
    const buf = await file.arrayBuffer();
    const result = await parseTemplateBufferByExt(file.name, buf);
    questions = Array.isArray(result) ? result : await result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'parse_failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (questions.length === 0) {
    return NextResponse.json(
      { error: 'no_questions_found' },
      { status: 422 },
    );
  }

  const truncated = questions.length >= MAX_TEMPLATE_QUESTIONS;
  const payload: StoredTemplate = {
    questions,
    source_filename: file.name,
    uploaded_at: new Date().toISOString(),
  };
  const { error } = await ctx.supabase
    .from('projects')
    .update({ interview_template: payload })
    .eq('id', ctx.projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: payload, truncated });
}

// PATCH = update the question list after the user edits in the preview.
// We accept the whole array each time — small payload, simple semantics.
const PatchBody = z.object({
  questions: z
    .array(z.string().min(1).max(500))
    .min(1)
    .max(MAX_TEMPLATE_QUESTIONS),
});

export async function PATCH(request: Request) {
  const ctx = await authAndProject(request);
  if ('error' in ctx) return ctx.error;
  const parsed = PatchBody.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const existing = ctx.project.interview_template as StoredTemplate | null;
  const payload: StoredTemplate = {
    questions: parsed.data.questions.map((q) => q.trim()).filter(Boolean),
    source_filename: existing?.source_filename ?? 'manual.txt',
    uploaded_at: existing?.uploaded_at ?? new Date().toISOString(),
  };
  if (payload.questions.length === 0) {
    return NextResponse.json({ error: 'empty_after_trim' }, { status: 400 });
  }
  const { error } = await ctx.supabase
    .from('projects')
    .update({ interview_template: payload })
    .eq('id', ctx.projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: payload });
}
