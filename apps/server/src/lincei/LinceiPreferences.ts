/**
 * LinceiPreferences - what a Lincei user has chosen that the server acts on.
 *
 * Today that is Techie mode. The client hides developer controls by itself,
 * but what agents are told is built here, so the server has to know the mode
 * when a session starts and when it changes: the conversation is most of what
 * a researcher reads. The value lives in `lincei.json` beside upstream's
 * `settings.json`, in Lincei's own file because a key in upstream's settings
 * schema would mean editing that schema and the server's wiring on every
 * merge. Clients read and change it through `lincei.request`.
 *
 * @module LinceiPreferences
 */
import { setRuntimeProductContext } from "@t3tools/provider-core/server/runtimeInstructions";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { linceiAgentInstructions } from "./agentInstructions.ts";

export interface Preferences {
  /** Off by default: a researcher's Lincei. On: upstream's developer surfaces and a coding agent's voice. */
  readonly techieMode: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { techieMode: false };

/** Every key optional, so a file written by an older Lincei still reads. */
const StoredPreferences = Schema.Struct({ techieMode: Schema.optional(Schema.Boolean) });
const StoredPreferencesJson = Schema.fromJsonString(StoredPreferences);
const decodeStored = Schema.decodeUnknownEffect(StoredPreferencesJson);
const encodeStored = Schema.encodeEffect(StoredPreferencesJson);

export class LinceiPreferences extends Context.Service<
  LinceiPreferences,
  {
    readonly get: Effect.Effect<Preferences>;
    /** Stores the change and applies it to what agents are told from their next turn. */
    readonly update: (patch: Partial<Preferences>) => Effect.Effect<Preferences>;
  }
>()("t3/lincei/LinceiPreferences") {}

const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const applyToAgents = (preferences: Preferences) =>
    Effect.sync(() =>
      setRuntimeProductContext({
        name: "Lincei",
        instructions: linceiAgentInstructions({ techieMode: preferences.techieMode, platform }),
      }),
    );
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(config.stateDir, "lincei.json");

  // A missing or unreadable file means nobody has chosen yet.
  const stored = yield* fileSystem
    .readFileString(filePath)
    .pipe(Effect.flatMap(decodeStored), Effect.option);
  const preferences = yield* Ref.make<Preferences>({
    techieMode: Option.getOrUndefined(stored)?.techieMode ?? DEFAULT_PREFERENCES.techieMode,
  });
  yield* Ref.get(preferences).pipe(Effect.flatMap(applyToAgents));

  const update: LinceiPreferences["Service"]["update"] = (patch) =>
    Effect.gen(function* () {
      const next = yield* Ref.updateAndGet(preferences, (current) => ({ ...current, ...patch }));
      yield* applyToAgents(next);
      // The mode already holds for this run; a failed write only loses it at the next start.
      yield* encodeStored(next).pipe(
        Effect.flatMap((contents) => writeFileStringAtomically({ filePath, contents })),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.catch((cause) =>
          Effect.logWarning("could not store Lincei preferences", { filePath, cause }),
        ),
      );
      return next;
    });

  return LinceiPreferences.of({ get: Ref.get(preferences), update });
});

export const layer = Layer.effect(LinceiPreferences, make);
