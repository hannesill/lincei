import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AddProviderInstanceWizardSteps } from "./AddProviderInstanceWizardSteps";

describe("AddProviderInstanceWizardSteps", () => {
  it("renders a forced-colors-visible marker on the current step", () => {
    const markup = renderToStaticMarkup(
      <AddProviderInstanceWizardSteps
        currentStep={1}
        summaries={["Codex", "Codex Workspace", null]}
        instanceIdError="Instance ID is required."
        onNavigation={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("forced-colors:border-[Highlight]");
    expect(markup).toContain("forced-colors:outline-[Canvas]");
  });
});
