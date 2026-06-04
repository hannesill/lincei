// @effect-diagnostics nodeBuiltinImport:off - Demo profiles use Node path semantics for local fixture roots.
import { isAbsolute, relative, resolve } from "node:path";

import type { DemoScenario, DemoStudy } from "./schema.ts";

const DEMO_HOME_PREFIX = ".demo-home";

function isInside(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function resolveDemoWorkspaceRoot(baseDir: string, workspaceRoot: string): string {
  const normalizedBaseDir = resolve(baseDir);
  const configured = workspaceRoot.trim();
  const demoRelativePrefix = `${DEMO_HOME_PREFIX}/`;

  if (isAbsolute(configured)) {
    return resolve(configured);
  }

  if (configured === DEMO_HOME_PREFIX) {
    return normalizedBaseDir;
  }

  if (configured.startsWith(demoRelativePrefix)) {
    return resolve(normalizedBaseDir, configured.slice(demoRelativePrefix.length));
  }

  return resolve(normalizedBaseDir, configured);
}

export function normalizeDemoScenarioWorkspaceRoots(
  scenario: DemoScenario,
  baseDir: string,
): DemoScenario {
  const normalizedBaseDir = resolve(baseDir);
  return {
    ...scenario,
    studies: scenario.studies.map((study): DemoStudy => {
      const workspaceRoot = resolveDemoWorkspaceRoot(normalizedBaseDir, study.workspaceRoot);
      if (!isInside(normalizedBaseDir, workspaceRoot)) {
        throw new Error(
          `Demo workspace '${study.workspaceRoot}' resolves outside demo home '${normalizedBaseDir}'.`,
        );
      }
      return {
        ...study,
        workspaceRoot,
      };
    }),
  };
}
