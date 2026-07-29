import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import SessionSidebar from "./Sidebar";
import SidebarV2 from "./SidebarV2";
import { resolveSidebarImplementation } from "./AppSidebarLayout.logic";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../shortcuts";
import { useServerShortcuts } from "../rpc/serverState";
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from "./ui/sidebar";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useClientSettingsHydrated, useSettings } from "../hooks/useSettings";

function SidebarGlobalShortcuts() {
  const { toggleSidebar } = useSidebar();
  const shortcuts = useServerShortcuts();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const command = resolveShortcutCommand(event, shortcuts, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
        },
      });
      if (command !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [shortcuts, toggleSidebar]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const clientSettingsHydrated = useClientSettingsHydrated();
  const sidebarV1RollbackEnabled = useSettings((settings) => settings.sidebarV1RollbackEnabled);
  const sidebarImplementation = resolveSidebarImplementation({
    pathname,
    sidebarV1RollbackEnabled,
    clientSettingsHydrated,
  });

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <SidebarGlobalShortcuts />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-sidebar-implementation={sidebarImplementation}
      >
        {sidebarImplementation === "v1" ? <SessionSidebar /> : <SidebarV2 />}
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
