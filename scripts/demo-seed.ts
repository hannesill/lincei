// @effect-diagnostics nodeBuiltinImport:off - Demo seeding CLI reads local files and posts to a dev server.
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

import { buildDemoScenarioCommands } from "../demos/buildScenario.ts";
import { coreDemoScenario } from "../demos/profiles/core.ts";
import {
  applyDemoScenarioOverlay,
  validateDemoScenario,
  validateDemoScenarioOverlay,
  type DemoScenario,
} from "../demos/schema.ts";

const DEFAULT_URL = "http://localhost:13773/api/demo/seed";
const DEFAULT_TOKEN = "alpha-demo-seed-token";
const DEFAULT_DEMO_HOME = ".demo-home";
const SERVER_RUNTIME_RELATIVE_PATH = "dev/server-runtime.json";

interface SeedArgs {
  readonly profile: string;
  readonly overlay: string | undefined;
  readonly url: string;
  readonly token: string;
  readonly force: boolean;
  readonly providerBacked: boolean;
}

interface ServerRuntimeState {
  readonly origin: string;
}

function argValue(args: ReadonlyArray<string>, name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function parseArgs(args: ReadonlyArray<string>): SeedArgs {
  return {
    profile: argValue(args, "--profile") ?? "core",
    overlay: argValue(args, "--overlay"),
    url: argValue(args, "--url") ?? process.env.LINCEI_DEMO_SEED_URL ?? "",
    token: argValue(args, "--token") ?? process.env.LINCEI_DEMO_SEED_TOKEN ?? DEFAULT_TOKEN,
    force: args.includes("--force"),
    providerBacked: args.includes("--provider-backed"),
  };
}

function isServerRuntimeState(value: unknown): value is ServerRuntimeState {
  return (
    typeof value === "object" &&
    value !== null &&
    "origin" in value &&
    typeof (value as { origin?: unknown }).origin === "string"
  );
}

async function resolveSeedUrl(configuredUrl: string): Promise<string> {
  if (configuredUrl.trim().length > 0) {
    return configuredUrl;
  }

  const runtimePath = resolve(DEFAULT_DEMO_HOME, SERVER_RUNTIME_RELATIVE_PATH);
  try {
    const raw = await readFile(runtimePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isServerRuntimeState(parsed)) {
      return `${parsed.origin.replace(/\/$/, "")}/api/demo/seed`;
    }
  } catch {
    return DEFAULT_URL;
  }

  return DEFAULT_URL;
}

function postJson(urlString: string, token: string, payload: unknown): Promise<string> {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requestImpl(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "x-lincei-demo-seed-token": token,
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            const disabledHint = responseBody.includes("Demo seed API is not enabled")
              ? " Restart the server with `bun run dev:demo` so LINCEI_DEMO_MODE=1 is present."
              : "";
            reject(
              new Error(
                `Seed request failed with ${res.statusCode ?? "unknown"} at ${urlString}: ${responseBody}${disabledHint}`,
              ),
            );
            return;
          }
          resolve(responseBody);
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function loadScenario(args: SeedArgs): Promise<DemoScenario> {
  if (args.profile !== "core") {
    throw new Error(`Unknown demo profile '${args.profile}'. Available profiles: core.`);
  }

  let scenario = validateDemoScenario(coreDemoScenario);
  if (args.overlay) {
    const overlayJson = JSON.parse(await readFile(args.overlay, "utf8")) as unknown;
    const overlay = validateDemoScenarioOverlay(overlayJson);
    scenario = validateDemoScenario(applyDemoScenarioOverlay(scenario, overlay));
  }

  return scenario;
}

const args = parseArgs(process.argv.slice(2));
const scenario = await loadScenario(args);
const seedUrl = await resolveSeedUrl(args.url);

// Validate command compilation locally before posting to the server.
buildDemoScenarioCommands(scenario);

process.stdout.write(`Seeding ${seedUrl}\n`);
const response = await postJson(seedUrl, args.token, {
  scenario,
  ...(args.force ? { force: true } : {}),
  ...(args.providerBacked ? { providerBacked: true } : {}),
});
process.stdout.write(`${response}\n`);
