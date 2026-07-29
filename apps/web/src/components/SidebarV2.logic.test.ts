import { scopeSessionRef, scopedSessionKey } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId, SessionId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  canDispatchSessionLifecycleAction,
  pageSessionsWithRouteRetention,
  parkedSessionsVisibleWhenCollapsed,
  partitionSidebarV2Sessions,
  resolveParkedSessionComposerState,
  resolveSidebarV2NewSessionOptions,
  sessionsRequiringChangeRequestObservation,
  sidebarV2SessionRowKey,
  shouldNavigateAfterSidebarV2ProjectDelete,
} from "./SidebarV2.logic";
import type { SidebarSessionSummary } from "../types";

const environmentId = EnvironmentId.make("environment");

function makeSession(
  id: string,
  overrides: Partial<SidebarSessionSummary> = {},
): SidebarSessionSummary {
  return {
    id: SessionId.make(id),
    environmentId,
    projectId: ProjectId.make("project"),
    title: id,
    interactionMode: "default",
    workflowId: null,
    workflowVersion: null,
    session: null,
    createdAt: `2026-07-29T0${id.length}:00:00.000Z`,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    updatedAt: "2026-07-29T08:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: "2026-07-29T08:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingRequestRaisedAt: null,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("Sidebar v2 lifecycle partition", () => {
  it("keeps archived, snoozed, settled, and active semantics distinct", () => {
    const result = partitionSidebarV2Sessions({
      sessions: [
        makeSession("active"),
        makeSession("settled", {
          settledOverride: "settled",
          settledAt: "2026-07-29T09:00:00.000Z",
        }),
        makeSession("snoozed", {
          settledOverride: "settled",
          settledAt: "2026-07-29T09:00:00.000Z",
          snoozedAt: "2026-07-29T09:00:00.000Z",
          snoozedUntil: "2026-07-30T09:00:00.000Z",
        }),
        makeSession("archived", {
          archivedAt: "2026-07-29T09:00:00.000Z",
        }),
      ],
      now: "2026-07-29T10:00:00.000Z",
      autoSettleAfterDays: null,
      settlementSupported: () => true,
      snoozeSupported: () => true,
    });

    expect(result.active.map((session) => session.title)).toEqual(["active"]);
    expect(result.snoozed.map((session) => session.title)).toEqual(["snoozed"]);
    expect(result.settled.map((session) => session.title)).toEqual(["settled"]);
  });

  it("settles merged change requests immediately without an age guard", () => {
    const merged = makeSession("merged");
    const result = partitionSidebarV2Sessions({
      sessions: [merged],
      now: "2026-07-29T10:00:00.000Z",
      autoSettleAfterDays: null,
      changeRequestStateBySessionKey: new Map([
        [scopedSessionKey(scopeSessionRef(environmentId, merged.id)), "merged"],
      ]),
      settlementSupported: () => true,
      snoozeSupported: () => true,
    });

    expect(result.settled).toEqual([merged]);
  });

  it("keeps a deep-linked parked session visible through a collapsed shelf", () => {
    const parked = makeSession("parked");
    expect(
      parkedSessionsVisibleWhenCollapsed({
        sessions: [parked],
        expanded: false,
        routeSessionRef: {
          environmentId,
          sessionId: parked.id,
        },
      }),
    ).toEqual([parked]);
  });

  it("retains a deep-linked settled session beyond the visible page", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => makeSession(`settled-${index}`));

    expect(
      pageSessionsWithRouteRetention({
        sessions,
        visibleCount: 10,
        routeSessionRef: scopeSessionRef(environmentId, sessions[11]!.id),
      }).map((session) => session.id),
    ).toEqual([...sessions.slice(0, 10), sessions[11]].map((session) => session!.id));
  });

  it("keeps active change-request settlement live while a project is collapsed", () => {
    const branch = makeSession("branch", { branch: "feature" });
    const observed = sessionsRequiringChangeRequestObservation({
      active: [branch],
      visibleSnoozed: [],
      visibleSettled: [],
    });
    const partition = partitionSidebarV2Sessions({
      sessions: [branch],
      now: "2026-07-29T10:00:00.000Z",
      autoSettleAfterDays: null,
      changeRequestStateBySessionKey: new Map([[sidebarV2SessionRowKey(branch), "merged"]]),
      settlementSupported: () => true,
      snoozeSupported: () => true,
    });

    expect(observed).toEqual([branch]);
    expect(partition.settled).toEqual([branch]);
  });

  it("bounds historical parked observers and restores them when rows become visible", () => {
    const active = makeSession("active", { branch: "active" });
    const visibleSettled = makeSession("visible-settled", { branch: "visible" });
    const hiddenSettled = makeSession("hidden-settled", { branch: "hidden" });

    expect(
      sessionsRequiringChangeRequestObservation({
        active: [active],
        visibleSnoozed: [],
        visibleSettled: [visibleSettled],
      }),
    ).toEqual([active, visibleSettled]);
    expect(
      sessionsRequiringChangeRequestObservation({
        active: [active],
        visibleSnoozed: [],
        visibleSettled: [visibleSettled, hiddenSettled],
      }),
    ).toEqual([active, visibleSettled, hiddenSettled]);
  });

  it("keeps row identity scoped to the session across section transitions", () => {
    const session = makeSession("moving");
    expect(sidebarV2SessionRowKey(session)).toBe(
      scopedSessionKey(scopeSessionRef(environmentId, session.id)),
    );
  });

  it("navigates away only when project deletion still targets the captured route", () => {
    const deletedProjectRef = {
      environmentId,
      projectId: ProjectId.make("project"),
    };
    const routeBeforeDelete = {
      routeKey: "server:environment:session",
      projectRef: deletedProjectRef,
    };

    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete,
        routeKeyAfterDelete: routeBeforeDelete.routeKey,
      }),
    ).toBe(true);
    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete,
        routeKeyAfterDelete: "draft:new-route",
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete: {
          ...routeBeforeDelete,
          projectRef: {
            environmentId,
            projectId: ProjectId.make("another-project"),
          },
        },
        routeKeyAfterDelete: routeBeforeDelete.routeKey,
      }),
    ).toBe(false);
  });

  it("gates lifecycle dispatch at the action boundary", () => {
    const session = makeSession("gated");
    expect(
      canDispatchSessionLifecycleAction({
        action: "settle",
        session,
        now: "2026-07-29T10:00:00.000Z",
        settlementSupported: false,
        snoozeSupported: true,
      }),
    ).toBe(false);
    expect(
      canDispatchSessionLifecycleAction({
        action: "snooze",
        session: makeSession("blocked", { hasPendingApprovals: true }),
        now: "2026-07-29T10:00:00.000Z",
        settlementSupported: true,
        snoozeSupported: true,
      }),
    ).toBe(false);
  });

  it("parks the composer without conflating snoozed, settled, and archived sessions", () => {
    const now = "2026-07-29T10:00:00.000Z";
    expect(
      resolveParkedSessionComposerState({
        session: makeSession("snoozed-and-settled", {
          settledOverride: "settled",
          snoozedAt: "2026-07-29T09:00:00.000Z",
          snoozedUntil: "2026-07-30T09:00:00.000Z",
        }),
        now,
        autoSettleAfterDays: null,
        settlementSupported: true,
        snoozeSupported: true,
      }),
    ).toBe("snoozed");
    expect(
      resolveParkedSessionComposerState({
        session: makeSession("settled", { settledOverride: "settled" }),
        now,
        autoSettleAfterDays: null,
        settlementSupported: true,
        snoozeSupported: true,
      }),
    ).toBe("settled");
    expect(
      resolveParkedSessionComposerState({
        session: makeSession("archived", {
          archivedAt: "2026-07-29T09:00:00.000Z",
          settledOverride: "settled",
        }),
        now,
        autoSettleAfterDays: null,
        settlementSupported: true,
        snoozeSupported: true,
      }),
    ).toBeNull();
  });

  it("uses the persisted default environment mode for project actions", () => {
    expect(resolveSidebarV2NewSessionOptions("worktree")).toEqual({
      envMode: "worktree",
      branch: null,
      worktreePath: null,
    });
  });
});
