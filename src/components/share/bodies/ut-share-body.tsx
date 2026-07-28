import { getTranslations } from 'next-intl/server';
import type { SharedUtInsight } from '@/lib/share/loaders';

// 공개 공유 셸 UT 본문 — 인사이트 리포트 텍스트 + key clips(타임코드 텍스트 참조).
// fresh 경량: 클립 영상 signed URL 은 발급 안 함(loaders.ts 계약 — 공개 영상
// 노출 금지). 클립은 타임코드/테마/전사 스팬 텍스트로만 참조한다.
//
// insightSummary 는 loaders 에서 Record<string,unknown> 로 오므로 방어적 narrow
// (구/손상 payload 크래시 0). shared-views 스펙과 일치 — 리포트 텍스트만.

type Theme = { theme: string; detail: string };
type Friction = { title: string; detail: string };
type Quote = { quote: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
function arr<T>(v: unknown, map: (o: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => (o && typeof o === 'object' ? map(o as Record<string, unknown>) : null))
    .filter((x): x is T => x != null);
}

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-mono-label text-xs font-bold uppercase tracking-[0.1em] text-mute-soft">
      {children}
    </div>
  );
}

export async function UtShareBody({ data }: { data: SharedUtInsight }) {
  const t = await getTranslations('Share.shell');
  const s = (data.insightSummary ?? {}) as Record<string, unknown>;

  const overview = str(s.overview);
  const taskOutcome = str(s.task_outcome);
  const themes = arr<Theme>(s.key_themes, (o) => {
    const theme = str(o.theme);
    return theme ? { theme, detail: str(o.detail) ?? '' } : null;
  });
  const frictions = arr<Friction>(s.top_frictions, (o) => {
    const title = str(o.title);
    return title ? { title, detail: str(o.detail) ?? '' } : null;
  });
  const quotes = arr<Quote>(s.notable_quotes, (o) => {
    const quote = str(o.quote);
    return quote ? { quote } : null;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* ① 인사이트 리포트(peach 카드) */}
      <div>
        <SectionLabel>{t('utInsightReport')}</SectionLabel>
        <div className="flex flex-col gap-3 rounded-sm border-[1.4px] border-line bg-peach-bg p-4">
          {data.targetUrl && (
            <div className="break-all font-mono-label text-xs text-mute">
              {data.targetUrl}
            </div>
          )}
          {overview && (
            <p className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2">
              {overview}
            </p>
          )}
          {taskOutcome && (
            <div className="rounded-xs border border-line bg-paper px-3 py-2 text-md leading-[1.6] text-ink-2">
              <b className="font-bold text-ink">{t('utOutcome')}</b> {taskOutcome}
            </div>
          )}
        </div>
      </div>

      {/* ② key themes */}
      {themes.length > 0 && (
        <div>
          <SectionLabel>{t('utThemes')}</SectionLabel>
          <div className="flex flex-col gap-2">
            {themes.map((th, i) => (
              <div
                key={i}
                className="rounded-sm border border-line bg-paper px-3.5 py-3"
              >
                <div className="text-md font-bold text-ink">{th.theme}</div>
                {th.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-md leading-[1.6] text-ink-2">
                    {th.detail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ③ top frictions */}
      {frictions.length > 0 && (
        <div>
          <SectionLabel>{t('utFrictions')}</SectionLabel>
          <div className="flex flex-col gap-2">
            {frictions.map((fr, i) => (
              <div
                key={i}
                className="rounded-sm border border-line bg-paper px-3.5 py-3"
              >
                <div className="text-md font-bold text-ink">{fr.title}</div>
                {fr.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-md leading-[1.6] text-ink-2">
                    {fr.detail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ④ notable quotes */}
      {quotes.length > 0 && (
        <div>
          <SectionLabel>{t('utQuotes')}</SectionLabel>
          <div className="flex flex-col gap-2">
            {quotes.map((q, i) => (
              <blockquote
                key={i}
                className="rounded-sm border-l-2 border-amore bg-paper-soft px-3.5 py-2.5 text-md italic leading-[1.6] text-ink-2"
              >
                “{q.quote}”
              </blockquote>
            ))}
          </div>
        </div>
      )}

      {/* ⑤ key clips — 타임코드 텍스트 참조(영상 없음) */}
      {data.clips.length > 0 && (
        <div>
          <SectionLabel>{t('utClips')}</SectionLabel>
          <div className="flex flex-col gap-2">
            {data.clips.map((clip, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-sm border border-line bg-paper px-3.5 py-2.5"
              >
                <span className="shrink-0 font-mono-label text-xs text-mute-soft tabular-nums">
                  {mmss(clip.startMs)}–{mmss(clip.endMs)}
                </span>
                <div className="min-w-0 flex-1">
                  {clip.theme && (
                    <div className="text-md font-bold text-ink">{clip.theme}</div>
                  )}
                  {clip.transcriptSpan && (
                    <p className="whitespace-pre-wrap text-sm leading-[1.6] text-mute">
                      {clip.transcriptSpan}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
