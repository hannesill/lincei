/**
 * Single Zustand store for terminal UI state keyed by scoped session identity.
 *
 * Terminal transition helpers are intentionally private to keep the public
 * API constrained to store actions/selectors.
 */

import { parseScopedSessionKey, scopedSessionKey } from "@t3tools/client-runtime";
import { type ScopedSessionRef, type TerminalEvent } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { terminalRunningSubprocessFromEvent } from "./terminalActivity";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type SessionTerminalGroup,
} from "./types";

interface SessionTerminalState {
  terminalOpen: boolean;
  terminalHeight: number;
  terminalIds: string[];
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: SessionTerminalGroup[];
  activeTerminalGroupId: string;
}

export interface SessionTerminalLaunchContext {
  cwd: string;
  worktreePath: string | null;
}

export interface TerminalEventEntry {
  id: number;
  event: TerminalEvent;
}

const TERMINAL_STATE_STORAGE_KEY = "lincei:terminal-state:v1";
const EMPTY_TERMINAL_EVENT_ENTRIES: ReadonlyArray<TerminalEventEntry> = [];
const MAX_TERMINAL_EVENT_BUFFER = 200;

interface PersistedTerminalStateStoreState {
  terminalStateBySessionKey?: Record<string, SessionTerminalState>;
}

export function migratePersistedTerminalStateStoreState(
  persistedState: unknown,
  version: number,
): PersistedTerminalStateStoreState {
  if (version === 1 && persistedState && typeof persistedState === "object") {
    const candidate = persistedState as PersistedTerminalStateStoreState;
    const nextTerminalStateBySessionKey = Object.fromEntries(
      Object.entries(candidate.terminalStateBySessionKey ?? {}).filter(([sessionKey]) =>
        parseScopedSessionKey(sessionKey),
      ),
    );
    return { terminalStateBySessionKey: nextTerminalStateBySessionKey };
  }
  return { terminalStateBySessionKey: {} };
}

function createTerminalStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  const ids = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

function fallbackGroupId(terminalId: string): string {
  return `group-${terminalId}`;
}

