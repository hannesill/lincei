import type { ProjectId, VitrineProjectState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface VitrineManagerInput {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}

export interface VitrineManagerShape {
  readonly ensure: (input: VitrineManagerInput) => Effect.Effect<VitrineProjectState>;
  readonly status: (input: VitrineManagerInput) => Effect.Effect<VitrineProjectState>;
  readonly stop: (input: VitrineManagerInput) => Effect.Effect<VitrineProjectState>;
}

export class VitrineManager extends Context.Service<VitrineManager, VitrineManagerShape>()(
  "t3/vitrine/Services/Manager/VitrineManager",
) {}
