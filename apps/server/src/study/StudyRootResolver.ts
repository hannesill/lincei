import type { ProjectId, SessionId } from "@t3tools/contracts";
import { StudyRecordError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

function projectionReadError(cause: unknown): StudyRecordError {
  return new StudyRecordError({
    message: "Failed to resolve study workspace.",
    cause,
  });
}

function unknownProjectError(projectId: ProjectId): StudyRecordError {
  return new StudyRecordError({
    message: `Unknown or deleted project: ${projectId}.`,
  });
}

function unknownSessionError(sessionId: SessionId): StudyRecordError {
  return new StudyRecordError({
    message: `Unknown or deleted session: ${sessionId}.`,
  });
}

export function resolveStudyRootForProject(
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  projectId: ProjectId,
): Effect.Effect<string, StudyRecordError> {
  return projectionSnapshotQuery.getProjectShellById(projectId).pipe(
    Effect.mapError(projectionReadError),
    Effect.flatMap((projectOption) =>
      Option.match(projectOption, {
        onNone: () => Effect.fail(unknownProjectError(projectId)),
        onSome: (project) => Effect.succeed(project.workspaceRoot),
      }),
    ),
  );
}

export function resolveStudyRootForSession(
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  sessionId: SessionId,
): Effect.Effect<string, StudyRecordError> {
  return projectionSnapshotQuery.getSessionShellById(sessionId).pipe(
    Effect.mapError(projectionReadError),
    Effect.flatMap((sessionOption) =>
      Option.match(sessionOption, {
        onNone: () => Effect.fail(unknownSessionError(sessionId)),
        onSome: (session) =>
          session.worktreePath
            ? Effect.succeed(session.worktreePath)
            : resolveStudyRootForProject(projectionSnapshotQuery, session.projectId),
      }),
    ),
  );
}
