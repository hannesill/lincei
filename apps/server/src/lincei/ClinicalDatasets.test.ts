import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";

const READY: ClinicalRuntimeStatus = {
  state: "ready",
  message: "ready",
  home: "/home/ada/.lincei/clinical",
  python: "/home/ada/.lincei/clinical/venv/bin/python",
  skillsDir: "/home/ada/.lincei/clinical/skills",
  dataDir: "/home/ada/.lincei/clinical/m4_data",
  requirements: [],
  demoDataset: "ready",
};

const m4Dataset = (
  name: string,
  fields: {
    readonly setup_state: string;
    readonly raw_present?: boolean;
    readonly parquet_present?: boolean;
    readonly requires_authentication?: boolean;
    readonly parquet_size_gb?: number | null;
  },
) => ({
  name,
  raw_present: false,
  parquet_present: false,
  requires_authentication: false,
  download_available: true,
  parquet_size_gb: null,
  // M4 reports more than Lincei reads.
  db_present: fields.setup_state === "ready",
  derived: { supported: false },
  ...fields,
});

const LISTING = JSON.stringify({
  version: 1,
  ok: true,
  command: "list-datasets",
  data: {
    datasets: [
      m4Dataset("mimic-iv-demo", {
        setup_state: "ready",
        raw_present: true,
        parquet_present: true,
        parquet_size_gb: 0.012,
      }),
      m4Dataset("mimic-iv", { setup_state: "credentials_required", requires_authentication: true }),
      m4Dataset("eicu", {
        setup_state: "missing_parquet",
        raw_present: true,
        requires_authentication: true,
      }),
    ],
  },
});

const exited = (code: number, stdout = "", stderr = ""): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const events = (...lines: ReadonlyArray<Record<string, unknown>>) =>
  new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));

type Run = ProcessRunner.ProcessRunInput;

/**
 * The datasets service over a ready clinical runtime whose M4 is `m4`: it
 * answers every command except `list-datasets`, which reports `LISTING`.
 */
const withDatasets = <A, E>(
  m4: (run: Run) => Effect.Effect<ProcessRunner.ProcessRunOutput>,
  use: (context: {
    readonly datasets: ClinicalDatasets.ClinicalDatasets["Service"];
    readonly commands: Array<ReadonlyArray<string>>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>,
  status: ClinicalRuntimeStatus = READY,
) => {
  const commands: Array<ReadonlyArray<string>> = [];
  const layerDependencies = Layer.mergeAll(
    Layer.succeed(
      ClinicalRuntime.ClinicalRuntime,
      ClinicalRuntime.ClinicalRuntime.of({
        status: Effect.succeed(status),
        provision: Effect.succeed(status),
        setup: Effect.succeed(status),
      }),
    ),
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (run) => {
          commands.push(run.args);
          return run.args[0] === "list-datasets" ? Effect.succeed(exited(0, LISTING)) : m4(run);
        },
      }),
    ),
    Layer.succeed(HostProcessPlatform, "darwin"),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.gen(function* () {
    const datasets = yield* ClinicalDatasets.ClinicalDatasets;
    return yield* use({ datasets, commands });
  }).pipe(
    Effect.provide(ClinicalDatasets.layer.pipe(Layer.provideMerge(layerDependencies))),
    Effect.scoped,
  );
};

const jobOf = (
  datasets: ReadonlyArray<{ readonly name: string; readonly job?: unknown }>,
  name: string,
) => datasets.find((dataset) => dataset.name === name)?.job;

