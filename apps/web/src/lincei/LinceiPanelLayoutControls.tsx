import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
} from "~/components/chat/PanelLayoutControls";

import { ResearchBoardButton, type ResearchBoardTarget } from "./ResearchBoardButton";

/**
 * T3 Code's panel toggles with Lincei's research board button in front of
 * them. `ChatView` renders this in place of `PanelLayoutControls`, which keeps
 * the change to that upstream file to the tag name and one prop.
 */
export function LinceiPanelLayoutControls({
  research,
  ...controls
}: PanelLayoutControlsProps & { readonly research: ResearchBoardTarget }) {
  return (
    <>
      <ResearchBoardButton {...research} />
      <PanelLayoutControls {...controls} />
    </>
  );
}
