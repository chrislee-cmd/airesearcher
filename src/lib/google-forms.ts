import type { Survey, SurveyQuestion } from './survey-schema';

const FORMS_BASE = 'https://forms.googleapis.com/v1/forms';

export type FormColumn = {
  questionId: string;
  itemId: string;
  title: string;
};

export type FormResponseRow = {
  responseId: string;
  createTime: string;
  lastSubmittedTime: string;
  // questionId → joined string answer (multi-select gets ", "-joined)
  answers: Record<string, string>;
};

export type FormResponses = {
  formId: string;
  title: string;
  columns: FormColumn[];
  rows: FormResponseRow[];
};

// Minimal slice of the forms.googleapis.com schema we read.
type FormItem = {
  itemId?: string;
  title?: string;
  questionItem?: { question?: { questionId?: string } };
  pageBreakItem?: unknown;
  textItem?: unknown;
};
type FormGetResponse = {
  formId: string;
  info?: { title?: string; documentTitle?: string };
  items?: FormItem[];
};
type AnswerValue = { answers?: { value?: string }[] };
type FormResponse = {
  responseId: string;
  createTime: string;
  lastSubmittedTime: string;
  answers?: Record<string, { textAnswers?: AnswerValue }>;
};
type ResponsesListBody = {
  responses?: FormResponse[];
  nextPageToken?: string;
};

type CreateItemRequest = { createItem: { item: Record<string, unknown>; location: { index: number } } };
type UpdateFormInfoRequest = {
  updateFormInfo: { info: { description?: string }; updateMask: string };
};
type BatchRequest = CreateItemRequest | UpdateFormInfoRequest;

function questionToItem(q: SurveyQuestion): Record<string, unknown> {
  const required = q.required;
  const description = q.description || undefined;

  if (q.kind === 'short_answer' || q.kind === 'long_answer') {
    return {
      title: q.title,
      description,
      questionItem: {
        question: {
          required,
          textQuestion: { paragraph: q.kind === 'long_answer' },
        },
      },
    };
  }

  if (q.kind === 'single_choice' || q.kind === 'multi_choice' || q.kind === 'dropdown') {
    const type =
      q.kind === 'single_choice'
        ? 'RADIO'
        : q.kind === 'multi_choice'
          ? 'CHECKBOX'
          : 'DROP_DOWN';
    return {
      title: q.title,
      description,
      questionItem: {
        question: {
          required,
          choiceQuestion: {
            type,
            options: q.options.map((value) => ({ value })),
          },
        },
      },
    };
  }

  // scale
  return {
    title: q.title,
    description,
    questionItem: {
      question: {
        required,
        scaleQuestion: {
          low: q.scaleMin || 1,
          high: q.scaleMax || 5,
          lowLabel: q.scaleMinLabel || undefined,
          highLabel: q.scaleMaxLabel || undefined,
        },
      },
    },
  };
}

