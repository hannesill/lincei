import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ClinicalDataset } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";

const m4Dataset = (
  name: string,
  fields: {
    readonly setup_state: string;
    readonly raw_present?: boolean;
    readonly parquet_present?: boolean;
    readonly requires_authentication?: boolean;
    readonly parquet_size_gb?: number | null;
    readonly raw_root?: string;
    readonly parquet_root?: string;
    readonly db_path?: string;
    readonly prepared?: boolean;
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

const listingOf = (...datasets: ReadonlyArray<ReturnType<typeof m4Dataset>>) =>
  JSON.stringify({ version: 1, ok: true, command: "list-datasets", data: { datasets } });

const LISTING = listingOf(
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
);

/** What `m4 capabilities --json` reports about the download command, as M4 0.5.5 does. */
const capabilitiesWith = (...downloadFlags: ReadonlyArray<string>) =>
  JSON.stringify({
    schema_version: 1,
    commands: [
      { name: "capabilities", flags: ["--json"], mutates: false },
      {
        name: "download",
        flags: ["--target", "--json", "--command-only", ...downloadFlags, "--events"],
        mutates: true,
      },
    ],
  });
const M4_0_5_5 = capabilitiesWith("--physionet-credentials-file");
const M4_WITH_STDIN_LOGIN = capabilitiesWith(
  "--physionet-credentials-file",
  "--physionet-credentials-stdin",
);

/** What `m4 download <name> --command-only --json` reports: a source, and its view of a raw folder. */
const planOf = (fields: {
  readonly file_listing_url?: string;
  readonly layout?: {
    readonly ok: boolean;
    readonly warnings?: ReadonlyArray<string>;
    readonly errors?: ReadonlyArray<string>;
    readonly csv_gz_count?: number;
    readonly empty_csv_gz?: ReadonlyArray<string>;
  };
}) =>
  JSON.stringify({
    version: 1,
    ok: true,
    command: "download",
    file_listing_url: "https://physionet.org/files/mimiciv/3.1/",
    layout: { ok: true, warnings: [], errors: [], csv_gz_count: 31, empty_csv_gz: [] },
    status: "command_only",
    ...fields,
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

/** M4 finishing a command the way it says so: with its last event, then exit code 0. */
const finished = (run: Run) => {
  run.onStdoutChunk?.(events({ event: "operation_completed", command: run.args[0] }));
  return exited(0);
};

/** The commands that change a dataset, as opposed to the ones that only report. */
const workOf = (commands: ReadonlyArray<ReadonlyArray<string>>) =>
  commands.filter(
    (args) => args[0] === "init" || (args[0] === "download" && !args.includes("--command-only")),
  );

interface Machine {
  readonly datasets: ClinicalDatasets.ClinicalDatasets["Service"];
  /** Every M4 command that was run, by its arguments. */
  readonly commands: Array<ReadonlyArray<string>>;
  /** M4's program file, which installing another M4 replaces. */
  readonly m4Program: string;
}

/**
 * The datasets service on a machine whose M4 is `m4`: it answers the commands
 * that change a dataset, while the ones that only report print what `options`
 * says. The clinical home is a real folder, a new one unless `baseDir` names
 * the home of an earlier run.
 */
const withDatasets = <A, E>(
  m4: (run: Run) => Effect.Effect<ProcessRunner.ProcessRunOutput>,
  use: (machine: Machine) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
  options: {
    readonly baseDir?: string;
    readonly platform?: NodeJS.Platform;
    /** Whether the clinical research tools are installed. */
    readonly installed?: boolean;
    readonly listing?: string | (() => Effect.Effect<string>);
    readonly capabilities?: string | (() => string);
    readonly plan?: (args: ReadonlyArray<string>) => string;
    /** The server's own environment, for a user who exported `M4_DATA_DIR`. */
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
) => {
  const commands: Array<ReadonlyArray<string>> = [];
  const report = (run: Run): Effect.Effect<string> | undefined => {
    if (run.args[0] === "list-datasets") {
      const listing = options.listing ?? LISTING;
      return typeof listing === "string" ? Effect.succeed(listing) : listing();
    }
    if (run.args[0] === "capabilities") {
      const capabilities = options.capabilities ?? M4_0_5_5;
      return Effect.succeed(typeof capabilities === "string" ? capabilities : capabilities());
    }
    if (run.args.includes("--command-only")) {
      return Effect.succeed((options.plan ?? (() => planOf({})))(run.args));
    }
    return undefined;
  };
  const layerDependencies = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), options.baseDir ?? { prefix: "lincei-datasets-test-" }),
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (run) => {
          commands.push(run.args);
          const reported = report(run);
          return reported === undefined
            ? m4(run)
            : Effect.map(reported, (stdout) => exited(0, stdout));
        },
      }),
    ),
    Layer.succeed(HostProcessPlatform, options.platform ?? "darwin"),
    // Never the developer's own dataset store.
    Layer.succeed(HostProcessEnvironment, options.environment ?? {}),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { baseDir } = yield* ServerConfig.ServerConfig;
    const m4Program = path.join(baseDir, "clinical", "venv", "bin", "m4");
    if (options.installed !== false) {
      yield* fileSystem.makeDirectory(path.dirname(m4Program), { recursive: true });
      yield* fileSystem.writeFileString(m4Program, "");
    }
    const datasets = yield* ClinicalDatasets.ClinicalDatasets;
    return yield* use({ datasets, commands, m4Program });
  }).pipe(
    Effect.provide(ClinicalDatasets.layer.pipe(Layer.provideMerge(layerDependencies))),
    Effect.scoped,
  );
};

