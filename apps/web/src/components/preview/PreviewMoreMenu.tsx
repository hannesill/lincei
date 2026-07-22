import { Minus, MoreVertical, Plus, RotateCcw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { previewBridge } from "./previewBridge";

export function PreviewMoreMenu(props: {
  tabId: string | null;
  scope: string;
  hasWebContents: boolean;
  zoomFactor: number;
  onCloseTab: () => void;
}) {
  if (!previewBridge) return null;
  const bridge = previewBridge;
  const tabDisabled = !props.tabId || !props.hasWebContents;
  const callTab = (operation: (tabId: string) => Promise<void>) => () => {
    if (props.tabId) void operation(props.tabId).catch(() => undefined);
  };
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" type="button" aria-label="Preview menu" />
              }
            />
          }
        >
          <MoreVertical />
        </TooltipTrigger>
        <TooltipPopup>More</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" sideOffset={6} className="min-w-56">
        <MenuItem onClick={callTab(bridge.hardReload)} disabled={tabDisabled}>
          Hard reload
        </MenuItem>
        <MenuItem onClick={callTab(bridge.openDevTools)} disabled={tabDisabled}>
          Open DevTools
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          closeOnClick={false}
          onClick={(event: React.MouseEvent) => event.preventDefault()}
          className="justify-between"
          disabled={tabDisabled}
        >
          <span>Zoom</span>
          <span className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={callTab(bridge.zoomOut)}
              aria-label="Zoom out"
              disabled={tabDisabled}
            >
              <Minus />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(props.zoomFactor * 100)}%
            </span>
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={callTab(bridge.zoomIn)}
              aria-label="Zoom in"
              disabled={tabDisabled}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={callTab(bridge.resetZoom)}
              aria-label="Reset zoom"
              disabled={tabDisabled}
            >
              <RotateCcw />
            </Button>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => void bridge.clearCookies(props.scope).catch(() => undefined)}>
          Clear cookies
        </MenuItem>
        <MenuItem onClick={() => void bridge.clearCache(props.scope).catch(() => undefined)}>
          Clear cache
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={props.onCloseTab} disabled={!props.tabId}>
          Close preview tab
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
