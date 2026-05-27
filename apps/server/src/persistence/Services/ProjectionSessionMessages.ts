/**
 * ProjectionSessionMessageRepository - Projection repository interface for messages.
 *
 * Owns persistence operations for projected session messages rendered in the
 * orchestration read model.
 *
 * @module ProjectionSessionMessageRepository
 */
import {
  ChatAttachment,
  MessageId,
  OrchestrationMessageRole,
  SessionId,
  TurnId,
  IsoDateTime,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSessionMessage = Schema.Struct({
  messageId: MessageId,
  sessionId: SessionId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  isStreaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionSessionMessage = typeof ProjectionSessionMessage.Type;

export const ListProjectionSessionMessagesInput = Schema.Struct({
  sessionId: SessionId,
});
export type ListProjectionSessionMessagesInput = typeof ListProjectionSessionMessagesInput.Type;

export const GetProjectionSessionMessageInput = Schema.Struct({
  messageId: MessageId,
});
export type GetProjectionSessionMessageInput = typeof GetProjectionSessionMessageInput.Type;

export const DeleteProjectionSessionMessagesInput = Schema.Struct({
  sessionId: SessionId,
});
export type DeleteProjectionSessionMessagesInput = typeof DeleteProjectionSessionMessagesInput.Type;

/**
 * ProjectionSessionMessageRepositoryShape - Service API for projected session messages.
 */
export interface ProjectionSessionMessageRepositoryShape {
  /**
   * Insert or replace a projected session message row.
   *
   * Upserts by `messageId`.
   */
  readonly upsert: (
    message: ProjectionSessionMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected session message by id.
   */
  readonly getByMessageId: (
    input: GetProjectionSessionMessageInput,
  ) => Effect.Effect<Option.Option<ProjectionSessionMessage>, ProjectionRepositoryError>;

  /**
   * List projected session messages for a session.
   *
   * Returned in ascending creation order.
   */
  readonly listBySessionId: (
    input: ListProjectionSessionMessagesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionSessionMessage>, ProjectionRepositoryError>;

  /**
   * Delete projected session messages by session.
   */
  readonly deleteBySessionId: (
    input: DeleteProjectionSessionMessagesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionSessionMessageRepository - Service tag for message projection persistence.
 */
export class ProjectionSessionMessageRepository extends Context.Service<
  ProjectionSessionMessageRepository,
  ProjectionSessionMessageRepositoryShape
>()("t3/persistence/Services/ProjectionSessionMessages/ProjectionSessionMessageRepository") {}
