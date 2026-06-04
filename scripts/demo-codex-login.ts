// @effect-diagnostics nodeBuiltinImport:off - Demo helper spawns the local Codex CLI.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_DEMO_HOME = ".demo-home";
const codexHome = resolve(process.env.LINCEI_HOME?.trim() || DEFAULT_DEMO_HOME, "codex");

mkdirSync(codexHome, { recursive: true });

const child = spawn("codex", ["login"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  process.stderr.write(`Failed to start codex login: ${error.message}\n`);
  process.exit(1);
});
