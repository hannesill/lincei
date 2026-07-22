/**
 * In-memory PreviewManager implementation.
 *
 * Sessions are keyed by `(sessionId, tabId)`; a single thread can host
 * multiple tabs (browser-style). `open` always creates a new tab — tab
 * lifecycle is owned by the renderer.
 *
 * Events are published via Effect's `PubSub`, so subscriber failures are
 * isolated from the publishing call (a closed WS subscriber queue cannot
 * fail an in-progress `navigate()`).
 */
import {
  type PreviewEvent,
  PreviewInvalidUrlError,
  type PreviewListResult,
  PreviewSessionLookupError,
  type PreviewSessionSnapshot,
  type SessionId,
} from "@t3tools/contracts";
import {
  isPreviewUrlNormalizationError,
  newPreviewTabId,
  normalizePreviewUrl,
} from "@t3tools/shared/preview";
import { DateTime, Effect, Layer, PubSub, Stream, SynchronizedRef } from "effect";

import { PreviewManager, type PreviewManagerShape } from "../Services/Manager.ts";

interface PreviewSessionState {
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly snapshot: PreviewSessionSnapshot;
}

interface ManagerState {
  /** All sessions across every thread, keyed by `${sessionId}\u0000${tabId}`. */
  readonly sessions: ReadonlyMap<string, PreviewSessionState>;
}

const initialState: ManagerState = { sessions: new Map() };

const compositeKey = (sessionId: SessionId, tabId: string): string => `${sessionId}\u0000${tabId}`;

const sessionsForThread = (
  state: ManagerState,
  sessionId: SessionId,
): ReadonlyArray<PreviewSessionState> => {
  const out: PreviewSessionState[] = [];
  for (const session of state.sessions.values()) {
    if (session.sessionId === sessionId) out.push(session);
  }
  return out;
};

const normalizeUrl = (rawUrl: string): Effect.Effect<string, PreviewInvalidUrlError> =>
  Effect.try({
    try: () => normalizePreviewUrl(rawUrl),
    catch: (cause) => {
      if (isPreviewUrlNormalizationError(cause)) {
        return new PreviewInvalidUrlError({
          inputLength: cause.inputLength,
          reason: cause.reason,
          protocol: cause.protocol,
          cause: cause.cause,
        });
      }
      return new PreviewInvalidUrlError({
        inputLength: rawUrl.length,
        reason: "unexpected",
        cause,
      });
    },
  });

const buildLoadingSnapshot = (input: {
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt: string;
}): PreviewSessionSnapshot => ({
  sessionId: input.sessionId,
  tabId: input.tabId,
  navStatus: { _tag: "Loading", url: input.url, title: input.title },
  canGoBack: false,
  canGoForward: false,
  updatedAt: input.updatedAt,
});

