/**
 * Zustand store for sidebar session multi-selection state.
 *
 * Supports Cmd/Ctrl+Click (toggle individual), Shift+Click (range select),
 * and bulk actions on the selected set.
 */
import { create } from "zustand";

export interface SessionSelectionState {
  /** Currently selected scoped session keys. */
  selectedSessionKeys: ReadonlySet<string>;
  /** The scoped session key that anchors shift-click range selection. */
  anchorSessionKey: string | null;
}

interface SessionSelectionStore extends SessionSelectionState {
  /** Toggle a single scoped session key in the selection (Cmd/Ctrl+Click). */
  toggleSession: (sessionKey: string) => void;
  /**
   * Select a range of sessions (Shift+Click).
   * Requires the ordered list of scoped session keys within the same project
   * so the store can compute which sessions fall between anchor and target.
   */
  rangeSelectTo: (sessionKey: string, orderedSessionKeys: readonly string[]) => void;
  /** Clear all selection state. */
  clearSelection: () => void;
  /** Remove specific scoped session keys from the selection (e.g. after deletion). */
  removeFromSelection: (sessionKeys: readonly string[]) => void;
  /** Set the anchor session without adding it to the selection (e.g. on plain-click navigate). */
  setAnchor: (sessionKey: string) => void;
  /** Check if any sessions are selected. */
  hasSelection: () => boolean;
}

const EMPTY_SET = new Set<string>();

export const useSessionSelectionStore = create<SessionSelectionStore>((set, get) => ({
  selectedSessionKeys: EMPTY_SET,
  anchorSessionKey: null,

  toggleSession: (sessionKey) => {
    set((state) => {
      const next = new Set(state.selectedSessionKeys);
      if (next.has(sessionKey)) {
        next.delete(sessionKey);
      } else {
        next.add(sessionKey);
      }
      return {
        selectedSessionKeys: next,
        anchorSessionKey: next.has(sessionKey) ? sessionKey : state.anchorSessionKey,
      };
    });
  },

  rangeSelectTo: (sessionKey, orderedSessionKeys) => {
    set((state) => {
      const anchor = state.anchorSessionKey;
      if (anchor === null) {
        // No anchor yet — treat as a single toggle
        const next = new Set(state.selectedSessionKeys);
        next.add(sessionKey);
        return { selectedSessionKeys: next, anchorSessionKey: sessionKey };
      }

      const anchorIndex = orderedSessionKeys.indexOf(anchor);
      const targetIndex = orderedSessionKeys.indexOf(sessionKey);
      if (anchorIndex === -1 || targetIndex === -1) {
        // Anchor or target not in this list (different project?) — fallback to toggle
        const next = new Set(state.selectedSessionKeys);
        next.add(sessionKey);
        return { selectedSessionKeys: next, anchorSessionKey: sessionKey };
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const next = new Set(state.selectedSessionKeys);
      for (let i = start; i <= end; i++) {
        const key = orderedSessionKeys[i];
        if (key !== undefined) {
          next.add(key);
        }
      }
      // Keep anchor stable so subsequent shift-clicks extend from the same point
      return { selectedSessionKeys: next, anchorSessionKey: anchor };
    });
  },

  clearSelection: () => {
    const state = get();
    if (state.selectedSessionKeys.size === 0 && state.anchorSessionKey === null) return;
    set({ selectedSessionKeys: EMPTY_SET, anchorSessionKey: null });
  },

  setAnchor: (sessionKey) => {
    if (get().anchorSessionKey === sessionKey) return;
    set({ anchorSessionKey: sessionKey });
  },

  removeFromSelection: (sessionKeys) => {
    set((state) => {
      const toRemove = new Set(sessionKeys);
      let changed = false;
      const next = new Set<string>();
      for (const key of state.selectedSessionKeys) {
        if (toRemove.has(key)) {
          changed = true;
        } else {
          next.add(key);
        }
      }
      if (!changed) return state;
      const newAnchor =
        state.anchorSessionKey !== null && toRemove.has(state.anchorSessionKey)
          ? null
          : state.anchorSessionKey;
      return { selectedSessionKeys: next, anchorSessionKey: newAnchor };
    });
  },

  hasSelection: () => get().selectedSessionKeys.size > 0,
}));
