interface LatestWriteQueueOptions<T> {
  readonly write: (value: T) => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

interface LatestWriteQueue<T> {
  /**
   * Schedule a full snapshot. While a write is active, newer snapshots replace
   * the pending snapshot so only the latest state is written next.
   */
  readonly enqueue: (value: T) => void;
  /** Resolve once the active write and latest pending write have settled. */
  readonly whenIdle: () => Promise<void>;
  /** Discard the current pending snapshot and wait for any active write to settle. */
  readonly reset: () => Promise<void>;
}

interface IdleWaiter {
  readonly resolve: () => void;
}

export function createLatestWriteQueue<T>({
  write,
  onError = () => undefined,
}: LatestWriteQueueOptions<T>): LatestWriteQueue<T> {
  let activeWrite: Promise<void> | null = null;
  let pendingValue: T | undefined;
  let hasPendingValue = false;
  const idleWaiters = new Set<IdleWaiter>();

  const resolveIdleWaiters = () => {
    if (activeWrite !== null || hasPendingValue) {
      return;
    }
    for (const waiter of idleWaiters) {
      waiter.resolve();
    }
    idleWaiters.clear();
  };

  const drain = () => {
    if (activeWrite !== null || !hasPendingValue) {
      resolveIdleWaiters();
      return;
    }

    const value = pendingValue as T;
    pendingValue = undefined;
    hasPendingValue = false;

    const operation = Promise.resolve()
      .then(() => write(value))
      .catch((error: unknown) => {
        onError(error);
      })
      .finally(() => {
        if (activeWrite !== operation) {
          return;
        }
        activeWrite = null;
        drain();
      });
    activeWrite = operation;
  };

  const whenIdle = () => {
    if (activeWrite === null && !hasPendingValue) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      idleWaiters.add({ resolve });
    });
  };

  return {
    enqueue(value) {
      pendingValue = value;
      hasPendingValue = true;
      drain();
    },
    whenIdle,
    reset() {
      pendingValue = undefined;
      hasPendingValue = false;
      return whenIdle();
    },
  };
}