export async function createGoogleForm(
  accessToken: string,
  survey: Survey,
): Promise<{ formId: string; responderUri: string; editUri: string }> {
  // Step 1: create the form. The create endpoint only accepts `info.title`
  // (and an optional documentTitle); description and items are added via
  // batchUpdate below.
  const createRes = await fetch(FORMS_BASE, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ info: { title: survey.title || '리서치 설문' } }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    throw new Error(`forms_create_failed: ${createRes.status} ${txt}`);
  }
  const created = (await createRes.json()) as {
    formId: string;
    responderUri?: string;
    info?: { title?: string };
  };

  // Step 2: build the batchUpdate body. We flatten sections into
  // PAGE_BREAK + question items. Section titles become page_break titles
  // so the form has visual structure.
  const requests: BatchRequest[] = [];
  if (survey.description) {
    requests.push({
      updateFormInfo: {
        info: { description: survey.description },
        updateMask: 'description',
      },
    });
  }

  let index = 0;
  survey.sections.forEach((section, sIdx) => {
    if (sIdx > 0) {
      requests.push({
        createItem: {
          item: {
            title: section.title,
            pageBreakItem: {},
          },
          location: { index: index++ },
        },
      });
    } else if (section.title) {
      // For the first section, prepend a section header (text item) so
      // the title appears above the first question.
      requests.push({
        createItem: {
          item: {
            title: section.title,
            textItem: {},
          },
          location: { index: index++ },
        },
      });
    }
    for (const q of section.questions) {
      requests.push({
        createItem: {
          item: questionToItem(q),
          location: { index: index++ },
        },
      });
    }
  });

  if (requests.length > 0) {
    const updateRes = await fetch(
      `${FORMS_BASE}/${created.formId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      },
    );
    if (!updateRes.ok) {
      const txt = await updateRes.text();
      throw new Error(`forms_batch_update_failed: ${updateRes.status} ${txt}`);
    }
  }

  // Step 3: open the form's responder access to anyone with the link.
  // Forms created inside a Workspace tenant (e.g. meteor-research) inherit
  // domain-restricted Drive permissions by default, which means external
  // recruits hit a "Sign in to your account" wall. Adding an `anyone`
  // reader permission via the Drive API lifts that wall. Failures here
  // are non-fatal — the form is still published, and we surface a clear
  // error string so the caller can show a "재연결 필요" hint when the
  // drive.file scope is missing.
  await setFormAnyoneCanView(accessToken, created.formId);

  return {
    formId: created.formId,
    responderUri: created.responderUri ?? `https://docs.google.com/forms/d/${created.formId}/viewform`,
    editUri: `https://docs.google.com/forms/d/${created.formId}/edit`,
  };
}

async function setFormAnyoneCanView(
  accessToken: string,
  formId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${formId}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`forms_share_failed: ${res.status} ${txt}`);
  }
}

async function fetchFormSchema(
  accessToken: string,
  formId: string,
): Promise<FormGetResponse> {
  const res = await fetch(`${FORMS_BASE}/${formId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`forms_get_failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as FormGetResponse;
}

async function fetchAllResponses(
  accessToken: string,
  formId: string,
): Promise<FormResponse[]> {
  const all: FormResponse[] = [];
  let pageToken: string | undefined;
  // Forms API caps page size at 5000 — usually one page is enough but
  // we paginate defensively in case a recruit form goes wider than that.
  do {
    const url = new URL(`${FORMS_BASE}/${formId}/responses`);
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`forms_responses_failed: ${res.status} ${txt}`);
    }
    const body = (await res.json()) as ResponsesListBody;
    if (body.responses) all.push(...body.responses);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return all;
}

export async function getFormResponses(
  accessToken: string,
  formId: string,
): Promise<FormResponses> {
  const [schema, raw] = await Promise.all([
    fetchFormSchema(accessToken, formId),
    fetchAllResponses(accessToken, formId),
  ]);

  // Build a stable column order from the form items: only items that
  // are actual questions (skip page breaks / text/section headers).
  const columns: FormColumn[] = [];
  for (const item of schema.items ?? []) {
    const q = item.questionItem?.question;
    if (q?.questionId && item.itemId && item.title) {
      columns.push({
        questionId: q.questionId,
        itemId: item.itemId,
        title: item.title,
      });
    }
  }

  const rows: FormResponseRow[] = raw.map((r) => {
    const answers: Record<string, string> = {};
    for (const [questionId, ans] of Object.entries(r.answers ?? {})) {
      const values = ans.textAnswers?.answers ?? [];
      answers[questionId] = values
        .map((v) => v.value ?? '')
        .filter(Boolean)
        .join(', ');
    }
    return {
      responseId: r.responseId,
      createTime: r.createTime,
      lastSubmittedTime: r.lastSubmittedTime,
      answers,
    };
  });

  // Newest responses first — recruiters care about latest signups.
  rows.sort((a, b) =>
    a.lastSubmittedTime < b.lastSubmittedTime ? 1 : -1,
  );

  return {
    formId: schema.formId,
    title: schema.info?.title ?? '',
    columns,
    rows,
  };
}
