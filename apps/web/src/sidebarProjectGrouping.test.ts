import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "./sidebarProjectGrouping";
import type { Project } from "./types";

const localId = EnvironmentId.make("local");
const remoteId = EnvironmentId.make("remote");

function makeProject(input: {
  environmentId: EnvironmentId;
  id: string;
  name: string;
  cwd: string;
  canonicalKey: string;
}): Project {
  return {
    id: ProjectId.make(input.id),
    environmentId: input.environmentId,
    name: input.name,
    cwd: input.cwd,
    repositoryIdentity: {
      canonicalKey: input.canonicalKey,
      rootPath: input.cwd,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://${input.canonicalKey}.git`,
      },
    },
    defaultModelSelection: null,
    scripts: [],
  };
}

describe("Sidebar project picker grouping", () => {
  it("presents one searchable group while targeting the contextual environment member", () => {
    const local = makeProject({
      environmentId: localId,
      id: "local-project",
      name: "Study local",
      cwd: "/work/study",
      canonicalKey: "github.com/lincei/study",
    });
    const remote = makeProject({
      environmentId: remoteId,
      id: "remote-project",
      name: "Study remote",
      cwd: "/srv/study",
      canonicalKey: "github.com/lincei/study",
    });
    const groups = buildSidebarProjectSnapshots({
      projects: [local, remote],
      settings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      primaryEnvironmentId: localId,
      resolveEnvironmentLabel: (environmentId) =>
        environmentId === localId ? "Local" : "Research host",
    });

    const entries = buildSidebarProjectPickerEntries({
      groups,
      preferredProjectRef: {
        environmentId: remoteId,
        projectId: remote.id,
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.group.memberProjects.map((project) => project.name)).toEqual([
      "Study local",
      "Study remote",
    ]);
    expect(entries[0]?.targetProject.id).toBe(remote.id);
    expect(entries[0]?.isPreferred).toBe(true);
  });
});
