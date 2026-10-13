import type { LocalApi } from "@t3tools/contracts";

import { withoutTechieContextMenuItems } from "./researcherFilters";
import { isTechieMode } from "./techieMode";

/**
 * Upstream's local API with developer items left out of context menus in
 * researcher mode. Every context menu, native on desktop and the DOM fallback
 * on the web, goes through `contextMenu.show`, so this is the one place.
 */
export function linceiLocalApi(api: LocalApi): LocalApi {
  return {
    ...api,
    contextMenu: {
      ...api.contextMenu,
      show: (items, position) =>
        api.contextMenu.show(
          isTechieMode() ? items : withoutTechieContextMenuItems(items),
          position,
        ),
    },
  };
}