function assignUniqueGroupId(baseId: string, usedGroupIds: Set<string>): string {
  let candidate = baseId;
  let index = 2;
  while (usedGroupIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  usedGroupIds.add(candidate);
  return candidate;
}

function findGroupIndexByTerminalId(
  terminalGroups: SessionTerminalGroup[],
  terminalId: string,
): number {
  return terminalGroups.findIndex((group) => group.terminalIds.includes(terminalId));
}

function normalizeTerminalGroupIds(terminalIds: string[]): string[] {
  return [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
}

function normalizeTerminalGroups(
  terminalGroups: SessionTerminalGroup[],
  terminalIds: string[],
): SessionTerminalGroup[] {
  const validTerminalIdSet = new Set(terminalIds);
  const assignedTerminalIds = new Set<string>();
  const nextGroups: SessionTerminalGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const group of terminalGroups) {
    const groupTerminalIds = normalizeTerminalGroupIds(group.terminalIds).filter((terminalId) => {
      if (!validTerminalIdSet.has(terminalId)) return false;
      if (assignedTerminalIds.has(terminalId)) return false;
      return true;
    });
    if (groupTerminalIds.length === 0) continue;
    for (const terminalId of groupTerminalIds) {
      assignedTerminalIds.add(terminalId);
    }
    const baseGroupId =
      group.id.trim().length > 0
        ? group.id.trim()
        : fallbackGroupId(groupTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
    nextGroups.push({
      id: assignUniqueGroupId(baseGroupId, usedGroupIds),
      terminalIds: groupTerminalIds,
    });
  }

  for (const terminalId of terminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextGroups.push({
      id: assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
      terminalIds: [terminalId],
    });
  }

  if (nextGroups.length === 0) {
    return [
      {
        id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      },
    ];
  }

  return nextGroups;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function terminalGroupsEqual(left: SessionTerminalGroup[], right: SessionTerminalGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftGroup = left[index];
    const rightGroup = right[index];
    if (!leftGroup || !rightGroup) return false;
    if (leftGroup.id !== rightGroup.id) return false;
    if (!arraysEqual(leftGroup.terminalIds, rightGroup.terminalIds)) return false;
  }
  return true;
}

function sessionTerminalStateEqual(
  left: SessionTerminalState,
  right: SessionTerminalState,
): boolean {
  return (
    left.terminalOpen === right.terminalOpen &&
    left.terminalHeight === right.terminalHeight &&
    left.activeTerminalId === right.activeTerminalId &&
    left.activeTerminalGroupId === right.activeTerminalGroupId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds) &&
    terminalGroupsEqual(left.terminalGroups, right.terminalGroups)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: SessionTerminalState = Object.freeze({
  terminalOpen: false,
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  runningTerminalIds: [],
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
  terminalGroups: [
    {
      id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
    },
  ],
  activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
});

function createDefaultSessionTerminalState(): SessionTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
    terminalGroups: copyTerminalGroups(DEFAULT_THREAD_TERMINAL_STATE.terminalGroups),
  };
}

function getDefaultSessionTerminalState(): SessionTerminalState {
  return DEFAULT_THREAD_TERMINAL_STATE;
}

function normalizeSessionTerminalState(state: SessionTerminalState): SessionTerminalState {
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds.length > 0 ? terminalIds : [DEFAULT_THREAD_TERMINAL_ID];
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalGroups = normalizeTerminalGroups(state.terminalGroups, nextTerminalIds);
  const activeGroupIdFromState = terminalGroups.some(
    (group) => group.id === state.activeTerminalGroupId,
  )
    ? state.activeTerminalGroupId
    : null;
  const activeGroupIdFromTerminal =
    terminalGroups.find((group) => group.terminalIds.includes(activeTerminalId))?.id ?? null;

  const normalized: SessionTerminalState = {
    terminalOpen: state.terminalOpen,
    terminalHeight:
      Number.isFinite(state.terminalHeight) && state.terminalHeight > 0
        ? state.terminalHeight
        : DEFAULT_THREAD_TERMINAL_HEIGHT,
    terminalIds: nextTerminalIds,
    runningTerminalIds,
    activeTerminalId,
    terminalGroups,
    activeTerminalGroupId:
      activeGroupIdFromState ??
      activeGroupIdFromTerminal ??
      terminalGroups[0]?.id ??
      fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
  };
  return sessionTerminalStateEqual(state, normalized) ? state : normalized;
}

function isDefaultSessionTerminalState(state: SessionTerminalState): boolean {
  const normalized = normalizeSessionTerminalState(state);
  return sessionTerminalStateEqual(normalized, DEFAULT_THREAD_TERMINAL_STATE);
}

function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}

function terminalSessionKey(sessionRef: ScopedSessionRef): string {
  return scopedSessionKey(sessionRef);
}

function terminalEventBufferKey(sessionRef: ScopedSessionRef, terminalId: string): string {
  return `${terminalSessionKey(sessionRef)}\u0000${terminalId}`;
}

function copyTerminalGroups(groups: SessionTerminalGroup[]): SessionTerminalGroup[] {
  return groups.map((group) => ({
    id: group.id,
    terminalIds: [...group.terminalIds],
  }));
}

function appendTerminalEventEntry(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  nextTerminalEventId: number,
  sessionRef: ScopedSessionRef,
  event: TerminalEvent,
) {
  const key = terminalEventBufferKey(sessionRef, event.terminalId);
  const currentEntries = terminalEventEntriesByKey[key] ?? EMPTY_TERMINAL_EVENT_ENTRIES;
  const nextEntry: TerminalEventEntry = {
    id: nextTerminalEventId,
    event,
  };
  const nextEntries =
    currentEntries.length >= MAX_TERMINAL_EVENT_BUFFER
      ? [...currentEntries.slice(1), nextEntry]
      : [...currentEntries, nextEntry];

  return {
    terminalEventEntriesByKey: {
      ...terminalEventEntriesByKey,
      [key]: nextEntries,
    },
    nextTerminalEventId: nextTerminalEventId + 1,
  };
}

function launchContextFromStartEvent(
  event: Extract<TerminalEvent, { type: "started" | "restarted" }>,
): SessionTerminalLaunchContext {
  return {
    cwd: event.snapshot.cwd,
    worktreePath: event.snapshot.worktreePath,
  };
}

