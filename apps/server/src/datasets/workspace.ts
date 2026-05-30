import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { DatasetRpcError } from "@t3tools/contracts";

import type { ServerConfigShape } from "../config.ts";

function workspacePathError(error: unknown): DatasetRpcError {
  const detail = error instanceof Error ? error.message : String(error);
  return new DatasetRpcError({
    code: "settings_error",
    detail,
    actionableMessage: "Lincei could not prepare the dataset workspace directory.",
  });
}

export function makeDatasetWorkspacePathResolver(input: {
  readonly config: ServerConfigShape;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  return (rawWorkspacePath: string) => {
    const rawPath = rawWorkspacePath.trim();
    const expandedPath =
      rawPath.length === 0
        ? input.config.datasetsDir
        : rawPath === "~"
          ? NodeOS.homedir()
          : rawPath.startsWith("~/") || rawPath.startsWith("~\\")
            ? input.path.join(NodeOS.homedir(), rawPath.slice(2))
            : rawPath;
    const resolvedPath = input.path.resolve(expandedPath);
    return input.fileSystem
      .makeDirectory(resolvedPath, { recursive: true })
      .pipe(Effect.mapError(workspacePathError), Effect.as(resolvedPath));
  };
}
