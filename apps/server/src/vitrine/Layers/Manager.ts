import type { VitrineLifecycleIssueCode, VitrineProjectState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { VitrineCli, type VitrineCliError, type VitrineCliSnapshot } from "../Services/Cli.ts";
import {
  VitrineManager,
  type VitrineManagerInput,
  type VitrineManagerShape,
} from "../Services/Manager.ts";

function dataDirFor(path: Path.Path, input: VitrineManagerInput): string {
  return path.resolve(input.workspaceRoot, ".vitrine");
}

function emptyState(
  path: Path.Path,
  input: VitrineManagerInput,
  status: VitrineProjectState["status"],
  updatedAt: string,
): VitrineProjectState {
  return {
    projectId: input.projectId,
    status,
    dataDir: dataDirFor(path, input),
    url: null,
    apiUrl: null,
    pid: null,
    port: null,
    sessionId: null,
    version: null,
    issueCode: null,
    message: null,
    updatedAt,
  };
}

function snapshotState(
  path: Path.Path,
  input: VitrineManagerInput,
  snapshot: VitrineCliSnapshot,
  updatedAt: string,
): VitrineProjectState {
  if (snapshot.status === "stopped") {
    return {
      ...emptyState(path, input, "stopped", updatedAt),
      dataDir: snapshot.dataDir,
      version: snapshot.version,
    };
  }
  return {
    projectId: input.projectId,
    status: "ready",
    dataDir: snapshot.dataDir,
    url: snapshot.url,
    apiUrl: snapshot.apiUrl,
    pid: snapshot.pid,
    port: snapshot.port,
    sessionId: snapshot.sessionId,
    version: snapshot.version,
    issueCode: null,
    message: null,
    updatedAt,
  };
}

function actionableMessage(error: VitrineCliError): string {
  switch (error.code) {
    case "executable_unavailable":
      return "Install Vitrine 0.1.x and ensure the vitrine executable is on PATH, or set LINCEI_VITRINE_EXECUTABLE.";
    case "startup_timeout":
      return "Vitrine did not become ready in time. Run `vitrine status --json` from the project root for details.";
    case "process_exited":
      return `Vitrine exited before becoming ready. ${error.detail}`;
    case "invalid_status_payload":
      return "Vitrine returned invalid lifecycle JSON. Install a compatible Vitrine 0.1.x release.";
    case "non_loopback_url":
      return "Vitrine reported a non-loopback or malformed URL, so Lincei refused to embed it.";
    case "project_mismatch":
      return "Vitrine reported a different project data directory, so Lincei refused to attach to it.";
    case "incompatible_version":
      return error.detail;
    case "command_failed":
      return `Vitrine lifecycle command failed. ${error.detail}`;
  }
}

function errorState(
  path: Path.Path,
  input: VitrineManagerInput,
  error: VitrineCliError,
  updatedAt: string,
): VitrineProjectState {
  return {
    ...emptyState(
      path,
      input,
      error.code === "executable_unavailable" ? "unavailable" : "failed",
      updatedAt,
    ),
    issueCode: error.code satisfies VitrineLifecycleIssueCode,
    message: actionableMessage(error),
  };
}

export const makeVitrineManager = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cli = yield* VitrineCli;
  const statesRef = yield* SynchronizedRef.make(new Map<string, VitrineProjectState>());
  const locksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

  const stateKey = (input: VitrineManagerInput): string => path.resolve(input.workspaceRoot);
  const normalizeInput = (input: VitrineManagerInput) =>
    fileSystem.realPath(input.workspaceRoot).pipe(
      Effect.catch(() => Effect.succeed(path.resolve(input.workspaceRoot))),
      Effect.map((workspaceRoot) => ({ ...input, workspaceRoot })),
    );

  const remember = (input: VitrineManagerInput, state: VitrineProjectState) =>
    SynchronizedRef.update(statesRef, (current) => {
      const next = new Map(current);
      next.set(stateKey(input), state);
      return next;
    }).pipe(Effect.as(state));

  const getLock = (input: VitrineManagerInput) =>
    SynchronizedRef.modifyEffect(locksRef, (current) => {
      const key = stateKey(input);
      const existing = Option.fromNullishOr(current.get(key));
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(key, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });

  const withLock = <A>(input: VitrineManagerInput, effect: Effect.Effect<A>): Effect.Effect<A> =>
    Effect.flatMap(getLock(input), (semaphore) => semaphore.withPermit(effect));

  const runAndRemember = (input: VitrineManagerInput, action: "start" | "status" | "stop") =>
    cli.run(action, { workspaceRoot: input.workspaceRoot }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.map(DateTime.now, (now) =>
            errorState(path, input, error, DateTime.formatIso(now)),
          ),
        onSuccess: (snapshot) =>
          Effect.map(DateTime.now, (now) =>
            snapshotState(path, input, snapshot, DateTime.formatIso(now)),
          ),
      }),
      Effect.flatMap((state) => remember(input, state)),
    );

  const statusNormalized = (input: VitrineManagerInput) =>
    Effect.gen(function* () {
      const cached = (yield* SynchronizedRef.get(statesRef)).get(stateKey(input));
      if (cached?.status === "starting") return cached;
      return yield* runAndRemember(input, "status");
    });

  const status: VitrineManagerShape["status"] = (input) =>
    Effect.flatMap(normalizeInput(input), statusNormalized);

  const ensure: VitrineManagerShape["ensure"] = (input) =>
    Effect.flatMap(normalizeInput(input), (normalized) =>
      withLock(
        normalized,
        Effect.gen(function* () {
          const current = yield* runAndRemember(normalized, "status");
          if (current.status === "ready" || current.status === "unavailable") return current;
          if (current.status === "failed") return current;
          const updatedAt = DateTime.formatIso(yield* DateTime.now);
          yield* remember(normalized, emptyState(path, normalized, "starting", updatedAt));
          return yield* runAndRemember(normalized, "start");
        }),
      ),
    );

  const stop: VitrineManagerShape["stop"] = (input) =>
    Effect.flatMap(normalizeInput(input), (normalized) =>
      withLock(
        normalized,
        Effect.gen(function* () {
          const current = yield* runAndRemember(normalized, "status");
          if (current.status !== "ready") return current;
          return yield* runAndRemember(normalized, "stop");
        }),
      ),
    );

  return VitrineManager.of({ ensure, status, stop });
});

/**
 * Vitrine owns the persistent server lifetime. Lincei discovers or starts that
 * project-scoped server, but does not stop it during Lincei shutdown. Only an
 * explicit `stop` call targets the process identified by the project's CLI state.
 */
export const VitrineManagerLive = Layer.effect(VitrineManager, makeVitrineManager);
