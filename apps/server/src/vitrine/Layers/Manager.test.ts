import { ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { vi } from "vitest";

import { VitrineCli, type VitrineCliShape, type VitrineCliSnapshot } from "../Services/Cli.ts";
import { makeVitrineManager } from "./Manager.ts";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");

function stopped(root: string): VitrineCliSnapshot {
  return { status: "stopped", dataDir: `${root}/.vitrine`, version: "0.1.0" };
}

function running(root: string, port: number): VitrineCliSnapshot {
  return {
    status: "running",
    url: `http://vitrine.localhost:${port}/`,
    apiUrl: `http://127.0.0.1:${port}/`,
    pid: port,
    port,
    sessionId: `session-${port}`,
    dataDir: `${root}/.vitrine`,
    version: "0.1.0",
  };
}

function statefulCli() {
  const state = new Map<string, VitrineCliSnapshot>();
  const starts: string[] = [];
  const run = vi.fn<VitrineCliShape["run"]>((action, input) =>
    Effect.sync(() => {
      const current = state.get(input.workspaceRoot) ?? stopped(input.workspaceRoot);
      if (action === "start") {
        starts.push(input.workspaceRoot);
        const next = running(input.workspaceRoot, input.workspaceRoot.endsWith("a") ? 7741 : 7742);
        state.set(input.workspaceRoot, next);
        return next;
      }
      if (action === "stop") {
        const next = stopped(input.workspaceRoot);
        state.set(input.workspaceRoot, next);
        return next;
      }
      return current;
    }),
  );
  return { cli: VitrineCli.of({ run }), run, starts };
}

it.layer(NodeServices.layer)("VitrineManager", (it) => {
  it.effect("reuses one server across concurrent callers for the same project", () =>
    Effect.gen(function* () {
      const fake = statefulCli();
      const manager = yield* makeVitrineManager.pipe(Effect.provideService(VitrineCli, fake.cli));
      const input = { projectId: PROJECT_A, workspaceRoot: "/projects/a" };

      const [first, second] = yield* Effect.all([manager.ensure(input), manager.ensure(input)], {
        concurrency: "unbounded",
      });

      expect(first.status).toBe("ready");
      expect(second.status).toBe("ready");
      expect(fake.starts).toEqual(["/projects/a"]);
    }),
  );

  it.effect("keeps separate project data directories and servers", () =>
    Effect.gen(function* () {
      const fake = statefulCli();
      const manager = yield* makeVitrineManager.pipe(Effect.provideService(VitrineCli, fake.cli));

      const [a, b] = yield* Effect.all(
        [
          manager.ensure({ projectId: PROJECT_A, workspaceRoot: "/projects/a" }),
          manager.ensure({ projectId: PROJECT_B, workspaceRoot: "/projects/b" }),
        ],
        { concurrency: "unbounded" },
      );

      expect(a.dataDir).toBe("/projects/a/.vitrine");
      expect(b.dataDir).toBe("/projects/b/.vitrine");
      expect(a.port).toBe(7741);
      expect(b.port).toBe(7742);
      expect(fake.starts).toHaveLength(2);
    }),
  );

  it.effect("stops only the selected project's identified server", () =>
    Effect.gen(function* () {
      const fake = statefulCli();
      const manager = yield* makeVitrineManager.pipe(Effect.provideService(VitrineCli, fake.cli));
      const aInput = { projectId: PROJECT_A, workspaceRoot: "/projects/a" };
      const bInput = { projectId: PROJECT_B, workspaceRoot: "/projects/b" };
      yield* manager.ensure(aInput);
      yield* manager.ensure(bInput);

      const stoppedA = yield* manager.stop(aInput);
      const readyB = yield* manager.status(bInput);

      expect(stoppedA.status).toBe("stopped");
      expect(readyB.status).toBe("ready");
    }),
  );

  it.effect("canonicalizes symlinked project roots before lifecycle commands", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vitrine-manager-" });
      const realRoot = path.join(base, "real-project");
      const linkedRoot = path.join(base, "linked-project");
      yield* fileSystem.makeDirectory(realRoot);
      yield* fileSystem.symlink(realRoot, linkedRoot);
      const canonicalRoot = yield* fileSystem.realPath(realRoot);

      const fake = statefulCli();
      const manager = yield* makeVitrineManager.pipe(Effect.provideService(VitrineCli, fake.cli));

      const state = yield* manager.ensure({
        projectId: PROJECT_A,
        workspaceRoot: linkedRoot,
      });

      expect(fake.starts).toEqual([canonicalRoot]);
      expect(state.dataDir).toBe(path.join(canonicalRoot, ".vitrine"));
    }),
  );
});
