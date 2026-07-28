import type { VcsStatusRemoteResult, VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyGitStatusStreamEvent,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  WORKTREE_BRANCH_PREFIX,
} from "./git.ts";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:example-workspace/example-app.git")).toBe(
      "github.com/example-workspace/example-app",
    );
    expect(normalizeGitRemoteUrl("https://github.com/example-workspace/example-app.git")).toBe(
      "github.com/example-workspace/example-app",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/example-workspace/example-app")).toBe(
      "github.com/example-workspace/example-app",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:example-workspace/platform/example-app.git")).toBe(
      "gitlab.com/example-workspace/platform/example-app",
    );
    expect(
      normalizeGitRemoteUrl("https://gitlab.com/example-workspace/platform/example-app.git"),
    ).toBe("gitlab.com/example-workspace/platform/example-app");
  });

  it("preserves non-default endpoint ports and transport identity", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "https://gitlab.company.com:8443/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "ssh://git@gitlab.company.com:2222/team/project",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).not.toBe(
      normalizeGitRemoteUrl("https://gitlab.company.com:9443/team/project.git"),
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).not.toBe(
      normalizeGitRemoteUrl("https://gitlab.company.com:2222/team/project.git"),
    );
  });

  it("collapses explicit default ports only for standard HTTPS and Git SSH remotes", () => {
    expect(normalizeGitRemoteUrl("https://github.com:443/example/workspace.git")).toBe(
      "github.com/example/workspace",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com:22/example/workspace.git")).toBe(
      "github.com/example/workspace",
    );
    expect(normalizeGitRemoteUrl("ssh://deploy@github.com:22/example/workspace.git")).toBe(
      "ssh://deploy@github.com/example/workspace",
    );
    expect(normalizeGitRemoteUrl("http://github.com/example/workspace.git")).toBe(
      "http://github.com/example/workspace",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl(
        "git@github.com:example-fork/example-app.git",
      ),
    ).toBe("example-fork/example-app");
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl(
        "https://github.com/example-fork/example-app.git",
      ),
    ).toBe("example-fork/example-app");
  });
});

describe("isTemporaryWorktreeBranch", () => {
  it("matches the generated temporary worktree refName format", () => {
    expect(
      isTemporaryWorktreeBranch(
        buildTemporaryWorktreeBranchName((byteLength) => {
          expect(byteLength).toBe(4);
          return "DEADBEEF";
        }),
      ),
    ).toBe(true);
  });

  it("matches generated temporary worktree refs", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/deadbeef `)).toBe(true);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/DEADBEEF`)).toBe(true);
  });

  it("rejects non-temporary refName names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("main")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef-extra`)).toBe(false);
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: VcsStatusResult = {
      isRepo: true,
      sourceControlProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
