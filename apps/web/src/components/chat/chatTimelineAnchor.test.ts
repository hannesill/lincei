import { describe, expect, it, vi } from "vitest";
import { createChatTimelineAnchorController } from "./chatTimelineAnchor";

function createHarness() {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  const timeoutCallbacks = new Map<number, () => void>();
  let nextId = 1;
  const scrollNode = new EventTarget() as HTMLElement;
  const list = {
    getScrollableNode: vi.fn(() => scrollNode),
    getState: vi.fn(() => ({ scroll: 128 })),
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
  };
  const scheduler = {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      frameCallbacks.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      frameCallbacks.delete(id);
    }),
    setTimeout: vi.fn((callback: () => void) => {
      const id = nextId++;
      timeoutCallbacks.set(id, callback);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      timeoutCallbacks.delete(id);
    }),
  };
  const flushFrame = () => {
    const entry = frameCallbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) return;
    frameCallbacks.delete(entry[0]);
    entry[1](0);
  };

  return {
    controller: createChatTimelineAnchorController({ getList: () => list, scheduler }),
    flushFrame,
    frameCallbacks,
    list,
    scrollNode,
    timeoutCallbacks,
  };
}

describe("createChatTimelineAnchorController", () => {
  it("positions a measured anchor once and freezes its settled offset", () => {
    const harness = createHarness();

    harness.controller.position("message-1", 4);
    harness.controller.position("message-1", 4);
    harness.flushFrame();
    harness.flushFrame();

    expect(harness.list.scrollToIndex).toHaveBeenCalledOnce();
    expect(harness.list.scrollToIndex).toHaveBeenCalledWith({
      index: 4,
      animated: true,
      viewPosition: 0,
      viewOffset: 16,
    });

    harness.scrollNode.dispatchEvent(new Event("scrollend"));
    expect(harness.list.scrollToOffset).toHaveBeenCalledWith({
      offset: 128,
      animated: false,
    });
  });

  it("restores the settled offset after an anchor size change", () => {
    const harness = createHarness();
    harness.controller.position("message-1", 1);
    harness.flushFrame();
    harness.flushFrame();
    harness.scrollNode.dispatchEvent(new Event("scrollend"));
    harness.list.scrollToOffset.mockClear();

    harness.controller.sizeChanged("message-1");
    harness.flushFrame();

    expect(harness.list.scrollToOffset).toHaveBeenCalledWith({
      offset: 128,
      animated: false,
    });
  });

  it("cancels queued and in-flight positioning when the active session resets", () => {
    const queued = createHarness();
    queued.controller.position("old-message", 2);
    queued.controller.reset();
    queued.flushFrame();
    expect(queued.list.scrollToIndex).not.toHaveBeenCalled();

    const inFlight = createHarness();
    inFlight.controller.position("old-message", 2);
    inFlight.flushFrame();
    inFlight.flushFrame();
    inFlight.controller.reset();

    expect(inFlight.list.scrollToOffset).toHaveBeenCalledWith({
      offset: 128,
      animated: false,
    });
    expect(inFlight.timeoutCallbacks.size).toBe(0);

    inFlight.scrollNode.dispatchEvent(new Event("scrollend"));
    expect(inFlight.list.scrollToOffset).toHaveBeenCalledTimes(1);
  });
});
