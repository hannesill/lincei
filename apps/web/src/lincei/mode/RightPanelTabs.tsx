import type { ComponentProps } from "react";

import { RightPanelTabs as UpstreamRightPanelTabs } from "~/components/RightPanelTabs";

import { useTechieMode } from "./techieMode";

/**
 * Upstream's right panel with the developer surfaces unavailable in researcher
 * mode: terminal, diff, pull requests, device. The panel's "+" menu, its empty
 * launcher, and the bare letter keys both listen to all honour these props, so
 * this closes the keys too, which a stylesheet cannot. Browser (the research
 * board) and files stay.
 */
export function RightPanelTabs(props: ComponentProps<typeof UpstreamRightPanelTabs>) {
  const techie = useTechieMode();
  if (techie) return <UpstreamRightPanelTabs {...props} />;
  return (
    <UpstreamRightPanelTabs
      {...props}
      terminalAvailable={false}
      diffAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      deviceAvailable={false}
    />
  );
}
