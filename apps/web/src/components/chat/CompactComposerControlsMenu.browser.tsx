import "../../index.css";

import { LINCEI_WORKFLOWS } from "@t3tools/shared/linceiSkills";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

async function mountMenu(props?: { activePlan?: boolean; showInteractionModeToggle?: boolean }) {
  const host = document.createElement("div");
  document.body.append(host);
  const onRuntimeModeChange = vi.fn();
  const onToggleInteractionMode = vi.fn();
  const onTogglePlanSidebar = vi.fn();
  const onWorkflowChange = vi.fn();
  const screen = await render(
    <CompactComposerControlsMenu
      activePlan={props?.activePlan ?? false}
      interactionMode="default"
      planSidebarLabel="Plan"
      planSidebarOpen={false}
      runtimeMode="approval-required"
      selectedWorkflow={LINCEI_WORKFLOWS[0]!}
      workflows={LINCEI_WORKFLOWS}
      showInteractionModeToggle={props?.showInteractionModeToggle ?? true}
      onToggleInteractionMode={onToggleInteractionMode}
      onTogglePlanSidebar={onTogglePlanSidebar}
      onRuntimeModeChange={onRuntimeModeChange}
      onWorkflowChange={onWorkflowChange}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onRuntimeModeChange,
    onToggleInteractionMode,
    onTogglePlanSidebar,
    onWorkflowChange,
  };
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows workflow and access controls", async () => {
    await using _ = await mountMenu();

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Workflow");
      expect(text).toContain("Ad hoc");
      expect(text).toContain("Structured clinical study");
      expect(text).toContain("Access");
      expect(text).toContain("Supervised");
      expect(text).toContain("Full access");
      expect(text).not.toContain("Model settings");
      expect(text).not.toContain("Reasoning");
    });
  });

  it("changes workflow from the compact menu", async () => {
    await using mounted = await mountMenu();

    await page.getByLabelText("More composer controls").click();
    await page.getByText("Replication / validation").click();

    expect(mounted.onWorkflowChange).toHaveBeenCalledWith("replication-validation");
  });

  it("changes runtime mode from the compact menu", async () => {
    await using mounted = await mountMenu();

    await page.getByLabelText("More composer controls").click();
    await page.getByText("Full access").click();

    expect(mounted.onRuntimeModeChange).toHaveBeenCalledWith("full-access");
  });

  it("can hide the interaction mode section", async () => {
    await using _ = await mountMenu({ showInteractionModeToggle: false });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("Mode");
      expect(text).not.toContain("Chat");
      expect(text).toContain("Workflow");
      expect(text).toContain("Access");
    });
  });

  it("shows the plan sidebar action only when a plan is active", async () => {
    const inactive = await mountMenu({ activePlan: false });

    await page.getByLabelText("More composer controls").click();
    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("Show plan sidebar");
    });
    await inactive.cleanup();

    await using active = await mountMenu({ activePlan: true });

    await page.getByLabelText("More composer controls").click();
    await page.getByText("Show plan sidebar").click();

    expect(active.onTogglePlanSidebar).toHaveBeenCalledTimes(1);
  });
});
