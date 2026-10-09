/**
 * LinceiServer - everything Lincei adds to a T3 Code server, behind one import.
 *
 * `server.ts` calls `activate` at startup and merges `layer` into its runtime;
 * the WebSocket and MCP transports pick their services out of that. Adding a
 * Lincei service means adding it to `layer` here, not editing upstream files.
 *
 * @module LinceiServer
 */
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ClinicalDatasets from "./ClinicalDatasets.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as LinceiRequests from "./LinceiRequests.ts";
import * as ResearchBoard from "./ResearchBoard.ts";

export const activate = ClinicalRuntime.activate;

export const layer = LinceiRequests.layer.pipe(
  Layer.provideMerge(ResearchBoard.layer),
  Layer.provideMerge(ClinicalDatasets.layer),
  Layer.provideMerge(ClinicalRuntime.layer),
  Layer.provide(ProcessRunner.layer),
);