const buildIdleSnapshot = (input: {
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly updatedAt: string;
}): PreviewSessionSnapshot => ({
  sessionId: input.sessionId,
  tabId: input.tabId,
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: input.updatedAt,
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const makePreviewManager = Effect.gen(function* () {
  const stateRef = yield* SynchronizedRef.make<ManagerState>(initialState);
  // Unbounded PubSub is fine here — events are tiny and we don't want to
  // block publishers if a subscriber is slow. WS clients backpressure on
  // their own queues downstream.
  const eventsPubSub = yield* PubSub.unbounded<PreviewEvent>();
  const events: Stream.Stream<PreviewEvent> = Stream.fromPubSub(eventsPubSub);

  /**
   * Atomic read-modify-write over the session for `(sessionId, tabId)`. The
   * mutator runs under the SynchronizedRef so concurrent writers cannot
   * interleave. Lookup failures travel through the modify result so both
   * branches yield the same `[A, S]` shape `modifyEffect` requires.
   *
   * The event is published INSIDE the lock so observers see events in the
   * same order as the underlying state transitions. Publishing an unbounded
   * PubSub is non-blocking, so this is cheap.
   */
  const mutateExistingSession = <R, E>(
    sessionId: SessionId,
    tabId: string,
    mutator: (
      session: PreviewSessionState,
    ) => Effect.Effect<{ next: PreviewSessionState; emit: PreviewEvent | null; result: R }, E>,
  ): Effect.Effect<R, E | PreviewSessionLookupError> => {
    type ModifyResult =
      | { kind: "fail"; error: PreviewSessionLookupError }
      | { kind: "ok"; result: R };

    return SynchronizedRef.modifyEffect(stateRef, (state) => {
      const session = state.sessions.get(compositeKey(sessionId, tabId));
      if (!session) {
        return Effect.succeed([
          { kind: "fail", error: new PreviewSessionLookupError({ sessionId, tabId }) },
          state,
        ] as readonly [ModifyResult, ManagerState]);
      }
      return mutator(session).pipe(
        Effect.flatMap(({ next, emit, result }) =>
          Effect.gen(function* () {
            if (emit) yield* PubSub.publish(eventsPubSub, emit);
            const sessions = new Map(state.sessions);
            sessions.set(compositeKey(sessionId, tabId), next);
            return [{ kind: "ok", result } as ModifyResult, { sessions }] as readonly [
              ModifyResult,
              ManagerState,
            ];
          }),
        ),
      );
    }).pipe(
      Effect.flatMap((modify) =>
        modify.kind === "fail" ? Effect.fail(modify.error) : Effect.succeed(modify.result),
      ),
    );
  };

  const open: PreviewManagerShape["open"] = (input) =>
    Effect.gen(function* () {
      const tabId = newPreviewTabId();
      const updatedAt = yield* nowIso;
      const snapshot = input.url
        ? buildLoadingSnapshot({
            sessionId: input.sessionId,
            tabId,
            url: yield* normalizeUrl(input.url),
            title: "",
            updatedAt,
          })
        : buildIdleSnapshot({ sessionId: input.sessionId, tabId, updatedAt });
      yield* SynchronizedRef.update(stateRef, (state) => {
        const sessions = new Map(state.sessions);
        sessions.set(compositeKey(input.sessionId, tabId), {
          sessionId: input.sessionId,
          tabId,
          snapshot,
        });
        return { sessions };
      });
      yield* PubSub.publish(eventsPubSub, {
        type: "opened",
        sessionId: input.sessionId,
        tabId,
        createdAt: snapshot.updatedAt,
        snapshot,
      });
      return snapshot;
    });

  const navigate: PreviewManagerShape["navigate"] = (input) =>
    Effect.gen(function* () {
      const url = yield* normalizeUrl(input.url);
      return yield* mutateExistingSession(input.sessionId, input.tabId, (session) =>
        Effect.gen(function* () {
          const updatedAt = yield* nowIso;
          const previousTitle =
            session.snapshot.navStatus._tag === "Idle" ? "" : session.snapshot.navStatus.title;
          const resolvedTitle = input.resolvedTitle ?? previousTitle;
          const snapshot: PreviewSessionSnapshot = {
            sessionId: session.sessionId,
            tabId: session.tabId,
            navStatus: { _tag: "Success", url, title: resolvedTitle },
            canGoBack: session.snapshot.canGoBack,
            canGoForward: session.snapshot.canGoForward,
            updatedAt,
          };
          return {
            next: { ...session, snapshot },
            emit: {
              type: "navigated",
              sessionId: session.sessionId,
              tabId: session.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
    });

  const reportStatus: PreviewManagerShape["reportStatus"] = (input) =>
    mutateExistingSession(input.sessionId, input.tabId, (session) =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        const snapshot: PreviewSessionSnapshot = {
          sessionId: session.sessionId,
          tabId: session.tabId,
          navStatus: input.navStatus,
          canGoBack: input.canGoBack,
          canGoForward: input.canGoForward,
          updatedAt,
        };
        const emit: PreviewEvent =
          input.navStatus._tag === "LoadFailed"
            ? {
                type: "failed",
                sessionId: session.sessionId,
                tabId: session.tabId,
                createdAt: snapshot.updatedAt,
                url: input.navStatus.url,
                title: input.navStatus.title,
                code: input.navStatus.code,
                description: input.navStatus.description,
              }
            : {
                type: "navigated",
                sessionId: session.sessionId,
                tabId: session.tabId,
                createdAt: snapshot.updatedAt,
                snapshot,
              };
        return {
          next: { ...session, snapshot },
          emit,
          result: undefined as void,
        };
      }),
    );

  const refresh: PreviewManagerShape["refresh"] = (input) =>
    // Verify the session exists; the desktop bridge handles the actual reload
    // and will report progress back via `reportStatus`. No event emitted.
    mutateExistingSession(input.sessionId, input.tabId, (session) =>
      Effect.succeed({ next: session, emit: null, result: undefined as void }),
    );

  const close: PreviewManagerShape["close"] = (input) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso;
      const events = yield* SynchronizedRef.modify(stateRef, (state) => {
        const eventsToEmit: PreviewEvent[] = [];
        const sessions = new Map(state.sessions);
        const targets = input.tabId
          ? [state.sessions.get(compositeKey(input.sessionId, input.tabId))].filter(
              (entry): entry is PreviewSessionState => entry !== undefined,
            )
          : sessionsForThread(state, input.sessionId);
        for (const target of targets) {
          sessions.delete(compositeKey(target.sessionId, target.tabId));
          eventsToEmit.push({
            type: "closed",
            sessionId: target.sessionId,
            tabId: target.tabId,
            createdAt,
          });
        }
        if (eventsToEmit.length === 0) {
          return [eventsToEmit, state] as const;
        }
        return [eventsToEmit, { sessions }] as const;
      });
      if (events.length > 0) {
        yield* Effect.forEach(events, (event) => PubSub.publish(eventsPubSub, event), {
          discard: true,
        });
      }
    });

  const list: PreviewManagerShape["list"] = (input) =>
    SynchronizedRef.get(stateRef).pipe(
      Effect.map(
        (state): PreviewListResult => ({
          sessions: sessionsForThread(state, input.sessionId)
            .map((s) => s.snapshot)
            .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
        }),
      ),
    );

  return {
    open,
    navigate,
    reportStatus,
    refresh,
    close,
    list,
    events,
    subscribeEvents: PubSub.subscribe(eventsPubSub),
  } satisfies PreviewManagerShape;
});

export const PreviewManagerLive = Layer.effect(PreviewManager, makePreviewManager);
