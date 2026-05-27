import { SessionId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionSelectionStore } from "./sessionSelectionStore";

const THREAD_A = SessionId.make("session-a");
const THREAD_B = SessionId.make("session-b");
const THREAD_C = SessionId.make("session-c");
const THREAD_D = SessionId.make("session-d");
const THREAD_E = SessionId.make("session-e");

const ORDERED = [THREAD_A, THREAD_B, THREAD_C, THREAD_D, THREAD_E] as const;

describe("sessionSelectionStore", () => {
  beforeEach(() => {
    useSessionSelectionStore.getState().clearSelection();
  });

  describe("toggleSession", () => {
    it("adds a session to empty selection", () => {
      useSessionSelectionStore.getState().toggleSession(THREAD_A);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_A)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(1);
      expect(state.anchorSessionKey).toBe(THREAD_A);
    });

    it("removes a session that is already selected", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_A);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_A)).toBe(false);
      expect(state.selectedSessionKeys.size).toBe(0);
    });

    it("preserves existing selections when toggling a new session", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_A)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(2);
    });

    it("sets anchor to the newly added session", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);

      expect(useSessionSelectionStore.getState().anchorSessionKey).toBe(THREAD_B);
    });

    it("preserves anchor when deselecting a non-anchor session", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);
      store.toggleSession(THREAD_A); // deselect A, anchor should stay B

      expect(useSessionSelectionStore.getState().anchorSessionKey).toBe(THREAD_B);
    });
  });

  describe("setAnchor", () => {
    it("sets anchor without adding to selection", () => {
      useSessionSelectionStore.getState().setAnchor(THREAD_B);

      const state = useSessionSelectionStore.getState();
      expect(state.anchorSessionKey).toBe(THREAD_B);
      expect(state.selectedSessionKeys.size).toBe(0);
    });

    it("enables range select from a plain-click anchor", () => {
      const store = useSessionSelectionStore.getState();
      store.setAnchor(THREAD_B); // simulate plain-click navigate to B
      store.rangeSelectTo(THREAD_D, ORDERED); // shift-click D

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_D)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(3);
    });

    it("is a no-op when anchor is already set to the same session", () => {
      const store = useSessionSelectionStore.getState();
      store.setAnchor(THREAD_B);
      const stateBefore = useSessionSelectionStore.getState();
      store.setAnchor(THREAD_B);
      const stateAfter = useSessionSelectionStore.getState();

      // Should be referentially the same (no unnecessary re-render)
      expect(stateAfter).toBe(stateBefore);
    });

    it("survives clearSelection followed by setAnchor", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);
      store.clearSelection();
      store.setAnchor(THREAD_C);

      const state = useSessionSelectionStore.getState();
      expect(state.anchorSessionKey).toBe(THREAD_C);
      expect(state.selectedSessionKeys.size).toBe(0);
    });
  });

  describe("rangeSelectTo", () => {
    it("selects a single session when no anchor exists", () => {
      useSessionSelectionStore.getState().rangeSelectTo(THREAD_C, ORDERED);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(1);
      expect(state.anchorSessionKey).toBe(THREAD_C);
    });

    it("selects range from anchor to target (forward)", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_B); // sets anchor to B
      store.rangeSelectTo(THREAD_D, ORDERED);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_D)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(3);
    });

    it("selects range from anchor to target (backward)", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_D); // sets anchor to D
      store.rangeSelectTo(THREAD_B, ORDERED);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_D)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(3);
    });

    it("keeps anchor stable across multiple range selects", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_B); // anchor = B
      store.rangeSelectTo(THREAD_D, ORDERED); // selects B-D
      store.rangeSelectTo(THREAD_E, ORDERED); // extends B-E (anchor stays B)

      const state = useSessionSelectionStore.getState();
      expect(state.anchorSessionKey).toBe(THREAD_B);
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_D)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_E)).toBe(true);
    });

    it("falls back to toggle when anchor is not in the ordered list", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A); // anchor = A
      // Range-select with a list that does NOT contain the anchor
      store.rangeSelectTo(THREAD_C, [THREAD_B, THREAD_C, THREAD_D]);

      const state = useSessionSelectionStore.getState();
      // Should have added C and reset anchor to C
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.anchorSessionKey).toBe(THREAD_C);
    });

    it("falls back to toggle when target is not in the ordered list", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_B); // anchor = B
      const unknownSession = SessionId.make("session-unknown");
      store.rangeSelectTo(unknownSession, ORDERED);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(unknownSession)).toBe(true);
      expect(state.anchorSessionKey).toBe(unknownSession);
    });

    it("selects the single session when anchor equals target", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_C); // anchor = C
      store.rangeSelectTo(THREAD_C, ORDERED); // range from C to C

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(1);
    });

    it("preserves previously selected sessions outside the range", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A); // select A, anchor = A
      store.toggleSession(THREAD_B); // select B, anchor = B

      // Now shift-select from B (anchor) to D — should add B, C, D but keep A
      store.rangeSelectTo(THREAD_D, ORDERED);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_A)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_C)).toBe(true);
      expect(state.selectedSessionKeys.has(THREAD_D)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(4);
    });
  });

  describe("clearSelection", () => {
    it("clears all selected sessions and anchor", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);
      store.clearSelection();

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.size).toBe(0);
      expect(state.anchorSessionKey).toBeNull();
    });

    it("is a no-op when already empty", () => {
      const stateBefore = useSessionSelectionStore.getState();
      stateBefore.clearSelection();
      const stateAfter = useSessionSelectionStore.getState();

      // Should be referentially the same (no unnecessary re-render)
      expect(stateAfter.selectedSessionKeys).toBe(stateBefore.selectedSessionKeys);
    });
  });

  describe("removeFromSelection", () => {
    it("removes specified sessions from selection", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B);
      store.toggleSession(THREAD_C);
      store.removeFromSelection([THREAD_A, THREAD_C]);

      const state = useSessionSelectionStore.getState();
      expect(state.selectedSessionKeys.has(THREAD_B)).toBe(true);
      expect(state.selectedSessionKeys.size).toBe(1);
    });

    it("clears anchor when the anchor session is removed", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B); // anchor = B
      store.removeFromSelection([THREAD_B]);

      expect(useSessionSelectionStore.getState().anchorSessionKey).toBeNull();
    });

    it("preserves anchor when the anchor session is not removed", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.toggleSession(THREAD_B); // anchor = B
      store.removeFromSelection([THREAD_A]);

      expect(useSessionSelectionStore.getState().anchorSessionKey).toBe(THREAD_B);
    });

    it("is a no-op when none of the specified sessions are selected", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      const stateBefore = useSessionSelectionStore.getState();
      store.removeFromSelection([THREAD_B, THREAD_C]);
      const stateAfter = useSessionSelectionStore.getState();

      expect(stateAfter.selectedSessionKeys).toBe(stateBefore.selectedSessionKeys);
    });
  });

  describe("hasSelection", () => {
    it("returns false when nothing is selected", () => {
      expect(useSessionSelectionStore.getState().hasSelection()).toBe(false);
    });

    it("returns true when sessions are selected", () => {
      useSessionSelectionStore.getState().toggleSession(THREAD_A);
      expect(useSessionSelectionStore.getState().hasSelection()).toBe(true);
    });

    it("returns false after clearing selection", () => {
      const store = useSessionSelectionStore.getState();
      store.toggleSession(THREAD_A);
      store.clearSelection();
      expect(useSessionSelectionStore.getState().hasSelection()).toBe(false);
    });
  });
});
