import { getTranslations } from 'next-intl/server';
import type { SharedDeskReport } from '@/lib/share/loaders';
import {
  parseDeskReport,
  type DeskSectionKind,
} from '@/lib/desk-report-parser';

// 공개 공유 셸(B2) 데스크 리포트 본문 — 섹션 카드 + 출처. fresh 경량:
// parseDeskReport(재사용 순수 로직)로 markdown → 섹션 분할 후 memphis 카드로 렌더.
// 인증 풀뷰(desk-fullview-body)의 판단로그·재생성·quant 인터랙션은 없음.
//
// quant 표 생략(보수적): 공유 페이로드(loaders.ts SharedDeskReport)는
// output+keywords+sources 만 담고 구조화 quant claim 은 없다 → 데이터 없는 표를
// 만들지 않는다. 섹션 body 안의 quant snapshot 서술은 그대로 렌더된다.
//
// tint/dot 은 인증 desk-fullview 의 KindVisual 과 동일 §F6 토큰(하드코드 hex 0).

type KindVisual = { headBg: string; dot: string };
const KIND_VISUAL: Record<DeskSectionKind, KindVisual> = {
  executive: { headBg: 'bg-rose-bg', dot: 'bg-amore' },
  findings: { headBg: 'bg-mint-bg', dot: 'bg-success' },
  quant: { headBg: 'bg-sun-bg', dot: 'bg-amber' },
  rq: { headBg: 'bg-lav-bg-3', dot: 'bg-violet' },
  appendix: { headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  competitive: { headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  caveats: { headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
  other: { headBg: 'bg-neutral-bg', dot: 'bg-mute-soft' },
};

// 섹션 body 는 markdown — 공개 경량 렌더는 리치 파서를 끌어오지 않고 문단
// 프리랩으로 그린다(안전: 텍스트만, React escape). 선두 마커만 가볍게 정리.
function plainParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/^\s*[-*]\s+/, '· ').replace(/^#{1,6}\s+/, ''))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

export async function DeskShareBody({ data }: { data: SharedDeskReport }) {
  const t = await getTranslations('Share.shell');
  const parsed = parseDeskReport(data.output);

  return (
    <div className="flex flex-col gap-3.5">
      {parsed.ok ? (
        parsed.sections.map((section) => {
          const visual = KIND_VISUAL[section.kind];
          return (
            <section
              key={section.id}
              className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-md"
            >
              <div
                className={`flex items-center gap-2.5 border-b-2 border-ink px-3.5 py-2.5 ${visual.headBg}`}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink ${visual.dot}`}
                />
                <span aria-hidden className="text-md">
                  {section.icon}
                </span>
                <span className="min-w-0 flex-1 font-display text-md font-extrabold text-ink">
                  {section.title}
                </span>
              </div>
              <div className="flex flex-col gap-2.5 px-3.5 py-3.5">
                {plainParagraphs(section.body).map((p, i) => (
                  <p
                    key={i}
                    className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2"
                  >
                    {p}
                  </p>
                ))}
                {section.topics.map((topic) => (
                  <div key={topic.id} className="flex flex-col gap-1.5">
                    <div className="text-md font-bold text-ink">
                      {topic.title}
                    </div>
                    {plainParagraphs(topic.body).map((p, i) => (
                      <p
                        key={i}
                        className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2"
                      >
                        {p}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })
      ) : (
        // 인식 가능한 섹션 0 → raw markdown 프리랩 fallback(파서 계약).
        <p className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2">
          {data.output}
        </p>
      )}

      {/* 출처 — 공유 페이로드에 있으면 하단 appendix 로. */}
      {data.sources.length > 0 && (
        <section className="overflow-hidden rounded-sm border-[1.5px] border-line bg-paper">
          <div className="border-b border-line px-3.5 py-2 font-mono-label text-xs font-bold uppercase tracking-[0.1em] text-mute-soft">
            {t('deskSources')}
          </div>
          <ul className="flex flex-col gap-1.5 px-3.5 py-3">
            {data.sources.map((src, i) => (
              <li key={i} className="break-all text-sm leading-[1.6] text-mute">
                {src}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
