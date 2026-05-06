import type { Survey, SurveyQuestion } from './survey-schema';

const FORMS_BASE = 'https://forms.googleapis.com/v1/forms';

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

  return {
    formId: created.formId,
    responderUri: created.responderUri ?? `https://docs.google.com/forms/d/${created.formId}/viewform`,
    editUri: `https://docs.google.com/forms/d/${created.formId}/edit`,
  };
}