function upsertTerminalIntoGroups(
  state: SessionTerminalState,
  terminalId: string,
  mode: "split" | "new",
): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (!isValidTerminalId(terminalId)) {
    return normalized;
  }

  const isNewTerminal = !normalized.terminalIds.includes(terminalId);
  const terminalIds = isNewTerminal
    ? [...normalized.terminalIds, terminalId]
    : normalized.terminalIds;
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);

  const existingGroupIndex = findGroupIndexByTerminalId(terminalGroups, terminalId);
  if (existingGroupIndex >= 0) {
    terminalGroups[existingGroupIndex]!.terminalIds = terminalGroups[
      existingGroupIndex
    ]!.terminalIds.filter((id) => id !== terminalId);
    if (terminalGroups[existingGroupIndex]!.terminalIds.length === 0) {
      terminalGroups.splice(existingGroupIndex, 1);
    }
  }

  if (mode === "new") {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds);
    terminalGroups.push({ id: nextGroupId, terminalIds: [terminalId] });
    return normalizeSessionTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds,
      activeTerminalId: terminalId,
      terminalGroups,
      activeTerminalGroupId: nextGroupId,
    });
  }

  let activeGroupIndex = terminalGroups.findIndex(
    (group) => group.id === normalized.activeTerminalGroupId,
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(
      fallbackGroupId(normalized.activeTerminalId),
      usedGroupIds,
    );
    terminalGroups.push({ id: nextGroupId, terminalIds: [normalized.activeTerminalId] });
    activeGroupIndex = terminalGroups.length - 1;
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }

  if (
    isNewTerminal &&
    !destinationGroup.terminalIds.includes(terminalId) &&
    destinationGroup.terminalIds.length >= MAX_TERMINALS_PER_GROUP
  ) {
    return normalized;
  }

  if (!destinationGroup.terminalIds.includes(terminalId)) {
    const anchorIndex = destinationGroup.terminalIds.indexOf(normalized.activeTerminalId);
    if (anchorIndex >= 0) {
      destinationGroup.terminalIds.splice(anchorIndex + 1, 0, terminalId);
    } else {
      destinationGroup.terminalIds.push(terminalId);
    }
  }

  return normalizeSessionTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: destinationGroup.id,
  });
}

function setSessionTerminalOpen(state: SessionTerminalState, open: boolean): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (normalized.terminalOpen === open) return normalized;
  return { ...normalized, terminalOpen: open };
}

function setSessionTerminalHeight(
  state: SessionTerminalState,
  height: number,
): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (!Number.isFinite(height) || height <= 0 || normalized.terminalHeight === height) {
    return normalized;
  }
  return { ...normalized, terminalHeight: height };
}

function splitSessionTerminal(
  state: SessionTerminalState,
  terminalId: string,
): SessionTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split");
}

function newSessionTerminal(state: SessionTerminalState, terminalId: string): SessionTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "new");
}

function setSessionActiveTerminal(
  state: SessionTerminalState,
  terminalId: string,
): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const activeTerminalGroupId =
    normalized.terminalGroups.find((group) => group.terminalIds.includes(terminalId))?.id ??
    normalized.activeTerminalGroupId;
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.activeTerminalGroupId === activeTerminalGroupId
  ) {
    return normalized;
  }
  return {
    ...normalized,
    activeTerminalId: terminalId,
    activeTerminalGroupId,
  };
}

function closeSessionTerminal(
  state: SessionTerminalState,
  terminalId: string,
): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    return createDefaultSessionTerminalState();
  }

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        remainingTerminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;

  const terminalGroups = normalized.terminalGroups
    .map((group) => ({
      ...group,
      terminalIds: group.terminalIds.filter((id) => id !== terminalId),
    }))
    .filter((group) => group.terminalIds.length > 0);

  const nextActiveTerminalGroupId =
    terminalGroups.find((group) => group.terminalIds.includes(nextActiveTerminalId))?.id ??
    terminalGroups[0]?.id ??
    fallbackGroupId(nextActiveTerminalId);

  return normalizeSessionTerminalState({
    terminalOpen: normalized.terminalOpen,
    terminalHeight: normalized.terminalHeight,
    terminalIds: remainingTerminalIds,
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    activeTerminalId: nextActiveTerminalId,
    terminalGroups,
    activeTerminalGroupId: nextActiveTerminalGroupId,
  });
}

