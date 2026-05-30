import { TurnId } from "@t3tools/contracts";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  cards?: "1" | undefined;
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
): Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "cards"> {
  const { diff: _diff, diffTurnId: _diffTurnId, diffFilePath: _diffFilePath, ...rest } = params;
  const { cards: _cards, ...withoutCards } = rest;
  return withoutCards as Omit<T, "diff" | "diffTurnId" | "diffFilePath" | "cards">;
}

export function stripCardSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "cards"> {
  const { cards: _cards, ...rest } = params;
  return rest as Omit<T, "cards">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const cards = isOpenValue(search.cards) ? "1" : undefined;
  const diff = !cards && isOpenValue(search.diff) ? "1" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(cards ? { cards } : {}),
  };
}
