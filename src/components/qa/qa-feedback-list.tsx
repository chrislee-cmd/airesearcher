'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

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
  const supabase = createClient();

  // 유저별 통계 (좌 사이드바). feedbacks 는 서버에서 created_at desc 로 정렬돼
  // 오므로 각 그룹의 첫 row 가 가장 최근.
  const userGroups = useMemo(() => {
    const map = new Map<
      string,
      { email: string; name: string | null; count: number; lastAt: string }
    >();
    for (const f of feedbacks) {
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
  }, [feedbacks]);

  // 선택 유저의 session 별 그룹 (우 상세). 각 session 의 fs 는 created_at desc 순서
  // (feedbacks 정렬 유지) — fs[0] 가 최신, fs[fs.length - 1] 가 세션 시작.
  const sessionGroups = useMemo(() => {
    if (!selectedUser) return [];
    const userFeedbacks = feedbacks.filter((f) => f.user_id === selectedUser);
    const map = new Map<string, QaFeedbackRow[]>();
    for (const f of userFeedbacks) {
      const arr = map.get(f.session_id) ?? [];
      arr.push(f);
      map.set(f.session_id, arr);
    }
    return Array.from(map.entries())
      .map(([sid, fs]) => ({ sid, fs, latest: fs[0].created_at }))
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }, [feedbacks, selectedUser]);

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
                  <div className="flex items-center gap-2">
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => getSignedUrl(f.id, f.audio_storage_key)}
                      className="whitespace-nowrap"
                    >
                      🔊 재생
                    </Button>
                    {audioUrls[f.id] && (
                      <audio controls src={audioUrls[f.id]} className="flex-1" />
                    )}
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