function setSessionTerminalActivity(
  state: SessionTerminalState,
  terminalId: string,
  hasRunningSubprocess: boolean,
): SessionTerminalState {
  const normalized = normalizeSessionTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  if (hasRunningSubprocess === alreadyRunning) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  return { ...normalized, runningTerminalIds: [...runningTerminalIds] };
}

export function selectSessionTerminalState(
  terminalStateBySessionKey: Record<string, SessionTerminalState>,
  sessionRef: ScopedSessionRef | null | undefined,
): SessionTerminalState {
  if (!sessionRef || sessionRef.sessionId.length === 0) {
    return getDefaultSessionTerminalState();
  }
  return (
    terminalStateBySessionKey[terminalSessionKey(sessionRef)] ?? getDefaultSessionTerminalState()
  );
}

function updateTerminalStateBySessionKey(
  terminalStateBySessionKey: Record<string, SessionTerminalState>,
  sessionRef: ScopedSessionRef,
  updater: (state: SessionTerminalState) => SessionTerminalState,
): Record<string, SessionTerminalState> {
  if (sessionRef.sessionId.length === 0) {
    return terminalStateBySessionKey;
  }

  const sessionKey = terminalSessionKey(sessionRef);
  const current = selectSessionTerminalState(terminalStateBySessionKey, sessionRef);
  const next = updater(current);
  if (next === current) {
    return terminalStateBySessionKey;
  }

  if (isDefaultSessionTerminalState(next)) {
    if (terminalStateBySessionKey[sessionKey] === undefined) {
      return terminalStateBySessionKey;
    }
    const { [sessionKey]: _removed, ...rest } = terminalStateBySessionKey;
    return rest;
  }

  return {
    ...terminalStateBySessionKey,
    [sessionKey]: next,
  };
}

export function selectTerminalEventEntries(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  sessionRef: ScopedSessionRef | null | undefined,
  terminalId: string,
): ReadonlyArray<TerminalEventEntry> {
  if (!sessionRef || sessionRef.sessionId.length === 0 || terminalId.trim().length === 0) {
    return EMPTY_TERMINAL_EVENT_ENTRIES;
  }
  return (
    terminalEventEntriesByKey[terminalEventBufferKey(sessionRef, terminalId)] ??
    EMPTY_TERMINAL_EVENT_ENTRIES
  );
}