const datasetOf = (datasets: ReadonlyArray<ClinicalDataset>, name: string) =>
  datasets.find((dataset) => dataset.name === name);

const jobOf = (datasets: ReadonlyArray<ClinicalDataset>, name: string) =>
  datasetOf(datasets, name)?.job;

/**
 * An M4 that keeps a dataset on disk the way the real one does, with the two
 * habits that let a half-prepared dataset pass for a whole one: it converts
 * nothing once any converted file exists, and it calls a dataset ready once a
 * converted file and a database exist. The database here is the list of
 * tables it was built from.
 */
const diskM4 = Effect.fn(function* (input: {
  readonly dataDir: string;
  /** Runs before each raw file is converted, so a test can stop M4 there. */
  readonly beforeConverting?: (file: string) => Effect.Effect<void>;
  /** Runs once the database is built, before M4 reports that it finished. */
  readonly beforeFinishing?: Effect.Effect<void>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // M4 reports its paths with links resolved, which on macOS a temp folder has.
  yield* fileSystem.makeDirectory(input.dataDir, { recursive: true });
  const dataDir = yield* fileSystem.realPath(input.dataDir);
  const rawRoot = (name: string) => path.join(dataDir, "raw_files", name);
  const parquetRoot = (name: string) => path.join(dataDir, "parquet", name);
  const database = (name: string) => path.join(dataDir, "databases", `${name}.duckdb`);
  const filesIn = (root: string, suffix: string) =>
    fileSystem.readDirectory(root, { recursive: true }).pipe(
      Effect.map((entries) => entries.filter((entry) => entry.endsWith(suffix)).sort()),
      Effect.orElseSucceed((): Array<string> => []),
    );

  const describe = (name: string) =>
    Effect.gen(function* () {
      const rawPresent = (yield* filesIn(rawRoot(name), ".csv.gz")).length > 0;
      const parquetPresent = (yield* filesIn(parquetRoot(name), ".parquet")).length > 0;
      const databasePresent = yield* fileSystem.exists(database(name));
      return m4Dataset(name, {
        setup_state:
          parquetPresent && databasePresent
            ? "ready"
            : parquetPresent
              ? "missing_database"
              : rawPresent
                ? "missing_parquet"
                : "missing_raw_files",
        raw_present: rawPresent,
        parquet_present: parquetPresent,
        raw_root: rawRoot(name),
        parquet_root: parquetRoot(name),
        db_path: database(name),
      });
    });

  const init = (run: Run) =>
    Effect.gen(function* () {
      const name = run.args[1] ?? "";
      const source = run.args.includes("--src")
        ? (run.args[run.args.indexOf("--src") + 1] ?? "")
        : rawRoot(name);
      if ((yield* filesIn(parquetRoot(name), ".parquet")).length === 0) {
        const raw = yield* filesIn(source, ".csv.gz");
        run.onStdoutChunk?.(events({ event: "conversion_started", file_count: raw.length }));
        for (const [index, file] of raw.entries()) {
          yield* input.beforeConverting?.(file) ?? Effect.void;
          const converted = path.join(parquetRoot(name), file.replace(/\.csv\.gz$/, ".parquet"));
          yield* fileSystem.makeDirectory(path.dirname(converted), { recursive: true });
          yield* fileSystem.writeFileString(converted, "");
          run.onStdoutChunk?.(events({ event: "conversion_file_completed", completed: index + 1 }));
        }
      }
      const tables = yield* filesIn(parquetRoot(name), ".parquet");
      run.onStdoutChunk?.(events({ event: "duckdb_init_started", file_count: tables.length }));
      yield* fileSystem.makeDirectory(path.dirname(database(name)), { recursive: true });
      yield* fileSystem.writeFileString(database(name), JSON.stringify(tables));
      yield* input.beforeFinishing ?? Effect.void;
      return finished(run);
    }).pipe(Effect.orDie);

  return {
    init,
    /** What `list-datasets --json --paths` prints for these datasets right now. */
    listing: (...names: ReadonlyArray<string>) =>
      Effect.forEach(names, describe).pipe(
        Effect.map((datasets) => listingOf(...datasets)),
        Effect.orDie,
      ),
    /** The tables of a dataset's database, or none when it has no database. */
    tables: (name: string) =>
      fileSystem.readFileString(database(name)).pipe(
        Effect.map((json): ReadonlyArray<string> => JSON.parse(json)),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      ),
  };
});

/** A clinical home of its own, for a test that looks at M4's files or starts the service twice. */
const clinicalHome = Effect.fn(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-datasets-test-" });
  return { baseDir, dataDir: path.join(baseDir, "clinical", "m4_data") };
});

