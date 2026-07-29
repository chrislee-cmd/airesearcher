// translate export 렌더러 — 'zip-output'(통역본 transcript zip).
//
// pr-probing-translate-persist-deliverable: 통역을 산출물 export 단일 진입점
//   GET /api/artifacts/translate/[id]/export/zip-output
// 에 편입한다. 산출물 = 통역본(output rows)의 txt + docx 를 담은 zip.
//
// **범위 결정(스펙 B "기존 렌더러 등록 move-only" 의 보수적 해석)**:
// 기존 다운로드 라우트(/api/translate/recordings/[id]/download)는 5포맷을
// 서비스하지만 이 unified 렌더러는 **zip-output 만** 등록한다. 사유:
//   - zip-output/zip-input 은 translate_messages(session_id 기준)에서 순수
//     파생 가능 — 여기서 안전하게 재현. 단 zip-input(원문)은 기존 라우트가
//     "source ASR 신뢰불가(한국어 대체문자/외래문자 혼입)" 로 **의도적으로
//     차단**(FORMATS set 에서 제외)하므로 산출물로 내보내지 않는 정책을 그대로
//     따른다 → zip-output 만.
//   - m4a-output 은 translate_recordings(storage_key) + ffmpeg transcode +
//     크레딧 환불 + host-only 게이트에 얽혀 있다. 이를 session_id 기준 unified
//     렌더러로 옮기면 기존 유료 오디오 다운로드 경로의 게이트/환불 로직을
//     건드리게 되어 스펙 제약 2·4("통역 세션/다운로드·공유 무변경")를 위반한다
//     → 기존 라우트를 오디오 export 의 SSOT 로 유지하고 옮기지 않는다.
//   - zip-revised 는 revision_status='done' 게이트가 필요 → 후속 판단.
//
// featureRow = adapter.selectColumns(session 행). 본문(messages)은 CD BUILD-SPEC
// §5.2 경계대로 렌더러가 ctx.supabase 로 다시 조회한다. RLS
// (translate_messages_org_select)가 org 멤버 select 를 허용하고, 라우트가 이미
// org 스코프를 검증했으므로 authed 클라이언트로 충분(admin client 불필요).

import { zipSync, strToU8 } from 'fflate';
import {
  renderTranslateTranscriptDocx,
  renderTranslateTranscriptText,
  type TranscriptMessage,
  type TranscriptMeta,
} from '@/lib/translate-transcript';
import { registerRenderer } from '../export-registry';
import type { ExportContext, ExportOutput } from '../export-registry';

// 통역본 zip 파일 stem — 로케일별 파일명(사용자가 받는 파일이 UI 와 일치).
const OUTPUT_STEM: Record<'ko' | 'en' | 'ja' | 'th', string> = {
  // i18n-allow-korean -- 로케일 keyed 파일명 stem(ko), 기존 다운로드 라우트 ZIP_STEMS 와 동형
  ko: '통역본',
  en: 'translation',
  ja: '通訳',
  th: 'translation',
};

function pickLocale(sp: URLSearchParams): TranscriptMeta['locale'] {
  const raw = (sp.get('locale') ?? '').toLowerCase();
  if (raw === 'en' || raw === 'ja' || raw === 'th' || raw === 'ko') return raw;
  return 'ko';
}

// session_id 기준 translate_messages 를 ts 오름차순으로 조회(발화 순서 보존).
// 신규 컬럼(speaker/revised_text)이 이 환경에 없을 수 있어 42703 시 base 컬럼
// 폴백(기존 다운로드 라우트 loadTranscript 와 동형의 방어).
async function loadOutputMessages(
  supabase: ExportContext['supabase'],
  sessionId: string,
): Promise<TranscriptMessage[]> {
  const PAGE = 1000;
  const messages: TranscriptMessage[] = [];
  let cursor: string | null = null;
  let useBaseCols = false;
  for (let i = 0; i < 50; i++) {
    let q = supabase
      .from('translate_messages')
      .select(
        useBaseCols
          ? 'kind, text, lang, ts'
          : 'kind, text, lang, speaker, revised_text, ts',
      )
      .eq('session_id', sessionId)
      .eq('kind', 'output')
      .order('ts', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('ts', cursor);
    const { data, error } = await q;
    if (error) {
      if (
        !useBaseCols &&
        error.code === '42703' &&
        /speaker|revised_text/.test(error.message)
      ) {
        useBaseCols = true;
        continue;
      }
      console.error('[artifacts/translate] messages select failed', {
        session_id: sessionId,
        error: error.message,
      });
      break;
    }
    if (!data || data.length === 0) break;
    const rows = data as unknown as TranscriptMessage[];
    for (const row of rows) messages.push(row);
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].ts;
  }
  return messages;
}

async function renderZipOutput(
  featureRow: Record<string, unknown>,
  ctx: ExportContext,
): Promise<ExportOutput> {
  const sessionId = ctx.id;
  const sourceLang =
    typeof featureRow.source_lang === 'string' ? featureRow.source_lang : 'ko';
  const targetLang =
    typeof featureRow.target_lang === 'string' ? featureRow.target_lang : 'en';
  const startedAt =
    typeof featureRow.started_at === 'string' ? featureRow.started_at : null;

  const locale = pickLocale(ctx.searchParams);
  const meta: TranscriptMeta = {
    sessionId,
    sourceLang,
    targetLang,
    startedAt,
    locale,
  };

  const messages = await loadOutputMessages(ctx.supabase, sessionId);

  const txt = renderTranslateTranscriptText(meta, messages);
  const docx = await renderTranslateTranscriptDocx(meta, messages);
  const docxCopy = new Uint8Array(docx.byteLength);
  docxCopy.set(new Uint8Array(docx.buffer, docx.byteOffset, docx.byteLength));

  const stem = OUTPUT_STEM[locale];
  const zipped = zipSync({
    [`${stem}.txt`]: strToU8(txt),
    [`${stem}.docx`]: docxCopy,
  });

  return {
    body: zipped,
    mime: 'application/zip',
    filename: `translate-${sessionId}-output.zip`,
  };
}

registerRenderer('translate', 'zip-output', renderZipOutput);
