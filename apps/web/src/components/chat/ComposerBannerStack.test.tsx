import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

const warningBanner: ComposerBannerStackItem = {
  id: "warning",
  variant: "warning",
  icon: <span aria-hidden="true">!</span>,
  title: "Warning",
};

describe("ComposerBannerStack", () => {
  it("renders composer alerts on the variant-aware glass surface", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[warningBanner]} />);

    expect(markup).toContain("alert-glass");
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain("transform:none");
    expect(markup).not.toContain("will-change:transform");
  });
});
