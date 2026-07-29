import { scopeSessionRef, scopedSessionKey } from "@t3tools/client-runtime";
import { CommandId, EnvironmentId, ProjectId, SessionId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildSidebarV2ProjectDeleteCommand,
  canDispatchSessionLifecycleAction,
  completeSidebarV2ProjectDelete,
  latestSidebarV2RouteParams,
  pageSessionsWithRouteRetention,
  parkedSessionsVisibleWhenCollapsed,
  partitionSidebarV2Sessions,
  resolveParkedSessionComposerState,
  resolveSidebarV2NewSessionOptions,
  resolveSidebarV2ServerRouteProjectRef,
  sessionsRequiringChangeRequestObservation,
  sidebarV2DraftSessionKeysForProject,
  sidebarV2ProjectDeleteConfirmation,
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
    const routeAfterDelete = {
      ...routeBeforeDelete,
    };

    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete,
        routeAfterDelete,
      }),
    ).toBe(true);
    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete,
        routeAfterDelete: {
          ...routeAfterDelete,
          routeKey: "draft:new-route",
        },
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
        routeAfterDelete,
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterSidebarV2ProjectDelete({
        deletedProjectRef,
        routeBeforeDelete: {
          routeKey: "draft:retargeted",
          projectRef: deletedProjectRef,
        },
        routeAfterDelete: {
          routeKey: "draft:retargeted",
          projectRef: {
            environmentId,
            projectId: ProjectId.make("retargeted-project"),
          },
        },
      }),
    ).toBe(false);
  });

  it("uses an in-flight route instead of the last committed route", () => {
    expect(
      latestSidebarV2RouteParams({
        matches: [{ params: { draftId: "committed-draft" } }],
        pendingMatches: [
          {
            params: {
              environmentId: "pending-environment",
              sessionId: "pending-session",
            },
          },
        ],
      }),
    ).toEqual({
      environmentId: "pending-environment",
      sessionId: "pending-session",
    });
    expect(
      latestSidebarV2RouteParams({
        matches: [{ params: { draftId: "committed-draft" } }],
        pendingMatches: [],
      }),
    ).toEqual({ draftId: "committed-draft" });
  });

  it("uses detail session ownership for archived and pre-shell routes", () => {
    const archivedDetail = makeSession("archived-detail", {
      archivedAt: "2026-07-29T09:00:00.000Z",
    });

    expect(
      resolveSidebarV2ServerRouteProjectRef({
        detailSession: archivedDetail,
        sidebarSession: null,
      }),
    ).toEqual({
      environmentId,
      projectId: archivedDetail.projectId,
    });
    expect(
      resolveSidebarV2ServerRouteProjectRef({
        detailSession: archivedDetail,
        sidebarSession: makeSession("stale-shell", {
          projectId: ProjectId.make("stale-project"),
        }),
      }),
    ).toEqual({
      environmentId,
      projectId: archivedDetail.projectId,
    });
  });

  it("warns that project removal permanently deletes archived sessions", () => {
    expect(
      sidebarV2ProjectDeleteConfirmation({
        name: "Research",
        cwd: "/repo/research",
      }),
    ).toBe(
      [
        'Remove project "Research"?',
        "Path: /repo/research",
        "This permanently deletes all sessions for this project, including archived sessions.",
        "This action cannot be undone.",
      ].join("\n"),
    );
  });

  it("forces project deletion regardless of visible session inventory", () => {
    expect(
      buildSidebarV2ProjectDeleteCommand({
        commandId: CommandId.make("delete-project"),
        projectId: ProjectId.make("project"),
      }),
    ).toEqual({
      type: "project.delete",
      commandId: "delete-project",
      projectId: "project",
      force: true,
    });
  });

  it("does not clean a draft that was retargeted while deletion was pending", () => {
    const deletedProjectRef = {
      environmentId,
      projectId: ProjectId.make("deleted-project"),
    };
    const drafts = {
      deleted: {
        environmentId,
        projectId: deletedProjectRef.projectId,
      },
      retargeted: {
        environmentId,
        projectId: ProjectId.make("replacement-project"),
      },
    };

    expect(sidebarV2DraftSessionKeysForProject(drafts, deletedProjectRef)).toEqual(["deleted"]);
    expect(
      sidebarV2DraftSessionKeysForProject(
        {
          retargeted: drafts.retargeted,
        },
        deletedProjectRef,
      ),
    ).toEqual([]);
  });

  it("preserves project drafts when deletion dispatch fails", async () => {
    let cleaned = false;

    await expect(
      completeSidebarV2ProjectDelete({
        dispatchDelete: async () => {
          throw new Error("delete failed");
        },
        readRouteAfterDelete: () => "unreachable",
        cleanupDrafts: () => {
          cleaned = true;
        },
      }),
    ).rejects.toThrow("delete failed");
    expect(cleaned).toBe(false);
  });

  it("captures current ownership before cleaning drafts after successful deletion", async () => {
    const order: string[] = [];

    const routeAfterDelete = await completeSidebarV2ProjectDelete({
      dispatchDelete: async () => {
        order.push("dispatch");
      },
      readRouteAfterDelete: () => {
        order.push("route");
        return {
          routeKey: "draft:active",
          projectRef: {
            environmentId,
            projectId: ProjectId.make("project"),
          },
        };
      },
      cleanupDrafts: () => {
        order.push("cleanup");
      },
    });

    expect(order).toEqual(["dispatch", "route", "cleanup"]);
    expect(routeAfterDelete.routeKey).toBe("draft:active");
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
