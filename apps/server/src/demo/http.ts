// @effect-diagnostics nodeBuiltinImport:off - Demo seed writes local workspace fixtures.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CommandId, ProjectId, type OrchestrationCommand } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { buildDemoScenarioCommands, demoProjectIds } from "../../../../demos/buildScenario.ts";
import { validateDemoSeedRequest, type DemoScenario } from "../../../../demos/schema.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

class DemoSeedHttpError extends Data.TaggedError("DemoSeedHttpError")<{
  readonly status: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

function tokenFromRequest(request: HttpServerRequest.HttpServerRequest): string | null {
  const headerToken = request.headers["x-lincei-demo-seed-token"]?.trim();
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers["authorization"]?.trim();
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return null;
}

function isDemoEndpointEnabled(): boolean {
  return process.env.LINCEI_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";
}

function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
  const root = resolve(workspaceRoot);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error(`Demo workspace file '${relativePath}' escapes '${workspaceRoot}'.`);
  }
  return target;
}

async function writeDemoWorkspaceFiles(scenario: DemoScenario): Promise<void> {
  for (const study of scenario.studies) {
    for (const file of study.files ?? []) {
      const target = resolveWorkspaceFilePath(study.workspaceRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }
}

export const demoSeedRouteLayer = HttpRouter.add(
  "POST",
  "/api/demo/seed",
  Effect.gen(function* () {
    if (!isDemoEndpointEnabled()) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Demo seed API is not enabled." },
        {
          status: 404,
        },
      );
    }

    const expectedToken = process.env.LINCEI_DEMO_SEED_TOKEN?.trim();
    if (!expectedToken) {
      return HttpServerResponse.jsonUnsafe(
        { error: "LINCEI_DEMO_SEED_TOKEN is required for demo seeding." },
        { status: 403 },
      );
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    if (tokenFromRequest(request) !== expectedToken) {
      return HttpServerResponse.jsonUnsafe({ error: "Invalid demo seed token." }, { status: 401 });
    }

    const bodyJson = yield* request.json.pipe(
      Effect.mapError(
        (cause) =>
          new DemoSeedHttpError({
            status: 400,
            message: "Invalid demo seed JSON body.",
            cause,
          }),
      ),
    );
    const body = yield* Effect.try({
      try: () => validateDemoSeedRequest(bodyJson),
      catch: (cause) =>
        new DemoSeedHttpError({
          status: 400,
          message: "Invalid demo seed payload.",
          cause,
        }),
    });
    const projectIds = new Set(demoProjectIds(body.scenario));
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const snapshot = yield* snapshotQuery.getSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new DemoSeedHttpError({
            status: 500,
            message: "Failed to load orchestration snapshot.",
            cause,
          }),
      ),
    );
    const existingDemoProjects = snapshot.projects.filter((project) => projectIds.has(project.id));
    if (existingDemoProjects.length > 0 && body.force !== true) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: `Demo IDs already exist (${existingDemoProjects.map((project) => project.id).join(", ")}). Run bun run demo:reset or seed with --force.`,
        },
        { status: 409 },
      );
    }

    yield* Effect.tryPromise({
      try: () => writeDemoWorkspaceFiles(body.scenario),
      catch: (cause) =>
        new DemoSeedHttpError({
          status: 500,
          message: "Failed to write demo workspace files.",
          cause,
        }),
    });

    const engine = yield* OrchestrationEngineService;
    const commandIdSalt = body.force === true ? `force-${snapshot.snapshotSequence}` : undefined;
    if (body.force === true) {
      for (const project of existingDemoProjects) {
        yield* engine.dispatch({
          type: "project.purge",
          commandId: CommandId.make(`cmd-${commandIdSalt ?? "force"}-${project.id}-purge-existing`),
          projectId: ProjectId.make(project.id),
          createdAt: body.scenario.baseTimestamp,
        });
      }
    }

    const buildOptions: { readonly commandIdSalt?: string } =
      commandIdSalt !== undefined ? { commandIdSalt } : {};
    const commands = buildDemoScenarioCommands(
      body.scenario,
      buildOptions,
    ) as OrchestrationCommand[];
    let lastSequence = snapshot.snapshotSequence;
    for (const command of commands) {
      const result = yield* engine.dispatch(command).pipe(
        Effect.mapError(
          (cause) =>
            new DemoSeedHttpError({
              status: 500,
              message: `Failed to dispatch demo seed command '${command.type}'.`,
              cause,
            }),
        ),
      );
      lastSequence = result.sequence;
    }

    return HttpServerResponse.jsonUnsafe(
      {
        scenarioId: body.scenario.scenarioId,
        projectCount: body.scenario.studies.length,
        sessionCount: body.scenario.studies.reduce(
          (count, study) => count + study.sessions.length,
          0,
        ),
        commandCount: commands.length,
        sequence: lastSequence,
      },
      { status: 200 },
    );
  }).pipe(
    Effect.catchTag("DemoSeedHttpError", (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error: "Demo seed failed.",
            detail: error.message,
          },
          { status: error.status },
        ),
      ),
    ),
  ),
);