/** A folder of raw files as a researcher would have downloaded them. */
const rawFolder = Effect.fn(function* (...files: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lincei-raw-" });
  for (const file of files) {
    yield* fileSystem.makeDirectory(path.join(folder, path.dirname(file)), { recursive: true });
    yield* fileSystem.writeFileString(path.join(folder, file), "raw");
  }
  return folder;
});

const MIMIC_FILES = ["hosp/admissions.csv.gz", "hosp/patients.csv.gz", "icu/chartevents.csv.gz"];
const MIMIC_TABLES = [
  "hosp/admissions.parquet",
  "hosp/patients.parquet",
  "icu/chartevents.parquet",
];

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
                return finished(run);
              })
            : Effect.sync(() => finished(run)),
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
            expect(workOf(commands)).toEqual([
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
          yield* Fiber.await(
            yield* datasets.download({
              name: "mimic-iv",
              credentials: { username: "ada", password: Redacted.make("not-shown") },
            }),
          );
          expect(jobOf(yield* datasets.list, "mimic-iv")).toMatchObject({
            state: "failed",
            message: expect.stringContaining(
              "This PhysioNet account has no access to mimic-iv yet",
            ),
            detail: "PhysioNet access is forbidden for https://physionet.org/files/mimiciv/.",
          });
          // A failed download is not followed by an attempt to prepare nothing.
          expect(commands.some((args) => args[0] === "init")).toBe(false);

          yield* datasets.cancel("mimic-iv");
          expect(jobOf(yield* datasets.list, "mimic-iv")).toBeUndefined();
        }),
    ),
  );

  it.effect("says what to do next when M4 fails, and keeps what M4 printed as the detail", () =>
    withDatasets(
      (run) =>
        Effect.sync(() => {
          if (run.args[0] === "download") return finished(run);
          run.onStdoutChunk?.(
            events({
              event: "operation_failed",
              error: {
                code: "verification_failed",
                message:
                  'Verification failed: Catalog Error: Table with name admissions does not exist!\nDid you mean "pg_catalog.pg_description"?',
              },
            }),
          );
          return exited(1);
        }),
      ({ datasets }) =>
        Effect.gen(function* () {
          yield* Fiber.await(yield* datasets.download({ name: "mimic-iv-demo" }));
          const job = jobOf(yield* datasets.list, "mimic-iv-demo");
          expect(job).toMatchObject({
            state: "failed",
            // In the user's words, with the way to retry. M4's own text is the detail.
            message:
              "Lincei prepared mimic-iv-demo, but its main table is missing or cannot be read, so it is not ready. Check that the raw files are complete. Choose Download again to retry.",
            detail: expect.stringContaining("Catalog Error"),
          });
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
            message: "Preparing mimic-iv-demo did not finish. Choose Download again to retry.",
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
          return finished(run);
        }),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const source = yield* rawFolder("patient.csv.gz");
          expect(yield* Fiber.join(yield* datasets.add({ name: "eicu", source }))).toBe(true);
          expect(workOf(commands)).toEqual([
            ["init", "eicu", "--src", source, "--no-interactive", "--json", "--events", "ndjson"],
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
          expect(failure.message).toContain(
            'Lincei does not know a dataset called "--target=/etc"',
          );
          expect(commands).toEqual([]);
        }),
    ),
  );

  it.effect("does not run two jobs on one dataset, however its name is typed", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      yield* withDatasets(
        () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* datasets.download({ name: "mimic-iv-demo" });
            yield* Deferred.await(started);
            // M4 treats names without regard to case.
            const failure = yield* datasets.download({ name: "MIMIC-IV-Demo" }).pipe(Effect.flip);
            expect(failure.message).toBe(
              "mimic-iv-demo is already being prepared. Wait for it to finish, or cancel it first.",
            );
          }),
      );
    }),
  );

  describe("a preparation that did not finish", () => {
    it.effect("is converted again from the start by the next attempt", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { baseDir, dataDir } = yield* clinicalHome();
        const source = yield* rawFolder(...MIMIC_FILES);
        const twoConverted = yield* Deferred.make<void>();
        let cancelling = true;
        const m4 = yield* diskM4({
          dataDir,
          beforeConverting: (file) =>
            cancelling && file === "icu/chartevents.csv.gz"
              ? Deferred.succeed(twoConverted, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
        });

        yield* withDatasets(
          m4.init,
          ({ datasets }) =>
            Effect.gen(function* () {
              // Cancelled while M4 converts the last of three files.
              yield* datasets.add({ name: "mimic-iv", source });
              yield* Deferred.await(twoConverted);
              yield* datasets.cancel("mimic-iv");
              expect(datasetOf(yield* datasets.list, "mimic-iv")?.state).toBe("incomplete");

              cancelling = false;
              expect(yield* Fiber.join(yield* datasets.add({ name: "mimic-iv", source }))).toBe(
                true,
              );
              expect(datasetOf(yield* datasets.list, "mimic-iv")?.state).toBe("ready");
              // M4 by itself would have kept the two files it had and built a
              // database without the third table.
              expect(yield* m4.tables("mimic-iv")).toEqual(MIMIC_TABLES);
              // What was removed is what M4 made, never what the user has.
              expect((yield* fileSystem.readDirectory(source, { recursive: true })).sort()).toEqual(
                ["hosp", ...MIMIC_FILES.slice(0, 2), "icu", ...MIMIC_FILES.slice(2)],
              );
            }),
          { baseDir, listing: () => m4.listing("mimic-iv") },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("stays incomplete across a restart, whatever M4 says about it", () =>
      Effect.gen(function* () {
        const { baseDir, dataDir } = yield* clinicalHome();
        const source = yield* rawFolder(...MIMIC_FILES);
        const databaseBuilt = yield* Deferred.make<void>();
        let stopping = true;
        const m4 = yield* diskM4({
          dataDir,
          beforeFinishing: Effect.suspend(() =>
            stopping
              ? Deferred.succeed(databaseBuilt, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
          ),
        });
        const machine = { baseDir, listing: () => m4.listing("mimic-iv") };

        // The server stops when M4 has built the database and not yet said it finished.
        yield* withDatasets(
          m4.init,
          ({ datasets }) =>
            Effect.gen(function* () {
              yield* datasets.add({ name: "mimic-iv", source });
              yield* Deferred.await(databaseBuilt);
            }),
          machine,
        );
        // All its files are there, which is all M4 looks at.
        expect(yield* m4.listing("mimic-iv")).toContain('"setup_state":"ready"');

        stopping = false;
        yield* withDatasets(
          m4.init,
          ({ datasets }) =>
            Effect.gen(function* () {
              expect(datasetOf(yield* datasets.list, "mimic-iv")?.state).toBe("incomplete");
              expect(yield* Fiber.join(yield* datasets.add({ name: "mimic-iv", source }))).toBe(
                true,
              );
              expect(datasetOf(yield* datasets.list, "mimic-iv")?.state).toBe("ready");
            }),
          machine,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("is converted again when it was interrupted outside Lincei", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { baseDir, dataDir } = yield* clinicalHome();
        const source = yield* rawFolder(...MIMIC_FILES);
        const m4 = yield* diskM4({ dataDir });
        // What an agent's own `m4 init` leaves when it is stopped while converting:
        // some converted files, no database, and nothing that tells Lincei.
        const converted = path.join(dataDir, "parquet", "mimic-iv", "hosp");
        yield* fileSystem.makeDirectory(converted, { recursive: true });
        yield* fileSystem.writeFileString(path.join(converted, "admissions.parquet"), "");

        yield* withDatasets(
          m4.init,
          ({ datasets }) =>
            Effect.gen(function* () {
              expect(datasetOf(yield* datasets.list, "mimic-iv")?.state).toBe("incomplete");
              expect(yield* Fiber.join(yield* datasets.add({ name: "mimic-iv", source }))).toBe(
                true,
              );
              expect(yield* m4.tables("mimic-iv")).toEqual(MIMIC_TABLES);
            }),
          { baseDir, listing: () => m4.listing("mimic-iv") },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("is not ready when M4 exits without saying that it finished", () =>
      withDatasets(
        () => Effect.succeed(exited(0)),
        ({ datasets }) =>
          Effect.gen(function* () {
            const source = yield* rawFolder("patient.csv.gz");
            expect(yield* Fiber.join(yield* datasets.add({ name: "eicu", source }))).toBe(false);
            expect(datasetOf(yield* datasets.list, "eicu")).toMatchObject({
              state: "incomplete",
              job: {
                state: "failed",
                message: "Preparing eicu did not finish. Choose Add from folder again to retry.",
              },
            });
          }),
        // M4 would call it ready: it only looks at which files exist.
        { listing: listingOf(m4Dataset("eicu", { setup_state: "ready", parquet_present: true })) },
      ),
    );

    it.effect("removes nothing that M4 keeps outside its dataset store", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const source = yield* rawFolder("patient.csv.gz");
        // A converted-files folder of the user's own, which an edited M4 configuration names.
        const elsewhere = yield* rawFolder("patient.parquet");
        yield* withDatasets(
          () => Effect.succeed(exited(0)),
          ({ datasets }) =>
            Effect.gen(function* () {
              // Leaves the mark: M4 never says that it finished.
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              expect(jobOf(yield* datasets.list, "eicu")).toMatchObject({
                state: "failed",
                message: expect.stringContaining("outside Lincei's dataset storage"),
              });
              expect(yield* fileSystem.exists(path.join(elsewhere, "patient.parquet"))).toBe(true);
            }),
          {
            listing: listingOf(
              m4Dataset("eicu", {
                setup_state: "ready",
                parquet_present: true,
                parquet_root: elsewhere,
                db_path: path.join(elsewhere, "eicu.duckdb"),
              }),
            ),
          },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("leaves the converted files to an M4 that completes a dataset itself", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { baseDir, dataDir } = yield* clinicalHome();
        const source = yield* rawFolder("patient.csv.gz");
        const parquetRoot = path.join(dataDir, "parquet", "eicu");
        yield* fileSystem.makeDirectory(parquetRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(parquetRoot, "patient.parquet"), "");
        yield* withDatasets(
          () => Effect.succeed(exited(0)),
          ({ datasets }) =>
            Effect.gen(function* () {
              // Leaves the mark: M4 never says that it finished.
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              // Still not ready, and what M4 had converted is still there for it to build on.
              expect(datasetOf(yield* datasets.list, "eicu")?.state).toBe("incomplete");
              expect(yield* fileSystem.exists(path.join(parquetRoot, "patient.parquet"))).toBe(
                true,
              );
            }),
          {
            baseDir,
            listing: listingOf(
              m4Dataset("eicu", {
                setup_state: "incomplete",
                parquet_present: true,
                parquet_root: parquetRoot,
                db_path: path.join(dataDir, "databases", "eicu.duckdb"),
                prepared: false,
              }),
            ),
          },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("removes nothing from a dataset store the user chose themselves", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const source = yield* rawFolder("patient.csv.gz");
        // What `export M4_DATA_DIR=...` points at: outside Lincei's home.
        const ownStore = yield* fileSystem.makeTempDirectoryScoped({ prefix: "own-m4-data-" });
        const parquetRoot = path.join(ownStore, "parquet", "eicu");
        yield* fileSystem.makeDirectory(parquetRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(parquetRoot, "patient.parquet"), "");
        yield* withDatasets(
          () => Effect.succeed(exited(0)),
          ({ datasets }) =>
            Effect.gen(function* () {
              // Leaves the mark: M4 never says that it finished.
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              yield* Fiber.join(yield* datasets.add({ name: "eicu", source }));
              expect(jobOf(yield* datasets.list, "eicu")).toMatchObject({
                state: "failed",
                message: expect.stringContaining("Nothing was changed"),
              });
              expect(yield* fileSystem.exists(path.join(parquetRoot, "patient.parquet"))).toBe(
                true,
              );
            }),
          {
            environment: { M4_DATA_DIR: ownStore },
            listing: listingOf(
              m4Dataset("eicu", {
                setup_state: "ready",
                parquet_present: true,
                parquet_root: parquetRoot,
                db_path: path.join(ownStore, "databases", "eicu.duckdb"),
              }),
            ),
          },
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  });

  it.effect("starts nothing for a folder that is not laid out as the dataset", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          // The folder `wget -r` makes: PhysioNet's own folders around the dataset.
          const source = yield* rawFolder("files/mimiciv/3.1/hosp/admissions.csv.gz");
          const failure = yield* datasets.add({ name: "mimic-iv", source }).pipe(Effect.flip);
          expect(failure.message).toBe(
            "That folder is not laid out the way mimic-iv is on PhysioNet. Choose the folder that directly holds the dataset's own folders and files; in a PhysioNet download it is the one named after the dataset's version number.",
          );
          expect(failure.detail).toBe("Missing required raw subdirectories: hosp, icu");
          // M4 would have converted every file before failing, and then called it ready.
          expect(workOf(commands)).toEqual([]);
          expect(commands).toContainEqual([
            "download",
            "mimic-iv",
            "--target",
            source,
            "--command-only",
            "--json",
          ]);
        }),
      {
        plan: () =>
          planOf({
            layout: {
              ok: false,
              warnings: ["missing_required_subdirectories", "nested_physionet_layout"],
              errors: ["Missing required raw subdirectories: hosp, icu"],
              csv_gz_count: 1,
            },
          }),
      },
    ),
  );

  it.effect("starts nothing for a folder M4 would accept and make no tables from", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          // eICU's files belong at the top of the folder, and here they lie two folders down.
          const source = yield* rawFolder("eicu-crd/2.0/patient.csv.gz");
          const failure = yield* datasets.add({ name: "eicu", source }).pipe(Effect.flip);
          expect(failure.message).toContain(
            "That folder is not laid out the way eicu is on PhysioNet.",
          );
          expect(workOf(commands)).toEqual([]);
        }),
      {
        plan: () =>
          planOf({ layout: { ok: true, warnings: ["wrong_eicu_root_layout"], csv_gz_count: 31 } }),
      },
    ),
  );

  describe("with a PhysioNet login", () => {
    const PASSWORD = "correct-horse-battery-staple";
    const credentials = { username: "ada", password: Redacted.make(PASSWORD) };

    it.effect("hands the login to M4 on standard input and nowhere else", () => {
      const runs: Array<Run> = [];
      return withDatasets(
        (run) =>
          Effect.sync(() => {
            runs.push(run);
            return finished(run);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* Fiber.await(yield* datasets.download({ name: "mimic-iv", credentials }));

            const [download, prepare] = runs;
            expect(download?.args).toEqual([
              "download",
              "mimic-iv",
              "--physionet-credentials-file",
              "/dev/stdin",
              "--json",
              "--events",
              "ndjson",
            ]);
            expect(JSON.parse(download?.stdin ?? "")).toEqual({
              username: "ada",
              password: PASSWORD,
            });
            expect(JSON.stringify([download?.args, download?.env])).not.toContain(PASSWORD);
            // Typer's own crash report would print the login among M4's local variables.
            expect(download?.env).toMatchObject({ _TYPER_STANDARD_TRACEBACK: "1" });
            // Preparing the files needs no login, so it is not given one.
            expect(prepare?.args[0]).toBe("init");
            expect(prepare?.stdin).toBeUndefined();
            expect(JSON.stringify(prepare?.args)).not.toContain("credentials");
          }),
      );
    });

    it.effect("uses M4's own way to read a login from standard input where M4 has one", () => {
      const runs: Array<Run> = [];
      return withDatasets(
        (run) =>
          Effect.sync(() => {
            runs.push(run);
            return finished(run);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            expect(datasetOf(yield* datasets.list, "mimic-iv")).toMatchObject({
              downloadable: true,
            });
            yield* Fiber.await(yield* datasets.download({ name: "mimic-iv", credentials }));
            expect(runs[0]?.args).toEqual([
              "download",
              "mimic-iv",
              "--physionet-credentials-stdin",
              "--json",
              "--events",
              "ndjson",
            ]);
            expect(JSON.parse(runs[0]?.stdin ?? "")).toEqual({
              username: "ada",
              password: PASSWORD,
            });
          }),
        // `/dev/stdin` cannot be opened by a child of this server off macOS.
        { platform: "linux", capabilities: M4_WITH_STDIN_LOGIN },
      );
    });

    it.effect("offers only a folder where there is no way to hand M4 a login", () => {
      const runs: Array<Run> = [];
      return withDatasets(
        (run) =>
          Effect.sync(() => {
            runs.push(run);
            return finished(run);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            // A client reads this before it asks anyone for a password.
            expect(
              (yield* datasets.list).map((dataset) => [dataset.name, dataset.downloadable]),
            ).toEqual([
              ["mimic-iv-demo", true],
              ["mimic-iv", false],
              ["eicu", false],
            ]);
            const failure = yield* datasets
              .download({ name: "mimic-iv", credentials })
              .pipe(Effect.flip);
            expect(failure.message).toBe(
              "Lincei cannot download mimic-iv with a PhysioNet login on this computer yet. Download its files from physionet.org, then use Add from folder.",
            );
            expect(runs).toEqual([]);
          }),
        { platform: "linux", capabilities: M4_0_5_5 },
      );
    });

    it.effect("offers the download once an M4 that can be handed a login is installed", () => {
      let capabilities = M4_0_5_5;
      return withDatasets(
        () => Effect.succeed(exited(0)),
        ({ datasets, commands, m4Program }) =>
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const downloadable = Effect.map(
              datasets.list,
              (list) => datasetOf(list, "mimic-iv")?.downloadable,
            );
            expect(yield* downloadable).toBe(false);
            expect(yield* downloadable).toBe(false);
            // What M4 can do is asked once per installed M4, not with every list.
            expect(commands.filter((args) => args[0] === "capabilities")).toHaveLength(1);

            // Setup, or an agent, installs a newer M4 while the server runs.
            capabilities = M4_WITH_STDIN_LOGIN;
            yield* fileSystem.utimes(m4Program, 1_800_000_000, 1_800_000_000);
            expect(yield* downloadable).toBe(true);
          }),
        { platform: "linux", capabilities: () => capabilities },
      );
    });

    it.effect("does not send the login when the dataset would not download from PhysioNet", () =>
      Effect.gen(function* () {
        // Each of these is what one file in M4's dataset store can make of a built-in dataset.
        for (const address of [
          "https://example.test/collect/",
          "https://physionet.org.example.test/files/mimiciv/3.1/",
          "http://physionet.org/files/mimiciv/3.1/",
          "https://physionet.org@example.test/files/",
        ]) {
          const runs: Array<Run> = [];
          yield* withDatasets(
            (run) =>
              Effect.sync(() => {
                runs.push(run);
                return finished(run);
              }),
            ({ datasets, commands }) =>
              Effect.gen(function* () {
                const failure = yield* datasets
                  .download({ name: "mimic-iv", credentials })
                  .pipe(Effect.flip);
                expect(failure.message).toBe(
                  "The download address of mimic-iv was changed on this computer, so Lincei did not send your PhysioNet login. Download the files from physionet.org yourself and use Add from folder, or ask whoever manages this computer to undo the change.",
                );
                expect(runs).toEqual([]);
                expect(commands.some((args) => JSON.stringify(args).includes("stdin"))).toBe(false);
              }),
            { plan: () => planOf({ file_listing_url: address }) },
          );
        }
      }),
    );

    it.effect("keeps the password out of a failed job, whatever M4 printed", () =>
      withDatasets(
        (run) =>
          Effect.sync(() => {
            run.onStdoutChunk?.(
              events({
                event: "operation_failed",
                error: {
                  // Not a failure Lincei has its own words for.
                  code: "download_went_wrong",
                  message: `Tried ada:${PASSWORD} and gave up.`,
                },
              }),
            );
            return exited(1, "", `Traceback: auth=('ada', '${PASSWORD}')`);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* Fiber.await(yield* datasets.download({ name: "mimic-iv", credentials }));
            const job = jobOf(yield* datasets.list, "mimic-iv");
            expect(job).toMatchObject({
              state: "failed",
              // What M4 said is never the headline, so nothing it printed can be in it.
              message: "Preparing mimic-iv did not finish. Choose Download again to retry.",
              detail: "Tried ada:<redacted> and gave up.",
            });
            expect(JSON.stringify(job)).not.toContain(PASSWORD);
          }),
      ),
    );

    it.effect("hides the password before M4's output is cut down to its end", () =>
      Effect.gen(function* () {
        for (const crash of [
          // The 800 characters that are kept begin in the middle of the password.
          { stderr: `auth=('ada', '${PASSWORD}')${"\n  File m4/data_io.py".repeat(41)}` },
          // The runner kept only the start of the output, which ends inside the password.
          { stderr: `${"locals ".repeat(40)}password='${PASSWORD.slice(0, 20)}`, cutShort: true },
        ]) {
          yield* withDatasets(
            () =>
              Effect.succeed({
                ...exited(1, "", crash.stderr),
                stderrTruncated: crash.cutShort === true,
              }),
            ({ datasets }) =>
              Effect.gen(function* () {
                yield* Fiber.await(yield* datasets.download({ name: "mimic-iv", credentials }));
                const job = JSON.stringify(jobOf(yield* datasets.list, "mimic-iv"));
                expect(job).toContain('"state":"failed"');
                for (const part of [PASSWORD.slice(0, 8), PASSWORD.slice(-8)]) {
                  expect(job).not.toContain(part);
                }
              }),
          );
        }
      }),
    );

    it.effect("does not start a credentialed download without a login", () =>
      withDatasets(
        () => Effect.succeed(exited(0)),
        ({ datasets, commands }) =>
          Effect.gen(function* () {
            const failure = yield* datasets.download({ name: "mimic-iv" }).pipe(Effect.flip);
            expect(failure.message).toBe(
              "Downloading mimic-iv needs your PhysioNet login. Choose Download on its row and sign in.",
            );
            expect(workOf(commands)).toEqual([]);
          }),
      ),
    );

    it.effect("downloads an open dataset without the login it was sent", () => {
      const runs: Array<Run> = [];
      return withDatasets(
        (run) =>
          Effect.sync(() => {
            runs.push(run);
            return finished(run);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            yield* Fiber.await(yield* datasets.download({ name: "open-demo", credentials }));
            expect(runs.map((run) => run.stdin)).toEqual([undefined, undefined]);
            expect(JSON.stringify(runs.map((run) => run.args))).not.toContain("credentials");
          }),
        {
          listing: listingOf(m4Dataset("open-demo", { setup_state: "missing_raw_files" })),
        },
      );
    });
  });

  describe("the demo dataset during clinical setup", () => {
    it.effect("is downloaded as a job that shows how far it is, and cannot be started twice", () =>
      Effect.gen(function* () {
        const downloading = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        yield* withDatasets(
          (run) =>
            run.args[0] === "download"
              ? Effect.gen(function* () {
                  run.onStdoutChunk?.(
                    events(
                      { event: "download_started", file_count: 31 },
                      { event: "download_file_completed", path: "/data/hosp/patients.csv.gz" },
                      { event: "download_file_completed", path: "/data/hosp/admissions.csv.gz" },
                    ),
                  );
                  yield* Deferred.succeed(downloading, undefined);
                  yield* Deferred.await(release);
                  return finished(run);
                })
              : Effect.sync(() => finished(run)),
          ({ datasets, commands }) =>
            Effect.gen(function* () {
              expect(yield* datasets.demoReady).toBe(false);
              const setup = yield* Effect.forkChild(datasets.prepareDemo);
              yield* Deferred.await(downloading);
              expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toEqual({
                kind: "setup",
                state: "running",
                phase: "downloading",
                completed: 2,
                total: 31,
                message: "Downloading the raw files.",
              });

              const failure = yield* datasets.download({ name: "mimic-iv-demo" }).pipe(Effect.flip);
              expect(failure.message).toBe(
                "mimic-iv-demo is already being downloaded while the clinical research tools are set up. Wait for it to finish.",
              );
              // It ends with setup, not with a request to stop it.
              yield* datasets.cancel("mimic-iv-demo");
              expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toMatchObject({ kind: "setup" });

              yield* Deferred.succeed(release, undefined);
              expect(yield* Fiber.join(setup)).toBe(true);
              expect(yield* datasets.demoReady).toBe(true);
              expect(workOf(commands).map((args) => args[0])).toEqual(["download", "init"]);
            }),
          { listing: listingOf(m4Dataset("mimic-iv-demo", { setup_state: "missing_raw_files" })) },
        );
      }),
    );

    it.effect("leaves why it failed on the dataset, where it can be retried", () =>
      withDatasets(
        (run) =>
          Effect.sync(() => {
            run.onStdoutChunk?.(
              events({
                event: "operation_failed",
                error: { code: "download_network_failed", message: "Timeout occurred." },
              }),
            );
            return exited(1);
          }),
        ({ datasets }) =>
          Effect.gen(function* () {
            expect(yield* datasets.prepareDemo).toBe(false);
            expect(jobOf(yield* datasets.list, "mimic-iv-demo")).toMatchObject({
              kind: "setup",
              state: "failed",
              message:
                "The download of mimic-iv-demo stopped because the connection failed or PhysioNet did not answer. Check the internet connection, then choose Download again; files already downloaded are kept.",
            });
            expect(yield* datasets.demoReady).toBe(false);
          }),
        { listing: listingOf(m4Dataset("mimic-iv-demo", { setup_state: "missing_raw_files" })) },
      ),
    );
  });

  it.effect("starts nothing before the clinical research tools are installed", () =>
    withDatasets(
      () => Effect.succeed(exited(0)),
      ({ datasets, commands }) =>
        Effect.gen(function* () {
          const failure = yield* datasets.download({ name: "mimic-iv-demo" }).pipe(Effect.flip);
          expect(failure.message).toBe(
            "The clinical research tools are not installed yet. Set them up under Settings, Clinical Data.",
          );
          expect(commands).toEqual([]);
        }),
      { installed: false },
    ),
  );
});
