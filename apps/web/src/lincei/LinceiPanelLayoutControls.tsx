import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
} from "~/components/chat/PanelLayoutControls";

import { usePrimaryEnvironmentId } from "~/state/environments";

import { useTechieModeSync } from "./mode/techieModeSwitch";
import { ResearchBoardButton, type ResearchBoardTarget } from "./ResearchBoardButton";

/**
 * T3 Code's panel toggles with Lincei's research board button in front of
 * them. `ChatView` renders this in place of `PanelLayoutControls`, which keeps
 * the change to that upstream file to the tag name and one prop.
 *
 * Being in every thread's header, it is also where a window that has just
 * launched asks the server which mode it is in.
 */
export function LinceiPanelLayoutControls({
  research,
  ...controls
}: PanelLayoutControlsProps & { readonly research: ResearchBoardTarget }) {
  useTechieModeSync(usePrimaryEnvironmentId());
  return (
    <>
      <ResearchBoardButton {...research} />
      <PanelLayoutControls {...controls} />
    </>
  );
}
