import { TurnId } from "@t3tools/contracts";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  preview?: "1" | undefined;
}

function isOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "preview"> {
  const { diff: _diff, diffTurnId: _diffTurnId, diffFilePath: _diffFilePath, ...rest } = params;
  const { preview: _preview, ...withoutPreview } = rest;
  return withoutPreview as Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "preview">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const preview = isOpenValue(search.preview) ? "1" : undefined;
  const diff = !preview && isOpenValue(search.diff) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(preview ? { preview } : {}),
  };
}
