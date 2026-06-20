import type { QueueItem } from '../widget-types';
import { Label } from './primitives';

export function QueuePanel({ queue }: { queue: QueueItem[] }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <Label>진행 중 / 대기</Label>
        <span className="text-xs text-mute-soft">{queue.length}건</span>
      </div>
      <div className="space-y-1.5">
        {queue.map((q) => (
          <div key={q.name} className="rounded-xs border border-line bg-paper px-3 py-2">
            <div className="flex items-center justify-between text-md text-ink">
              <span className="truncate">{q.name}</span>
              <span className="ml-2 text-xs text-mute">{q.eta}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-line-soft">
              <div
                className="h-full rounded-pill bg-amore"
                style={{ width: `${q.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
