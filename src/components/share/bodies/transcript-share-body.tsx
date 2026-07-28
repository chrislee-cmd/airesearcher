import type { SharedTranscript } from '@/lib/share/loaders';
import type { TranscriptTurnRole } from '@/lib/transcripts/turns';

// 공개 공유 셸(B1) 전사록 본문 — 턴 스트림. fresh 경량 프레젠테이션(공개용):
// 로직/데이터는 loadSharedResource 가 이미 parseTranscriptTurns 로 정규화한
// turns 를 받아 그대로 그린다. 편집/검색/소스토글 등 인증 풀뷰 컨트롤은 없음.
//
// 아바타/이름 톤은 인증 풀뷰(transcript-detail avatarTone)와 동일 토큰 —
// host=sky bg + blue name · guest=amore bg + amore-deep name · neutral=sky + ink.

function avatarTone(role: TranscriptTurnRole): {
  avatarBg: string;
  nameColor: string;
} {
  if (role === 'guest') {
    return { avatarBg: 'bg-amore-bg', nameColor: 'text-amore-deep' };
  }
  if (role === 'host') {
    return { avatarBg: 'bg-sky', nameColor: 'text-blue' };
  }
  return { avatarBg: 'bg-sky', nameColor: 'text-ink' };
}

function initials(speaker: string): string {
  const trimmed = speaker.trim();
  return trimmed ? (Array.from(trimmed)[0] ?? '?') : '?';
}

export function TranscriptShareBody({ data }: { data: SharedTranscript }) {
  const { turns } = data;
  return (
    <div className="flex flex-col gap-[17px]">
      {turns.map((turn) => {
        const { avatarBg, nameColor } = avatarTone(turn.role);
        return (
          <div key={turn.index} className="flex gap-3">
            <span
              aria-hidden
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xs font-extrabold text-ink ${avatarBg}`}
            >
              {initials(turn.speaker)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline gap-[9px]">
                <span className={`text-sm font-extrabold ${nameColor}`}>
                  {turn.speaker}
                </span>
                <span className="font-mono-label text-xs text-mute-soft tabular-nums">
                  {turn.timestamp}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-md leading-[1.65] text-ink-2">
                {turn.text}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
