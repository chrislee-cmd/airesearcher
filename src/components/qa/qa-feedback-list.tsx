'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { QA_TAGS, QA_TAG_LABEL } from '@/lib/qa-tags';

// MediaRecorder webm files carry no duration in their container, so an
// <audio> element loads them with duration === Infinity. Chrome then treats
// the element as already-ended: pressing play produces no sound and the seek
// bar is dead. Forcing a seek to the far end makes the browser scan to the
// real end and compute the true duration; we then reset to 0 so it's ready to
// play normally. This is the standard workaround for MediaRecorder playback.
function FeedbackAudio({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const fixedRef = useRef(false);

  const onLoadedMetadata = useCallback(() => {
    const el = ref.current;
    if (!el || fixedRef.current) return;
    if (el.duration === Infinity || Number.isNaN(el.duration)) {
      fixedRef.current = true;
      const onSeeked = () => {
        el.removeEventListener('timeupdate', onSeeked);
        el.currentTime = 0;
      };
      el.addEventListener('timeupdate', onSeeked);
      // A finite-but-huge target; Chrome clamps to the true end while scanning.
      el.currentTime = 1e101;
    }
  }, []);

  return (
    <audio
      ref={ref}
      controls
      src={src}
      onLoadedMetadata={onLoadedMetadata}
      className="flex-1"
    />
  );
}

export type QaFeedbackRow = {
  id: string;
  user_id: string;
  session_id: string;
  audio_storage_key: string;
  transcript: string | null;
  page_url: string | null;
  duration_seconds: number | null;
  status: string;
  meta: Record<string, unknown>;
  created_at: string;
  user_email: string;
  user_name: string | null;
};

export function QaFeedbackList({ feedbacks }: { feedbacks: QaFeedbackRow[] }) {
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [activeTags, setActiveTags] = useState<string[]>([]); // 다중 필터
  const supabase = createClient();

  const toggleFilter = (key: string) =>
    setActiveTags((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );

  // Tag 필터 (OR): 선택된 tag 중 어느 하나라도 매치하면 노출. 필터가 비어 있으면
  // 전체. 아래 userGroups/sessionGroups 가 모두 이 결과를 base 로 써서 좌 사이드바
  // 유저 목록과 우 상세가 함께 좁혀진다.
  const filteredFeedbacks = useMemo(() => {
    if (activeTags.length === 0) return feedbacks;
    return feedbacks.filter((f) => {
      const tags = (f.meta?.tags as string[] | undefined) ?? [];
      return activeTags.some((t) => tags.includes(t));
    });
  }, [feedbacks, activeTags]);

  // 유저별 통계 (좌 사이드바). filteredFeedbacks 는 서버 정렬(created_at desc)을
  // 유지하므로 각 그룹의 첫 row 가 가장 최근.
  const userGroups = useMemo(() => {
    const map = new Map<
      string,
      { email: string; name: string | null; count: number; lastAt: string }
    >();
    for (const f of filteredFeedbacks) {
      const cur = map.get(f.user_id);
      if (cur) {
        cur.count += 1;
        if (f.created_at > cur.lastAt) cur.lastAt = f.created_at;
      } else {
        map.set(f.user_id, {
          email: f.user_email,
          name: f.user_name,
          count: 1,
          lastAt: f.created_at,
        });
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      b[1].lastAt.localeCompare(a[1].lastAt),
    );
  }, [filteredFeedbacks]);

  // 선택 유저의 session 별 그룹 (우 상세). 각 session 의 fs 는 created_at desc 순서
  // (feedbacks 정렬 유지) — fs[0] 가 최신, fs[fs.length - 1] 가 세션 시작.
  const sessionGroups = useMemo(() => {
    if (!selectedUser) return [];
    const userFeedbacks = filteredFeedbacks.filter(
      (f) => f.user_id === selectedUser,
    );
    const map = new Map<string, QaFeedbackRow[]>();
    for (const f of userFeedbacks) {
      const arr = map.get(f.session_id) ?? [];
      arr.push(f);
      map.set(f.session_id, arr);
    }
    return Array.from(map.entries())
      .map(([sid, fs]) => ({ sid, fs, latest: fs[0].created_at }))
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }, [filteredFeedbacks, selectedUser]);

  const getSignedUrl = async (id: string, key: string) => {
    if (audioUrls[id]) return;
    const { data } = await supabase.storage
      .from('qa-feedback-audio')
      .createSignedUrl(key, 300);
    if (data?.signedUrl) {
      setAudioUrls((prev) => ({ ...prev, [id]: data.signedUrl }));
    }
  };

  return (
    <div className="flex h-full">
      {/* 좌 사이드바 = 유저 리스트 */}
      <aside className="w-72 flex-shrink-0 border-r border-line-soft overflow-y-auto">
        <header className="p-4 border-b-2 border-line-soft">
          <h2 className="text-md font-semibold text-ink">
            QA Testers ({userGroups.length})
          </h2>
        </header>

        {/* Tag 필터 (OR 다중 toggle) — 좌 사이드바 유저 목록과 우 상세를 함께 좁힌다. */}
        <div className="p-4 border-b-2 border-line-soft space-y-3">
          <div className="flex flex-wrap gap-1">
            {QA_TAGS.map((t) => (
              // eslint-disable-next-line react/forbid-elements -- compact filter chip; Button primitive capsule chrome unsuitable for a small toggle pill
              <button
                key={t.key}
                type="button"
                onClick={() => toggleFilter(t.key)}
                className={`px-2 py-0.5 rounded-pill text-xs-soft border transition-colors ${
                  activeTags.includes(t.key)
                    ? 'border-ink bg-amore-bg text-ink'
                    : 'border-line-soft text-mute hover:bg-amore-bg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {activeTags.length > 0 && (
            <Button
              variant="link"
              size="xs"
              onClick={() => setActiveTags([])}
              className="text-mute"
            >
              필터 초기화
            </Button>
          )}
        </div>

        <ul>
          {userGroups.map(([userId, info]) => (
            <li key={userId}>
              {/* Full-width multiline list-row selector — the Button primitive's
                  capsule chrome (center-justified, border, hard shadow) is
                  unsuitable for a text-left multiline row, so this stays a
                  native <button>. */}
              {/* eslint-disable-next-line react/forbid-elements -- custom full-width multiline list-row selector; Button primitive chrome unsuitable */}
              <button
                type="button"
                onClick={() => setSelectedUser(userId)}
                className={`w-full text-left p-3 border-b border-line-soft hover:bg-amore-bg ${selectedUser === userId ? 'bg-amore-bg' : ''}`}
              >
                <div className="text-sm font-semibold text-ink truncate">
                  {info.email}
                </div>
                {info.name && (
                  <div className="text-xs-soft text-mute truncate">
                    {info.name}
                  </div>
                )}
                <div className="text-xs-soft text-mute-soft mt-1">
                  {info.count}개 피드백 ·{' '}
                  {new Date(info.lastAt).toLocaleDateString('ko-KR')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* 우 상세 = 선택 유저의 session 별 그룹 */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {!selectedUser && (
          <p className="text-sm text-mute text-center py-24">
            좌측에서 QA tester 를 선택하세요.
          </p>
        )}
        {selectedUser &&
          sessionGroups.map(({ sid, fs }) => (
            <section
              key={sid}
              className="border border-line-soft rounded-sm p-4 space-y-3"
            >
              <header className="text-sm text-mute">
                Session {sid.slice(0, 8)} · {fs.length}개 피드백 ·{' '}
                {new Date(fs[fs.length - 1].created_at).toLocaleString('ko-KR')}{' '}
                시작
              </header>
              {fs.map((f) => (
                <div
                  key={f.id}
                  className="border-t border-line-soft pt-3 space-y-2"
                >
                  <div className="text-xs-soft text-mute flex items-center gap-3">
                    <span>
                      {new Date(f.created_at).toLocaleTimeString('ko-KR')}
                    </span>
                    {f.duration_seconds != null && (
                      <span>{f.duration_seconds}s</span>
                    )}
                    {f.page_url && (
                      <span className="truncate">📍 {f.page_url}</span>
                    )}
                    <span
                      className={
                        f.status === 'done' ? 'text-amore' : 'text-mute-soft'
                      }
                    >
                      {f.status}
                    </span>
                  </div>
                  {Array.isArray(f.meta?.tags) &&
                    (f.meta.tags as string[]).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(f.meta.tags as string[]).map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded-pill border border-line-soft text-xs-soft text-mute"
                          >
                            {QA_TAG_LABEL[t] ?? t}
                          </span>
                        ))}
                      </div>
                    )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => getSignedUrl(f.id, f.audio_storage_key)}
                      className="whitespace-nowrap"
                    >
                      🔊 재생
                    </Button>
                    {audioUrls[f.id] && <FeedbackAudio src={audioUrls[f.id]} />}
                  </div>
                  {f.transcript ? (
                    <p className="text-sm text-ink-2 bg-paper-soft p-3 rounded-sm whitespace-pre-wrap">
                      {f.transcript}
                    </p>
                  ) : (
                    <p className="text-xs-soft text-mute-soft">
                      전사 진행 중...
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
        {selectedUser && sessionGroups.length === 0 && (
          <p className="text-sm text-mute text-center py-24">
            이 유저의 피드백이 없어요.
          </p>
        )}
      </main>
    </div>
  );
}
