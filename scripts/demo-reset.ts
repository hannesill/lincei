// @effect-diagnostics nodeBuiltinImport:off - Demo reset is a filesystem boundary script.
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const DEMO_HOME = ".demo-home";

export function resolveDemoResetTarget(requestedHome: string): string {
  const resolvedRequestedHome = resolve(requestedHome);
  const resolvedDemoHome = resolve(DEMO_HOME);

  if (resolvedRequestedHome !== resolvedDemoHome) {
    throw new Error(`Refusing to reset '${requestedHome}'. demo:reset only removes ${DEMO_HOME}.`);
  }

  return resolvedDemoHome;
}

function parseHomeArg(args: ReadonlyArray<string>): string {
  const homeIndex = args.indexOf("--home");
  if (homeIndex === -1) {
    return DEMO_HOME;
  }
  return args[homeIndex + 1] ?? "";
}

if (import.meta.main) {
  const requestedHome = parseHomeArg(process.argv.slice(2));
  const resolvedDemoHome = resolveDemoResetTarget(requestedHome);
  await rm(resolvedDemoHome, { recursive: true, force: true });
  process.stdout.write(`Reset ${DEMO_HOME}\n`);
}
