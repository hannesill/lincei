import { describe, expect, it } from "vitest";

import { buildDemoScenarioCommands } from "../demos/buildScenario.ts";
import { coreDemoScenario } from "../demos/profiles/core.ts";
import {
  applyDemoScenarioOverlay,
  validateDemoScenario,
  validateDemoScenarioOverlay,
} from "../demos/schema.ts";
import { resolveDemoResetTarget } from "./demo-reset.ts";

describe("demo scenario", () => {
  it("accepts the core profile", () => {
    const scenario = validateDemoScenario(coreDemoScenario);
    expect(scenario.studies.length).toBeGreaterThanOrEqual(3);
    expect(scenario.studies.every((study) => study.sessions.length >= 5)).toBe(true);
    expect(scenario.studies.flatMap((study) => study.files ?? [])).not.toHaveLength(0);
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
    expect(commands.some((command) => command.type === "session.research-card.propose")).toBe(true);
    expect(commands.some((command) => command.type === "session.activity.append")).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.type === "session.research-card.propose" &&
          JSON.stringify(command).includes("protocol/target_trial_protocol.md"),
      ),
    ).toBe(true);
  });
});

describe("demo reset guard", () => {
  it("allows only .demo-home", () => {
    expect(resolveDemoResetTarget(".demo-home")).toContain(".demo-home");
    expect(() => resolveDemoResetTarget(".dev-home")).toThrow(/Refusing to reset/);
  });
});
