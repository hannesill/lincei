import { describe, expect, it } from "vitest";

import { buildDemoScenarioCommands } from "../demos/buildScenario.ts";
import { normalizeDemoScenarioWorkspaceRoots } from "../demos/paths.ts";
import { coreDemoScenario } from "../demos/profiles/core.ts";
import {
  applyDemoScenarioOverlay,
  validateDemoSeedRequest,
  validateDemoScenario,
  validateDemoScenarioOverlay,
} from "../demos/schema.ts";
import {
  buildDemoHydrationRequests,
  DEMO_DEEP_HYDRATION_SESSION_IDS,
  DEMO_PROVIDER_INSTANCE_ID,
  DEMO_PROVIDER_MODEL,
} from "../demos/providerHydration.ts";
import { resolveDemoResetTarget } from "./demo-reset.ts";

describe("demo scenario", () => {
  it("accepts the core profile", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    expect(scenario.studies).toHaveLength(4);
    expect(scenario.studies.every((study) => study.sessions.length === 5)).toBe(true);
    expect(scenario.studies.flatMap((study) => study.files ?? [])).not.toHaveLength(0);
  });

  it("keeps hero sessions deep enough for live demos and screenshots", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const sessions = new Map(
      scenario.studies.flatMap((study) => study.sessions.map((session) => [session.id, session])),
    );

    expect(
      Array.from(DEMO_DEEP_HYDRATION_SESSION_IDS).every((sessionId) => sessions.has(sessionId)),
    ).toBe(true);
    expect(
      Array.from(DEMO_DEEP_HYDRATION_SESSION_IDS, (sessionId) => {
        const session = sessions.get(sessionId);
        return new Set(session?.messages.map((message) => message.turnId).filter(Boolean)).size;
      }),
    ).toEqual([4, 3, 3, 3]);
  });

  it("normalizes demo workspace roots under the configured demo home", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const normalized = normalizeDemoScenarioWorkspaceRoots(scenario, "/tmp/lincei-demo-home");

    expect(normalized.studies[0]?.workspaceRoot).toBe(
      "/tmp/lincei-demo-home/workspaces/glp1-cv-risk",
    );
    expect(
      buildDemoScenarioCommands(normalized).some(
        (command) =>
          command.type === "project.create" &&
          command.workspaceRoot === "/tmp/lincei-demo-home/workspaces/glp1-cv-risk",
      ),
    ).toBe(true);
  });

  it("rejects malformed overlays", () => {
    expect(() => validateDemoScenarioOverlay({ studyTitles: ["bad"] })).toThrow();
  });

  it("merges overlays without changing stable ids", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const overlay = validateDemoScenarioOverlay({
      organizationName: "Demo Hospital",
      studyTitles: {
        "demo-study-cardio": "Renamed Cardio Study",
      },
    });
    const merged = applyDemoScenarioOverlay(scenario, overlay);

    expect(merged.organizationName).toBe("Demo Hospital");
    expect(merged.studies[0]?.id).toBe("demo-study-cardio");
    expect(merged.studies[0]?.title).toBe("Renamed Cardio Study");
  });

  it("compiles to orchestration commands", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const commands = buildDemoScenarioCommands(scenario);

    expect(commands.some((command) => command.type === "project.create")).toBe(true);
    expect(commands.some((command) => command.type === "session.activity.append")).toBe(true);
    expect(commands.some((command) => String(command.type).includes("research-card"))).toBe(false);
  });

  it("validates provider-backed seed requests", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const request = validateDemoSeedRequest({
      scenario,
      force: true,
      providerBacked: true,
    });

    expect(request.providerBacked).toBe(true);
    expect(request.force).toBe(true);
  });

  it("compiles provider hydration requests for every demo session", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    const requests = buildDemoHydrationRequests(scenario);
    const sessionCount = scenario.studies.reduce(
      (count, study) => count + study.sessions.length,
      0,
    );

    expect(requests).toHaveLength(sessionCount);
    expect(requests[0]?.providerInstanceId).toBe(DEMO_PROVIDER_INSTANCE_ID);
    expect(requests[0]?.modelSelection.model).toBe(DEMO_PROVIDER_MODEL);
    expect(requests[0]?.runtimeMode).toBe("full-access");
    expect(requests[0]?.prompt).toContain("Internal Lincei demo hydration");
    expect(requests[0]?.turns).toHaveLength(4);
    expect(requests[0]?.metadata.hydrationMode).toBe("deep");
    expect(requests[0]?.metadata.providerTurnCount).toBe(4);
    expect(requests[0]?.turns[0]?.prompt).toContain("Hydration turn: 1 of 4");
    expect(requests[0]?.metadata.artifactPaths).toContain("protocol/target_trial_protocol.md");
    expect(requests.filter((request) => request.metadata.hydrationMode === "deep")).toHaveLength(4);
  });
});

describe("demo reset guard", () => {
  it("allows only .demo-home", () => {
    expect(resolveDemoResetTarget(".demo-home")).toContain(".demo-home");
    expect(() => resolveDemoResetTarget(".dev-home")).toThrow(/Refusing to reset/);
  });
});
