import type {
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationSession,
  ProjectId,
  SessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

export function findSessionById(
  readModel: OrchestrationReadModel,
  sessionId: SessionId,
): OrchestrationSession | undefined {
  return readModel.sessions.find((session) => session.id === sessionId);
}

export function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function listSessionsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationSession> {
  return readModel.sessions.filter((session) => session.projectId === projectId);
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireSession(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly sessionId: SessionId;
}): Effect.Effect<OrchestrationSession, OrchestrationCommandInvariantError> {
  const session = findSessionById(input.readModel, input.sessionId);
  if (session) {
    return Effect.succeed(session);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Session '${input.sessionId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireSessionArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly sessionId: SessionId;
}): Effect.Effect<OrchestrationSession, OrchestrationCommandInvariantError> {
  return requireSession(input).pipe(
    Effect.flatMap((session) =>
      session.archivedAt !== null
        ? Effect.succeed(session)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Session '${input.sessionId}' is not archived for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireSessionNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly sessionId: SessionId;
}): Effect.Effect<OrchestrationSession, OrchestrationCommandInvariantError> {
  return requireSession(input).pipe(
    Effect.flatMap((session) =>
      session.archivedAt === null
        ? Effect.succeed(session)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Session '${input.sessionId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireSessionAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly sessionId: SessionId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findSessionById(input.readModel, input.sessionId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Session '${input.sessionId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireNonNegativeInteger(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly field: string;
  readonly value: number;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.commandType,
      `${input.field} must be an integer greater than or equal to 0.`,
    ),
  );
}
