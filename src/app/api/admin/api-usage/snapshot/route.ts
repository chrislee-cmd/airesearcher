import { handleSnapshotSave } from './_handler';

// POST — save current cumulative usage as the new baseline.
export async function POST(req: Request) {
  return handleSnapshotSave(req);
}