interface TerminalStateStoreState {
  terminalStateBySessionKey: Record<string, SessionTerminalState>;
  terminalLaunchContextBySessionKey: Record<string, SessionTerminalLaunchContext>;
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>;
  nextTerminalEventId: number;
  setTerminalOpen: (sessionRef: ScopedSessionRef, open: boolean) => void;
  setTerminalHeight: (sessionRef: ScopedSessionRef, height: number) => void;
  splitTerminal: (sessionRef: ScopedSessionRef, terminalId: string) => void;
  newTerminal: (sessionRef: ScopedSessionRef, terminalId: string) => void;
  ensureTerminal: (
    sessionRef: ScopedSessionRef,
    terminalId: string,
    options?: { open?: boolean; active?: boolean },
  ) => void;
  setActiveTerminal: (sessionRef: ScopedSessionRef, terminalId: string) => void;
  closeTerminal: (sessionRef: ScopedSessionRef, terminalId: string) => void;
  setTerminalLaunchContext: (
    sessionRef: ScopedSessionRef,
    context: SessionTerminalLaunchContext,
  ) => void;
  clearTerminalLaunchContext: (sessionRef: ScopedSessionRef) => void;
  setTerminalActivity: (
    sessionRef: ScopedSessionRef,
    terminalId: string,
    hasRunningSubprocess: boolean,
  ) => void;
  recordTerminalEvent: (sessionRef: ScopedSessionRef, event: TerminalEvent) => void;
  applyTerminalEvent: (sessionRef: ScopedSessionRef, event: TerminalEvent) => void;
  clearTerminalState: (sessionRef: ScopedSessionRef) => void;
  removeTerminalState: (sessionRef: ScopedSessionRef) => void;
  removeOrphanedTerminalStates: (activeSessionKeys: Set<string>) => void;
}

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        sessionRef: ScopedSessionRef,
        updater: (state: SessionTerminalState) => SessionTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateBySessionKey = updateTerminalStateBySessionKey(
            state.terminalStateBySessionKey,
            sessionRef,
            updater,
          );
          if (nextTerminalStateBySessionKey === state.terminalStateBySessionKey) {
            return state;
          }
          return {
            terminalStateBySessionKey: nextTerminalStateBySessionKey,
          };
        });
      };

      return {
        terminalStateBySessionKey: {},
        terminalLaunchContextBySessionKey: {},
        terminalEventEntriesByKey: {},
        nextTerminalEventId: 1,
        setTerminalOpen: (sessionRef, open) =>
          updateTerminal(sessionRef, (state) => setSessionTerminalOpen(state, open)),
        setTerminalHeight: (sessionRef, height) =>
          updateTerminal(sessionRef, (state) => setSessionTerminalHeight(state, height)),
        splitTerminal: (sessionRef, terminalId) =>
          updateTerminal(sessionRef, (state) => splitSessionTerminal(state, terminalId)),
        newTerminal: (sessionRef, terminalId) =>
          updateTerminal(sessionRef, (state) => newSessionTerminal(state, terminalId)),
        ensureTerminal: (sessionRef, terminalId, options) =>
          updateTerminal(sessionRef, (state) => {
            let nextState = state;
            if (!state.terminalIds.includes(terminalId)) {
              nextState = newSessionTerminal(nextState, terminalId);
            }
            if (options?.active === false) {
              nextState = {
                ...nextState,
                activeTerminalId: state.activeTerminalId,
                activeTerminalGroupId: state.activeTerminalGroupId,
              };
            }
            if (options?.active ?? true) {
              nextState = setSessionActiveTerminal(nextState, terminalId);
            }
            if (options?.open) {
              nextState = setSessionTerminalOpen(nextState, true);
            }
            return normalizeSessionTerminalState(nextState);
          }),
        setActiveTerminal: (sessionRef, terminalId) =>
          updateTerminal(sessionRef, (state) => setSessionActiveTerminal(state, terminalId)),
        closeTerminal: (sessionRef, terminalId) =>
          updateTerminal(sessionRef, (state) => closeSessionTerminal(state, terminalId)),
        setTerminalLaunchContext: (sessionRef, context) =>
          set((state) => ({
            terminalLaunchContextBySessionKey: {
              ...state.terminalLaunchContextBySessionKey,
              [terminalSessionKey(sessionRef)]: context,
            },
          })),
        clearTerminalLaunchContext: (sessionRef) =>
          set((state) => {
            const sessionKey = terminalSessionKey(sessionRef);
            if (!state.terminalLaunchContextBySessionKey[sessionKey]) {
              return state;
            }
            const { [sessionKey]: _removed, ...rest } = state.terminalLaunchContextBySessionKey;
            return { terminalLaunchContextBySessionKey: rest };
          }),
        setTerminalActivity: (sessionRef, terminalId, hasRunningSubprocess) =>
          updateTerminal(sessionRef, (state) =>
            setSessionTerminalActivity(state, terminalId, hasRunningSubprocess),
          ),
        recordTerminalEvent: (sessionRef, event) =>
          set((state) =>
            appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              sessionRef,
              event,
            ),
          ),
        applyTerminalEvent: (sessionRef, event) =>
          set((state) => {
            const sessionKey = terminalSessionKey(sessionRef);
            let nextTerminalStateBySessionKey = state.terminalStateBySessionKey;
            let nextTerminalLaunchContextBySessionKey = state.terminalLaunchContextBySessionKey;

            if (event.type === "started" || event.type === "restarted") {
              nextTerminalStateBySessionKey = updateTerminalStateBySessionKey(
                nextTerminalStateBySessionKey,
                sessionRef,
                (current) => {
                  let nextState = current;
                  if (!current.terminalIds.includes(event.terminalId)) {
                    nextState = newSessionTerminal(nextState, event.terminalId);
                  }
                  nextState = setSessionActiveTerminal(nextState, event.terminalId);
                  nextState = setSessionTerminalOpen(nextState, true);
                  return normalizeSessionTerminalState(nextState);
                },
              );
              nextTerminalLaunchContextBySessionKey = {
                ...nextTerminalLaunchContextBySessionKey,
                [sessionKey]: launchContextFromStartEvent(event),
              };
            }

            const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
            if (hasRunningSubprocess !== null) {
              nextTerminalStateBySessionKey = updateTerminalStateBySessionKey(
                nextTerminalStateBySessionKey,
                sessionRef,
                (current) =>
                  setSessionTerminalActivity(current, event.terminalId, hasRunningSubprocess),
              );
            }

            const nextEventState = appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              sessionRef,
              event,
            );

            return {
              terminalStateBySessionKey: nextTerminalStateBySessionKey,
              terminalLaunchContextBySessionKey: nextTerminalLaunchContextBySessionKey,
              ...nextEventState,
            };
          }),
        clearTerminalState: (sessionRef) =>
          set((state) => {
            const sessionKey = terminalSessionKey(sessionRef);
            const nextTerminalStateBySessionKey = updateTerminalStateBySessionKey(
              state.terminalStateBySessionKey,
              sessionRef,
              () => createDefaultSessionTerminalState(),
            );
            const hadLaunchContext =
              state.terminalLaunchContextBySessionKey[sessionKey] !== undefined;
            const { [sessionKey]: _removed, ...remainingLaunchContexts } =
              state.terminalLaunchContextBySessionKey;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${sessionKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              nextTerminalStateBySessionKey === state.terminalStateBySessionKey &&
              !hadLaunchContext &&
              !removedEventEntries
            ) {
              return state;
            }
            return {
              terminalStateBySessionKey: nextTerminalStateBySessionKey,
              terminalLaunchContextBySessionKey: remainingLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeTerminalState: (sessionRef) =>
          set((state) => {
            const sessionKey = terminalSessionKey(sessionRef);
            const hadTerminalState = state.terminalStateBySessionKey[sessionKey] !== undefined;
            const hadLaunchContext =
              state.terminalLaunchContextBySessionKey[sessionKey] !== undefined;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${sessionKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (!hadTerminalState && !hadLaunchContext && !removedEventEntries) {
              return state;
            }
            const nextTerminalStateBySessionKey = { ...state.terminalStateBySessionKey };
            delete nextTerminalStateBySessionKey[sessionKey];
            const nextLaunchContexts = { ...state.terminalLaunchContextBySessionKey };
            delete nextLaunchContexts[sessionKey];
            return {
              terminalStateBySessionKey: nextTerminalStateBySessionKey,
              terminalLaunchContextBySessionKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeOrphanedTerminalStates: (activeSessionKeys) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateBySessionKey).filter(
              (key) => !activeSessionKeys.has(key),
            );
            const orphanedLaunchContextIds = Object.keys(
              state.terminalLaunchContextBySessionKey,
            ).filter((key) => !activeSessionKeys.has(key));
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              const [sessionKey] = key.split("\u0000");
              if (sessionKey && !activeSessionKeys.has(sessionKey)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              orphanedIds.length === 0 &&
              orphanedLaunchContextIds.length === 0 &&
              !removedEventEntries
            ) {
              return state;
            }
            const next = { ...state.terminalStateBySessionKey };
            for (const id of orphanedIds) {
              delete next[id];
            }
            const nextLaunchContexts = { ...state.terminalLaunchContextBySessionKey };
            for (const id of orphanedLaunchContextIds) {
              delete nextLaunchContexts[id];
            }
            return {
              terminalStateBySessionKey: next,
              terminalLaunchContextBySessionKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(createTerminalStateStorage),
      migrate: migratePersistedTerminalStateStoreState,
      partialize: (state) => ({
        terminalStateBySessionKey: state.terminalStateBySessionKey,
      }),
    },
  ),
);
