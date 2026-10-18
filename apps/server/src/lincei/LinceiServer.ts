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
import * as ClinicalImageRequests from "./ClinicalImageRequests.ts";
import * as ClinicalRuntime from "./ClinicalRuntime.ts";
import * as LinceiPreferences from "./LinceiPreferences.ts";
import * as LinceiRequests from "./LinceiRequests.ts";
import * as ResearchBoard from "./ResearchBoard.ts";

export const activate = ClinicalRuntime.activate;

// Clinical setup ends by asking the datasets service for the demo dataset, so
// that service sits below the one that installs the tools.
export const layer = LinceiRequests.layer.pipe(
  Layer.provideMerge(ClinicalImageRequests.layer),
  Layer.provideMerge(ResearchBoard.layer),
  Layer.provideMerge(LinceiPreferences.layer),
  Layer.provideMerge(ClinicalRuntime.layer),
  Layer.provideMerge(ClinicalDatasets.layer),
  Layer.provide(ProcessRunner.layer),
);
