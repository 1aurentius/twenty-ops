/**
 * Generic create / update / delete reconciliation against a key.
 *
 * Both `view set-*` (lib widgets) and `record bulk-upsert` need the same
 * "diff desired vs current, issue only the deltas" loop. Keeping it here
 * means the two callers can't drift apart on edge cases (empty input,
 * deletions, idempotency).
 */
export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface ReconcileArgs<C extends { id: string }> {
  desired: Record<string, unknown>[];
  current: C[];
  keyOfDesired: (d: Record<string, unknown>) => string;
  keyOfCurrent: (c: C) => string;
  changed: (cur: C, des: Record<string, unknown>) => boolean;
  create: (des: Record<string, unknown>) => Promise<void>;
  update: (cur: C, des: Record<string, unknown>) => Promise<void>;
  remove: (cur: C) => Promise<void>;
}

export async function reconcile<C extends { id: string }>(
  args: ReconcileArgs<C>,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  const currentByKey = new Map(args.current.map((c) => [args.keyOfCurrent(c), c]));
  const desiredKeys = new Set<string>();

  for (const des of args.desired) {
    const key = args.keyOfDesired(des);
    desiredKeys.add(key);
    const cur = currentByKey.get(key);
    if (!cur) {
      await args.create(des);
      result.created++;
    } else if (args.changed(cur, des)) {
      await args.update(cur, des);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }
  for (const cur of args.current) {
    if (!desiredKeys.has(args.keyOfCurrent(cur))) {
      await args.remove(cur);
      result.deleted++;
    }
  }
  return result;
}
