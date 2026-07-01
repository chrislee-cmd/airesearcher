import { handleSnapshotSave } from '../_handler';

// POST — "리셋": functionally identical to save (a new baseline makes the
// estimated invoice read $0 again), tagged so audit history can tell the
// two intents apart.
export async function POST(req: Request) {
  return handleSnapshotSave(req, 'reset');
}
