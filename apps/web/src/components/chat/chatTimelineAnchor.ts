import { CHAT_LIST_ANCHOR_OFFSET } from "@t3tools/shared/chatList";

interface TimelineListState {
  readonly scroll: number;
}

interface TimelineListRef {
  getScrollableNode: () => HTMLElement;
  getState: () => TimelineListState;
  scrollToIndex: (options: {
    index: number;
    animated: boolean;
    viewPosition: number;
    viewOffset: number;
  }) => unknown;
  scrollToOffset: (options: { offset: number; animated: boolean }) => unknown;
}

interface TimelineAnchorScheduler {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
}

const browserScheduler: TimelineAnchorScheduler = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
};

export function createChatTimelineAnchorController<MessageId>({
  getList,
  scheduler = browserScheduler,
}: {
  readonly getList: () => TimelineListRef | null;
  readonly scheduler?: TimelineAnchorScheduler;
}) {
  let positionedMessageId: MessageId | null = null;
  let settledMessageId: MessageId | null = null;
  let firstPositionFrame: number | null = null;
  let secondPositionFrame: number | null = null;
  let restoreFrame: number | null = null;
  let pendingRestore: { readonly messageId: MessageId; readonly offset: number } | null = null;
  let activeAnimation: {
    readonly messageId: MessageId;
    cancel: () => void;
  } | null = null;

  const cancelPositionFrames = () => {
    if (firstPositionFrame !== null) {
      scheduler.cancelAnimationFrame(firstPositionFrame);
      firstPositionFrame = null;
    }
    if (secondPositionFrame !== null) {
      scheduler.cancelAnimationFrame(secondPositionFrame);
      secondPositionFrame = null;
    }
  };

  const cancelActiveAnimation = () => {
    const current = activeAnimation;
    activeAnimation = null;
    current?.cancel();
  };

  const reset = () => {
    positionedMessageId = null;
    settledMessageId = null;
    pendingRestore = null;
    cancelPositionFrames();
    cancelActiveAnimation();
    if (restoreFrame !== null) {
      scheduler.cancelAnimationFrame(restoreFrame);
      restoreFrame = null;
    }
  };

  const position = (messageId: MessageId, anchorIndex: number) => {
    if (positionedMessageId === messageId) {
      return;
    }

    cancelPositionFrames();
    cancelActiveAnimation();
    positionedMessageId = messageId;
    settledMessageId = null;

    firstPositionFrame = scheduler.requestAnimationFrame(() => {
      firstPositionFrame = null;
      secondPositionFrame = scheduler.requestAnimationFrame(() => {
        secondPositionFrame = null;
        if (positionedMessageId !== messageId) {
          return;
        }

        const list = getList();
        if (!list) {
          return;
        }

        const scrollNode = list.getScrollableNode();
        let finished = false;
        let fallbackTimer: number | null = null;
        const cleanup = () => {
          if (fallbackTimer !== null) {
            scheduler.clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          scrollNode.removeEventListener("scrollend", finishAnimatedPositioning);
        };
        const freezeCurrentOffset = () => {
          const scrollOffset = list.getState().scroll;
          void list.scrollToOffset({ offset: scrollOffset, animated: false });
        };
        const finishAnimatedPositioning = () => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();
          if (activeAnimation?.messageId === messageId) {
            activeAnimation = null;
          }
          if (positionedMessageId !== messageId) {
            return;
          }
          freezeCurrentOffset();
          settledMessageId = messageId;
        };
        const cancel = () => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();
          freezeCurrentOffset();
        };

        activeAnimation = { messageId, cancel };
        fallbackTimer = scheduler.setTimeout(finishAnimatedPositioning, 750);
        scrollNode.addEventListener("scrollend", finishAnimatedPositioning, { once: true });
        void list.scrollToIndex({
          index: anchorIndex,
          animated: true,
          viewPosition: 0,
          viewOffset: CHAT_LIST_ANCHOR_OFFSET,
        });
      });
    });
  };

  const sizeChanged = (messageId: MessageId) => {
    if (settledMessageId !== messageId) {
      return;
    }
    const scrollOffset = getList()?.getState().scroll;
    if (scrollOffset === undefined) {
      return;
    }
    if (pendingRestore === null) {
      pendingRestore = { messageId, offset: scrollOffset };
    }
    if (restoreFrame !== null) {
      return;
    }
    restoreFrame = scheduler.requestAnimationFrame(() => {
      restoreFrame = null;
      const pending = pendingRestore;
      pendingRestore = null;
      if (pending && settledMessageId === pending.messageId) {
        void getList()?.scrollToOffset({ offset: pending.offset, animated: false });
      }
    });
  };

  return {
    position,
    reset,
    sizeChanged,
  };
}
