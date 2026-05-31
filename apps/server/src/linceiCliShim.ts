import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "./atomicWrite.ts";
import { type ServerConfigShape } from "./config.ts";
import { configureLinceiCliAmbientEnvironment } from "./provider/LinceiAmbientEnvironment.ts";

export class LinceiCliShimError extends Data.TaggedError("LinceiCliShimError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface LinceiCliShimSetup {
  readonly binDir: string;
  readonly shimPath: string;
  readonly cliEntrypoint: string;
}

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const pathSeparatorFor = (basePath: string) => (basePath.includes("\\") ? "\\" : "/");

const basename = (basePath: string): string => {
  const normalized = basePath.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) ?? normalized;
};

const joinPath = (basePath: string, leaf: string): string => {
  const separator = pathSeparatorFor(basePath);
  return `${basePath.replace(/[\\/]+$/, "")}${separator}${leaf}`;
};

export function resolveLinceiCliEntrypoint(moduleDir = import.meta.dirname): string {
  if (basename(moduleDir) === "src") {
    return joinPath(moduleDir, "lincei.ts");
  }
  return joinPath(moduleDir, "lincei.mjs");
}

export function renderPosixLinceiCliShim(input: {
  readonly nodePath: string;
  readonly cliEntrypoint: string;
}): string {
  return [
    "#!/bin/sh",
    `exec ${shellSingleQuote(input.nodePath)} ${shellSingleQuote(input.cliEntrypoint)} "$@"`,
    "",
  ].join("\n");
}

export function renderWindowsLinceiCliShim(input: {
  readonly nodePath: string;
  readonly cliEntrypoint: string;
}): string {
  return ["@echo off", `"${input.nodePath}" "${input.cliEntrypoint}" %*`, ""].join("\r\n");
}

export const ensureLinceiCliShim = Effect.fn("ensureLinceiCliShim")(function* (input: {
  readonly binDir: string;
  readonly cliEntrypoint: string;
  readonly nodePath?: string;
}): Effect.fn.Return<LinceiCliShimSetup, LinceiCliShimError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nodePath = input.nodePath ?? process.execPath;
  const shimPath = path.join(input.binDir, process.platform === "win32" ? "lincei.cmd" : "lincei");

  const cliExists = yield* fs.exists(input.cliEntrypoint).pipe(
    Effect.mapError(
      (cause) =>
        new LinceiCliShimError({
          message: `Failed to inspect Lincei CLI entrypoint at ${input.cliEntrypoint}.`,
          cause,
        }),
    ),
  );
  if (!cliExists) {
    return yield* new LinceiCliShimError({
      message: `Lincei CLI entrypoint not found at ${input.cliEntrypoint}.`,
    });
  }

  const nodeExists = yield* fs.exists(nodePath).pipe(
    Effect.mapError(
      (cause) =>
        new LinceiCliShimError({
          message: `Failed to inspect Node executable at ${nodePath}.`,
          cause,
        }),
    ),
  );
  if (!nodeExists) {
    return yield* new LinceiCliShimError({
      message: `Node executable for the Lincei CLI shim not found at ${nodePath}.`,
    });
  }

  yield* fs.makeDirectory(input.binDir, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new LinceiCliShimError({
          message: `Failed to create Lincei CLI shim directory at ${input.binDir}.`,
          cause,
        }),
    ),
  );

  const contents =
    process.platform === "win32"
      ? renderWindowsLinceiCliShim({ nodePath, cliEntrypoint: input.cliEntrypoint })
      : renderPosixLinceiCliShim({ nodePath, cliEntrypoint: input.cliEntrypoint });

  yield* writeFileStringAtomically({ filePath: shimPath, contents }).pipe(
    Effect.mapError(
      (cause) =>
        new LinceiCliShimError({
          message: `Failed to write Lincei CLI shim at ${shimPath}.`,
          cause,
        }),
    ),
  );

  if (process.platform !== "win32") {
    yield* fs.chmod(shimPath, 0o755).pipe(
      Effect.mapError(
        (cause) =>
          new LinceiCliShimError({
            message: `Failed to mark Lincei CLI shim executable at ${shimPath}.`,
            cause,
          }),
      ),
    );
  }

  return {
    binDir: input.binDir,
    shimPath,
    cliEntrypoint: input.cliEntrypoint,
  };
});

export const ensureConfiguredLinceiCliShim = Effect.fn("ensureConfiguredLinceiCliShim")(function* (
  config: Pick<ServerConfigShape, "runtimeBinDir">,
) {
  const shim = yield* ensureLinceiCliShim({
    binDir: config.runtimeBinDir,
    cliEntrypoint: resolveLinceiCliEntrypoint(),
  });
  configureLinceiCliAmbientEnvironment({
    binDir: shim.binDir,
    cliPath: shim.shimPath,
  });
  return shim;
});