describe("ClinicalDatasets", () => {
  it.effect("reports what this machine holds of each dataset M4 supports", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets }) =>
        Effect.gen(function* () {
          expect(yield* datasets.list).toEqual([
            {
              name: "mimic-iv-demo",
              state: "ready",
              requiresCredentials: false,
              downloadable: true,
              sizeGb: 0.012,
            },
            { name: "mimic-iv", state: "missing", requiresCredentials: true, downloadable: true },
            { name: "eicu", state: "incomplete", requiresCredentials: true, downloadable: true },
          ]);
        }),
    ),
  );

  it.effect("shows a download's progress while it runs, then prepares the dataset", () =>
    Effect.gen(function* () {
      const downloading = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const progress = events(
        { event: "operation_started", command: "download" },
        { event: "download_listing_started", dataset: "mimic-iv-demo" },
        { event: "download_started", dataset: "mimic-iv-demo", file_count: 3 },
        { event: "download_file_completed", path: "/data/hosp/patients.csv.gz" },
        {
          event: "download_file_progress",
          path: "/data/hosp/labevents.csv.gz",
          bytes_downloaded: 1024,
          bytes_total: 4096,
        },
      );

      yield* withDatasets(
        (run) =>
          run.args[0] === "download"
            ? Effect.gen(function* () {
                // Arrives split mid-line, as a pipe delivers it.
                run.onStdoutChunk?.(progress.slice(0, 70));
                run.onStdoutChunk?.(progress.slice(70));
                yield* Deferred.succeed(downloading, undefined);
                yield* Deferred.await(release);
                return exited(0);
              })
            : Effect.succeed(exited(0)),
        ({ datasets, commands }) =>
          Effect.gen(function* () {
            const job = yield* datasets.download({ name: "mimic-iv-demo" });
            yield* Deferred.await(downloading);
            expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toEqual({
              kind: "download",
              state: "running",
              phase: "downloading",
              completed: 1,
              total: 3,
              file: { name: "labevents.csv.gz", bytes: 1024, totalBytes: 4096 },
              message: "Downloading the raw files.",
            });

            yield* Deferred.succeed(release, undefined);
            yield* Fiber.await(job);
            expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toBeUndefined();
            // Downloading only fetches raw files; `init` makes them queryable.
            expect(commands.filter((args) => args[0] !== "list-datasets")).toEqual([
              ["download", "mimic-iv-demo", "--json", "--events", "ndjson"],
              ["init", "mimic-iv-demo", "--no-interactive", "--json", "--events", "ndjson"],
            ]);
          }),
      );
    }),
  );

  it.effect("keeps why a job failed until it is dismissed", () =>
    withDatasets(
      (run) =>
        Effect.sync(() => {
          run.onStdoutChunk?.(
            events({
              event: "operation_failed",
              command: "download",
              error: {
                code: "physionet_access_forbidden",
                message: "PhysioNet access is forbidden for https://physionet.org/files/mimiciv/.",
              },
            }),
          );
          return exited(1);
        }),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          yield* Fiber.await(yield* datasets.download({ name: "mimic-iv" }));
          expect(jobOf(yield* datasets.list, "mimic-iv")).toMatchObject({
            state: "failed",
            message: expect.stringContaining("does not have access to mimic-iv yet"),
            detail: "PhysioNet access is forbidden for https://physionet.org/files/mimiciv/.",
          });
          // A failed download is not followed by an attempt to prepare nothing.
          expect(commands.some((args) => args[0] === "init")).toBe(false);

          yield* datasets.cancel("mimic-iv");
          expect(jobOf(yield* datasets.list, "mimic-iv")).toBeUndefined();
        }),
    ),
  );

  it.effect("reports the end of M4's output when it fails without saying why", () =>
    withDatasets(
      () => Effect.succeed(exited(2, "", "Traceback: disk full")),
      ({ datasets }) =>
        Effect.gen(function* () {
          yield* Fiber.await(yield* datasets.download({ name: "mimic-iv-demo" }));
          expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toMatchObject({
            state: "failed",
            message: "Preparing mimic-iv-demo did not finish.",
            detail: "Traceback: disk full",
          });
        }),
    ),
  );

  it.effect("stops the running command when a job is cancelled", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      yield* withDatasets(
        () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
          ),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* datasets.download({ name: "mimic-iv-demo" });
            yield* Deferred.await(started);
            yield* datasets.cancel("mimic-iv-demo");
            yield* Deferred.await(stopped);
            expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toBeUndefined();
          }),
      );
    }),
  );

  it.effect("prepares a dataset from a folder of raw files", () =>
    withDatasets(
      (run) =>
        Effect.sync(() => {
          run.onStdoutChunk?.(
            events(
              { event: "conversion_started", file_count: 31 },
              { event: "conversion_file_completed", completed: 31 },
              { event: "duckdb_init_started", file_count: 31 },
              { event: "duckdb_view_created", completed: 12 },
            ),
          );
          return exited(0);
        }),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const source = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-raw-" });
          yield* Fiber.await(yield* datasets.add({ name: "eicu", source }));
          expect(commands).toContainEqual([
            "init",
            "eicu",
            "--src",
            source,
            "--no-interactive",
            "--json",
            "--events",
            "ndjson",
          ]);
        }),
    ),
  );

  it.effect("starts nothing for a folder that does not exist", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const failure = yield* datasets
            .add({ name: "eicu", source: "/nowhere/eicu-raw" })
            .pipe(Effect.flip);
          expect(failure.message).toContain("does not exist");
          expect(commands).toEqual([]);
        }),
    ),
  );

  it.effect("refuses a name that M4 would read as an option", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const failure = yield* datasets.download({ name: "--target=/etc" }).pipe(Effect.flip);
          expect(failure.message).toContain("is not a dataset name");
          expect(commands).toEqual([]);
        }),
    ),
  );

  it.effect("does not run two jobs on one dataset", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      yield* withDatasets(
        () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* datasets.download({ name: "mimic-iv-demo" });
            yield* Deferred.await(started);
            const failure = yield* datasets.download({ name: "mimic-iv-demo" }).pipe(Effect.flip);
            expect(failure.message).toBe("mimic-iv-demo is already being prepared.");
          }),
      );
    }),
  );

  it.effect("starts nothing before M4 is installed", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const failure = yield* datasets.download({ name: "mimic-iv-demo" }).pipe(Effect.flip);
          expect(failure.message).toBe("The clinical environment is not set up yet.");
          expect(commands).toEqual([]);
        }),
      { ...READY, state: "installing", step: "packages" },
    ),
  );
});
