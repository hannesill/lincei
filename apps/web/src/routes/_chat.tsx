import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewSession } from "../hooks/useHandleNewSession";
import {
  startNewLocalSessionFromContext,
  startNewSessionFromContext,
} from "../lib/chatSessionActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectSessionTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useSessionSelectionStore } from "../sessionSelectionStore";
import { resolveSidebarNewSessionEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useSessionSelectionStore((state) => state.clearSelection);
  const selectedSessionKeysSize = useSessionSelectionStore(
    (state) => state.selectedSessionKeys.size,
  );
  const {
    activeDraftSession,
    activeSession,
    defaultProjectRef,
    handleNewSession,
    routeSessionRef,
  } = useHandleNewSession();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeSessionRef
      ? selectSessionTerminalState(state.terminalStateBySessionKey, routeSessionRef).terminalOpen
      : false,
  );
  const appSettings = useSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (useCommandPaletteStore.getState().open) {
        return;
      }

      if (event.key === "Escape" && selectedSessionKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalSessionFromContext({
          activeDraftSession,
          activeSession,
          defaultProjectRef,
          defaultSessionEnvMode: resolveSidebarNewSessionEnvMode({
            defaultEnvMode: appSettings.defaultSessionEnvMode,
          }),
          handleNewSession,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void startNewSessionFromContext({
          activeDraftSession,
          activeSession,
          defaultProjectRef,
          defaultSessionEnvMode: resolveSidebarNewSessionEnvMode({
            defaultEnvMode: appSettings.defaultSessionEnvMode,
          }),
          handleNewSession,
        });
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftSession,
    activeSession,
    clearSelection,
    handleNewSession,
    keybindings,
    defaultProjectRef,
    selectedSessionKeysSize,
    terminalOpen,
    appSettings.defaultSessionEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white text-foreground dark:bg-background">
        <Outlet />
      </div>
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
