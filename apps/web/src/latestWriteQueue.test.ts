import { describe, expect, it, vi } from "vitest";

import { createLatestWriteQueue } from "./latestWriteQueue";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createLatestWriteQueue", () => {
  it("keeps one write active and coalesces pending snapshots to the latest value", async () => {
    const writeA = createDeferred<void>();
    const writeC = createDeferred<void>();
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const write = vi.fn(async (value: string) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      try {
        await (value === "A" ? writeA.promise : writeC.promise);
      } finally {
        activeWrites -= 1;
      }
    });
    const queue = createLatestWriteQueue({ write });

    queue.enqueue("A");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    queue.enqueue("B");
    queue.enqueue("C");
    expect(write).toHaveBeenCalledTimes(1);

    writeA.resolve();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls.map(([value]) => value)).toEqual(["A", "C"]);
    expect(maximumActiveWrites).toBe(1);

    writeC.resolve();
    await queue.whenIdle();
    expect(activeWrites).toBe(0);
  });

  it("drains the latest snapshot after failure and accepts later writes", async () => {
    const error = new Error("write A failed");
    const onError = vi.fn();
    const write = vi.fn(async (value: string) => {
      if (value === "A") {
        throw error;
      }
    });
    const queue = createLatestWriteQueue({ write, onError });

    queue.enqueue("A");
    queue.enqueue("B");
    await queue.whenIdle();

    expect(write.mock.calls.map(([value]) => value)).toEqual(["A", "B"]);
    expect(onError).toHaveBeenCalledWith(error);

    queue.enqueue("C");
    await queue.whenIdle();
    expect(write.mock.calls.map(([value]) => value)).toEqual(["A", "B", "C"]);
  });

  it("captures a synchronous writer throw without poisoning later writes", async () => {
    const error = new Error("synchronous write failed");
    const onError = vi.fn();
    const write = vi.fn((value: string): Promise<void> => {
      if (value === "A") {
        throw error;
      }
      return Promise.resolve();
    });
    const queue = createLatestWriteQueue({ write, onError });

    queue.enqueue("A");
    await queue.whenIdle();
    queue.enqueue("B");
    await queue.whenIdle();

    expect(write.mock.calls.map(([value]) => value)).toEqual(["A", "B"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reset discards the current pending snapshot without overlapping a later write", async () => {
    const writeA = createDeferred<void>();
    const writeC = createDeferred<void>();
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const write = vi.fn(async (value: string) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      try {
        await (value === "A" ? writeA.promise : writeC.promise);
      } finally {
        activeWrites -= 1;
      }
    });
    const queue = createLatestWriteQueue({ write });

    queue.enqueue("A");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    queue.enqueue("B");
    const reset = queue.reset();
    queue.enqueue("C");

    expect(write).toHaveBeenCalledTimes(1);
    writeA.resolve();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls.map(([value]) => value)).toEqual(["A", "C"]);
    expect(maximumActiveWrites).toBe(1);

    writeC.resolve();
    await reset;
    expect(activeWrites).toBe(0);
  });
});
