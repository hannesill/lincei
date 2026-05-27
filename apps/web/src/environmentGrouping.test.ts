import { EnvironmentId, ProjectId, ProviderInstanceId, SessionId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { describe, expect, it } from "vitest";

import {
  selectProjectsAcrossEnvironments,
  selectSidebarSessionsAcrossEnvironments,
  selectSidebarSessionsForProjectRef,
  selectSidebarSessionsForProjectRefs,
  type AppState,
  type EnvironmentState,
} from "./store";
import {
  deriveLogicalProjectKey,
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  resolveProjectGroupingMode,
} from "./logicalProject";
import type { Project, SidebarSessionSummary } from "./types";
import { DEFAULT_INTERACTION_MODE } from "./types";

// ── Fixture Identifiers ──────────────────────────────────────────────

const primaryEnvId = EnvironmentId.make("env-primary");
const remoteEnvId = EnvironmentId.make("env-remote");

const sharedProjectPrimaryId = ProjectId.make("shared-proj-primary");
const sharedProjectRemoteId = ProjectId.make("shared-proj-remote");
const localOnlyProjectId = ProjectId.make("local-only-proj");
const remoteOnlyProjectId = ProjectId.make("remote-only-proj");

const sessionP1 = SessionId.make("session-shared-primary-1");
const sessionP2 = SessionId.make("session-shared-primary-2");
const sessionR1 = SessionId.make("session-shared-remote-1");
const sessionL1 = SessionId.make("session-local-only-1");
const sessionRO1 = SessionId.make("session-remote-only-1");

const SHARED_REPO_CANONICAL_KEY = "github.com/example/shared-repo";
const DEFAULT_GROUPING_SETTINGS = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

// ── Factory Helpers ──────────────────────────────────────────────────

function makeProject(
  overrides: Partial<Project> & Pick<Project, "id" | "environmentId" | "name">,
): Project {
  return {
    cwd: `/tmp/${overrides.name}`,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

function makeSidebarSessionSummary(
  overrides: Partial<SidebarSessionSummary> &
    Pick<SidebarSessionSummary, "id" | "environmentId" | "projectId" | "title">,
): SidebarSessionSummary {
  return {
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeEmptyEnvironmentState(): EnvironmentState {
  return {
    projectIds: [],
    projectById: {},
    sessionIds: [],
    sessionIdsByProjectId: {},
    sessionShellById: {},
    providerRuntimeById: {},
    sessionTurnStateById: {},
    messageIdsBySessionId: {},
    messageBySessionId: {},
    activityIdsBySessionId: {},
    activityBySessionId: {},
    proposedPlanIdsBySessionId: {},
    proposedPlanBySessionId: {},
    turnDiffIdsBySessionId: {},
    turnDiffSummaryBySessionId: {},
    sidebarSessionSummaryById: {},
    bootstrapComplete: true,
  };
}

// ── Fixture: Two environments, shared + local-only + remote-only projects ──

function makeFixtureState(): AppState {
  // Shared project: same repo in both envs
  const sharedProjectPrimary = makeProject({
    id: sharedProjectPrimaryId,
    environmentId: primaryEnvId,
    name: "shared-repo",
    repositoryIdentity: {
      canonicalKey: SHARED_REPO_CANONICAL_KEY,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/example/shared-repo.git",
      },
    },
  });
  const sharedProjectRemote = makeProject({
    id: sharedProjectRemoteId,
    environmentId: remoteEnvId,
    name: "shared-repo",
    repositoryIdentity: {
      canonicalKey: SHARED_REPO_CANONICAL_KEY,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/example/shared-repo.git",
      },
    },
  });
  // Local-only project
  const localOnlyProject = makeProject({
    id: localOnlyProjectId,
    environmentId: primaryEnvId,
    name: "local-only",
  });
  // Remote-only project
  const remoteOnlyProject = makeProject({
    id: remoteOnlyProjectId,
    environmentId: remoteEnvId,
    name: "remote-only",
  });

  // Sessions
  const summaryP1 = makeSidebarSessionSummary({
    id: sessionP1,
    environmentId: primaryEnvId,
    projectId: sharedProjectPrimaryId,
    title: "Shared primary session 1",
  });
  const summaryP2 = makeSidebarSessionSummary({
    id: sessionP2,
    environmentId: primaryEnvId,
    projectId: sharedProjectPrimaryId,
    title: "Shared primary session 2",
  });
  const summaryR1 = makeSidebarSessionSummary({
    id: sessionR1,
    environmentId: remoteEnvId,
    projectId: sharedProjectRemoteId,
    title: "Shared remote session 1",
  });
  const summaryL1 = makeSidebarSessionSummary({
    id: sessionL1,
    environmentId: primaryEnvId,
    projectId: localOnlyProjectId,
    title: "Local only session 1",
  });
  const summaryRO1 = makeSidebarSessionSummary({
    id: sessionRO1,
    environmentId: remoteEnvId,
    projectId: remoteOnlyProjectId,
    title: "Remote only session 1",
  });

  const primaryEnvState: EnvironmentState = {
    ...makeEmptyEnvironmentState(),
    projectIds: [sharedProjectPrimaryId, localOnlyProjectId],
    projectById: {
      [sharedProjectPrimaryId]: sharedProjectPrimary,
      [localOnlyProjectId]: localOnlyProject,
    },
    sessionIds: [sessionP1, sessionP2, sessionL1],
    sessionIdsByProjectId: {
      [sharedProjectPrimaryId]: [sessionP1, sessionP2],
      [localOnlyProjectId]: [sessionL1],
    },
    sidebarSessionSummaryById: {
      [sessionP1]: summaryP1,
      [sessionP2]: summaryP2,
      [sessionL1]: summaryL1,
    },
  };

  const remoteEnvState: EnvironmentState = {
    ...makeEmptyEnvironmentState(),
    projectIds: [sharedProjectRemoteId, remoteOnlyProjectId],
    projectById: {
      [sharedProjectRemoteId]: sharedProjectRemote,
      [remoteOnlyProjectId]: remoteOnlyProject,
    },
    sessionIds: [sessionR1, sessionRO1],
    sessionIdsByProjectId: {
      [sharedProjectRemoteId]: [sessionR1],
      [remoteOnlyProjectId]: [sessionRO1],
    },
    sidebarSessionSummaryById: {
      [sessionR1]: summaryR1,
      [sessionRO1]: summaryRO1,
    },
  };

  return {
    activeEnvironmentId: primaryEnvId,
    environmentStateById: {
      [primaryEnvId]: primaryEnvState,
      [remoteEnvId]: remoteEnvState,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("environment grouping", () => {
  describe("deriveLogicalProjectKey", () => {
    it("uses repositoryIdentity.canonicalKey when present", () => {
      const project = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "shared-repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      expect(deriveLogicalProjectKey(project)).toBe(SHARED_REPO_CANONICAL_KEY);
    });

    it("falls back to scoped project key when no repositoryIdentity", () => {
      const project = makeProject({
        id: localOnlyProjectId,
        environmentId: primaryEnvId,
        name: "local-only",
      });
      expect(deriveLogicalProjectKey(project)).toBe(derivePhysicalProjectKey(project));
    });

    it("groups projects from different environments that share the same canonical key", () => {
      const primary = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "shared-repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      const remote = makeProject({
        id: sharedProjectRemoteId,
        environmentId: remoteEnvId,
        name: "shared-repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      expect(deriveLogicalProjectKey(primary)).toBe(deriveLogicalProjectKey(remote));
    });

    it("groups repo root and nested projects from the same repository by default", () => {
      const rootProject = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "shared-repo",
        cwd: "/workspace/repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/workspace/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      const nestedProject = makeProject({
        id: localOnlyProjectId,
        environmentId: primaryEnvId,
        name: "web",
        cwd: "/workspace/repo/apps/web",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/workspace/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });

      expect(deriveLogicalProjectKey(rootProject)).toBe(SHARED_REPO_CANONICAL_KEY);
      expect(deriveLogicalProjectKey(nestedProject)).toBe(SHARED_REPO_CANONICAL_KEY);
    });

    it("uses repository path grouping when requested", () => {
      const rootProject = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "shared-repo",
        cwd: "/workspace/repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/workspace/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      const nestedProject = makeProject({
        id: localOnlyProjectId,
        environmentId: primaryEnvId,
        name: "web",
        cwd: "/workspace/repo/apps/web",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/workspace/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });

      expect(
        deriveLogicalProjectKey(rootProject, {
          groupingMode: "repository_path",
        }),
      ).toBe(SHARED_REPO_CANONICAL_KEY);
      expect(
        deriveLogicalProjectKey(nestedProject, {
          groupingMode: "repository_path",
        }),
      ).toBe(`${SHARED_REPO_CANONICAL_KEY}::apps/web`);
    });

    it("groups matching nested project paths across environments when repo roots differ", () => {
      const primary = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "web",
        cwd: "/workspace/repo/apps/web",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/workspace/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });
      const remote = makeProject({
        id: sharedProjectRemoteId,
        environmentId: remoteEnvId,
        name: "web",
        cwd: "/srv/checkout/apps/web",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          rootPath: "/srv/checkout",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });

      expect(
        deriveLogicalProjectKey(primary, {
          groupingMode: "repository_path",
        }),
      ).toBe(`${SHARED_REPO_CANONICAL_KEY}::apps/web`);
      expect(
        deriveLogicalProjectKey(primary, {
          groupingMode: "repository_path",
        }),
      ).toBe(
        deriveLogicalProjectKey(remote, {
          groupingMode: "repository_path",
        }),
      );
    });

    it("does NOT group projects without shared canonical key", () => {
      const local = makeProject({
        id: localOnlyProjectId,
        environmentId: primaryEnvId,
        name: "local-only",
      });
      const remote = makeProject({
        id: remoteOnlyProjectId,
        environmentId: remoteEnvId,
        name: "remote-only",
      });
      expect(deriveLogicalProjectKey(local)).not.toBe(deriveLogicalProjectKey(remote));
    });

    it("uses per-project overrides from settings", () => {
      const project = makeProject({
        id: sharedProjectPrimaryId,
        environmentId: primaryEnvId,
        name: "shared-repo",
        repositoryIdentity: {
          canonicalKey: SHARED_REPO_CANONICAL_KEY,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
        },
      });

      expect(resolveProjectGroupingMode(project, DEFAULT_GROUPING_SETTINGS)).toBe("repository");
      expect(
        deriveLogicalProjectKeyFromSettings(project, {
          ...DEFAULT_GROUPING_SETTINGS,
          sidebarProjectGroupingOverrides: {
            [derivePhysicalProjectKey(project)]: "separate",
          },
        }),
      ).toBe(derivePhysicalProjectKey(project));
    });
  });

  describe("selectProjectsAcrossEnvironments", () => {
    it("returns all projects from all environments", () => {
      const state = makeFixtureState();
      const projects = selectProjectsAcrossEnvironments(state);
      expect(projects).toHaveLength(4);
      const names = projects.map((p) => p.name).toSorted();
      expect(names).toEqual(["local-only", "remote-only", "shared-repo", "shared-repo"]);
    });
  });

  describe("selectSidebarSessionsAcrossEnvironments", () => {
    it("returns all sidebar session summaries from all environments", () => {
      const state = makeFixtureState();
      const sessions = selectSidebarSessionsAcrossEnvironments(state);
      expect(sessions).toHaveLength(5);
      const ids = new Set(sessions.map((t) => t.id));
      expect(ids).toContain(sessionP1);
      expect(ids).toContain(sessionP2);
      expect(ids).toContain(sessionR1);
      expect(ids).toContain(sessionL1);
      expect(ids).toContain(sessionRO1);
    });
  });

  describe("selectSidebarSessionsForProjectRef", () => {
    it("returns sessions for a single project ref", () => {
      const state = makeFixtureState();
      const ref = scopeProjectRef(primaryEnvId, sharedProjectPrimaryId);
      const sessions = selectSidebarSessionsForProjectRef(state, ref);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((t) => t.id)).toEqual([sessionP1, sessionP2]);
    });

    it("returns empty array for null ref", () => {
      const state = makeFixtureState();
      expect(selectSidebarSessionsForProjectRef(state, null)).toEqual([]);
    });

    it("returns empty array for nonexistent environment", () => {
      const state = makeFixtureState();
      const ref = scopeProjectRef(EnvironmentId.make("nonexistent"), sharedProjectPrimaryId);
      expect(selectSidebarSessionsForProjectRef(state, ref)).toEqual([]);
    });
  });

  describe("selectSidebarSessionsForProjectRefs", () => {
    it("returns empty for empty refs", () => {
      const state = makeFixtureState();
      expect(selectSidebarSessionsForProjectRefs(state, [])).toEqual([]);
    });

    it("returns sessions for a single ref", () => {
      const state = makeFixtureState();
      const refs = [scopeProjectRef(primaryEnvId, sharedProjectPrimaryId)];
      const sessions = selectSidebarSessionsForProjectRefs(state, refs);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((t) => t.id)).toEqual([sessionP1, sessionP2]);
    });

    it("returns combined sessions from multiple refs across environments", () => {
      const state = makeFixtureState();
      const refs = [
        scopeProjectRef(primaryEnvId, sharedProjectPrimaryId),
        scopeProjectRef(remoteEnvId, sharedProjectRemoteId),
      ];
      const sessions = selectSidebarSessionsForProjectRefs(state, refs);
      expect(sessions).toHaveLength(3);
      const ids = new Set(sessions.map((t) => t.id));
      expect(ids).toContain(sessionP1);
      expect(ids).toContain(sessionP2);
      expect(ids).toContain(sessionR1);
    });

    it("returns sessions from remote-only project", () => {
      const state = makeFixtureState();
      const refs = [scopeProjectRef(remoteEnvId, remoteOnlyProjectId)];
      const sessions = selectSidebarSessionsForProjectRefs(state, refs);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe(sessionRO1);
    });

    it("returns sessions from local-only project", () => {
      const state = makeFixtureState();
      const refs = [scopeProjectRef(primaryEnvId, localOnlyProjectId)];
      const sessions = selectSidebarSessionsForProjectRefs(state, refs);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe(sessionL1);
    });

    it("handles refs with nonexistent environment gracefully", () => {
      const state = makeFixtureState();
      const refs = [
        scopeProjectRef(primaryEnvId, sharedProjectPrimaryId),
        scopeProjectRef(EnvironmentId.make("nonexistent"), ProjectId.make("nope")),
      ];
      const sessions = selectSidebarSessionsForProjectRefs(state, refs);
      // Only returns sessions from the valid ref
      expect(sessions).toHaveLength(2);
      expect(sessions.map((t) => t.id)).toEqual([sessionP1, sessionP2]);
    });
  });

  describe("logical project grouping for sidebar", () => {
    it("computes correct logical key for grouped projects and aggregates sessions", () => {
      const state = makeFixtureState();
      const allProjects = selectProjectsAcrossEnvironments(state);

      // Group by logical key
      const groups = new Map<string, Project[]>();
      for (const project of allProjects) {
        const key = deriveLogicalProjectKey(project);
        const existing = groups.get(key) ?? [];
        existing.push(project);
        groups.set(key, existing);
      }

      // Shared project should be grouped
      const sharedGroup = groups.get(SHARED_REPO_CANONICAL_KEY);
      expect(sharedGroup).toBeDefined();
      expect(sharedGroup).toHaveLength(2);
      expect(sharedGroup!.map((p) => p.environmentId).toSorted()).toEqual(
        [primaryEnvId, remoteEnvId].toSorted(),
      );

      // Build member refs for the grouped project and fetch sessions
      const memberRefs = sharedGroup!.map((p) => scopeProjectRef(p.environmentId, p.id));
      const sessions = selectSidebarSessionsForProjectRefs(state, memberRefs);
      expect(sessions).toHaveLength(3);
      const sessionIds = sessions.map((t) => t.id);
      expect(sessionIds).toContain(sessionP1);
      expect(sessionIds).toContain(sessionP2);
      expect(sessionIds).toContain(sessionR1);
    });

    it("local-only and remote-only projects remain ungrouped", () => {
      const state = makeFixtureState();
      const allProjects = selectProjectsAcrossEnvironments(state);

      const groups = new Map<string, Project[]>();
      for (const project of allProjects) {
        const key = deriveLogicalProjectKey(project);
        const existing = groups.get(key) ?? [];
        existing.push(project);
        groups.set(key, existing);
      }

      // Should have 3 groups total: shared, local-only, remote-only
      expect(groups.size).toBe(3);

      // Local-only group
      const localKey = deriveLogicalProjectKey(
        allProjects.find((p) => p.id === localOnlyProjectId)!,
      );
      expect(groups.get(localKey)).toHaveLength(1);

      // Remote-only group
      const remoteKey = deriveLogicalProjectKey(
        allProjects.find((p) => p.id === remoteOnlyProjectId)!,
      );
      expect(groups.get(remoteKey)).toHaveLength(1);
    });
  });
});
