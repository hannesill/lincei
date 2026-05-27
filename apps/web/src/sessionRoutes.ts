import { scopeSessionRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ScopedSessionRef, SessionId } from "@t3tools/contracts";
import type { DraftId } from "./composerDraftStore";

export type SessionRouteTarget =
  | {
      kind: "server";
      sessionRef: ScopedSessionRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

export function buildSessionRouteParams(ref: ScopedSessionRef): {
  environmentId: EnvironmentId;
  sessionId: SessionId;
} {
  return {
    environmentId: ref.environmentId,
    sessionId: ref.sessionId,
  };
}

export function buildDraftSessionRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

export function resolveSessionRouteRef(
  params: Partial<Record<"environmentId" | "sessionId", string | undefined>>,
): ScopedSessionRef | null {
  if (!params.environmentId || !params.sessionId) {
    return null;
  }

  return scopeSessionRef(params.environmentId as EnvironmentId, params.sessionId as SessionId);
}

export function resolveSessionRouteTarget(
  params: Partial<Record<"environmentId" | "sessionId" | "draftId", string | undefined>>,
): SessionRouteTarget | null {
  if (params.environmentId && params.sessionId) {
    return {
      kind: "server",
      sessionRef: scopeSessionRef(
        params.environmentId as EnvironmentId,
        params.sessionId as SessionId,
      ),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}
