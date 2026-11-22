// dbQueue.ts - keeps the phone's SQLite database from being written by two things at once
// ("Error code 5: database is locked"), and sync runs from overlapping.
//   - createSerialQueue: tasks run one at a time, in the order they were queued; a failed
//     task never blocks the ones after it.
//   - retryIfLocked: a write that still finds the database locked is tried once more.
//   - singleFlight: a second call while one is running gets the same run (no second run).
//   - reportBackgroundError: a catch for fire-and-forget work, so its error is logged
//     instead of becoming an uncaught promise.
// Plain TypeScript with no imports, so Node can test it (dbQueue.test.mjs).

/** Runs queued tasks one at a time. */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

/** SQLite's "database is locked" / busy (code 5, or 6 for a locked table). */
export function isDatabaseLocked(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: unknown }).code ?? ''}` : String(error ?? '');
  return /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED|error code 5\b/i.test(text);
}

/** Runs task; if it fails because the database is locked, waits and tries once more. */
export async function retryIfLocked<T>(
  task: () => Promise<T>,
  options: {
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (error: unknown) => void;
  } = {}
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    return await task();
  } catch (error) {
    if (!isDatabaseLocked(error)) throw error;
    options.onRetry?.(error);
    await sleep(options.delayMs ?? 250);
    return task();
  }
}

/** A second call while one is running returns the running one, instead of starting another. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let active: Promise<T> | null = null;
  return () => {
    if (active) return active;
    const current = (async () => run())();
    active = current;
    const clear = () => {
      if (active === current) active = null;
    };
    current.then(clear, clear);
    return current;
  };
}

/** A catch for fire-and-forget work: logs the error (with where it came from). */
export function reportBackgroundError(where: string): (error: unknown) => void {
  return (error: unknown) => {
    console.warn(`${where} did not complete:`, error instanceof Error ? error.message : error);
  };
}
