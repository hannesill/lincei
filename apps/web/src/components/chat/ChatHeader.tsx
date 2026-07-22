import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedShortcutsConfig,
  type SessionId,
} from "@t3tools/contracts";
import { scopeSessionRef } from "@t3tools/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, GlobeIcon, TerminalSquareIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { AppTopBar } from "../appShell";

interface ChatHeaderProps {
  activeSessionEnvironmentId: EnvironmentId;
  activeSessionId: SessionId;
  draftId?: DraftId;
  activeSessionTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  shortcuts: ResolvedShortcutsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  previewAvailable: boolean;
  previewOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onTogglePreview: () => void;
  reserveTitleBarControlInset?: boolean;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeSessionEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeSessionEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeSessionEnvironmentId,
  activeSessionId,
  draftId,
  activeSessionTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  shortcuts,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  previewAvailable,
  previewOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onTogglePreview,
  reserveTitleBarControlInset,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeSessionEnvironmentId,
    primaryEnvironmentId,
  });

  return (
    <AppTopBar
      reserveTitleBarControlInset={reserveTitleBarControlInset}
      rightActions={
        <>
          {activeProjectScripts && (
            <ProjectScriptsControl
              scripts={activeProjectScripts}
              shortcuts={shortcuts}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          )}
          {showOpenInPicker && (
            <OpenInPicker
              shortcuts={shortcuts}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          )}
          {activeProjectName && (
            <GitActionsControl
              gitCwd={gitCwd}
              activeSessionRef={scopeSessionRef(activeSessionEnvironmentId, activeSessionId)}
              {...(draftId ? { draftId } : {})}
            />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  variant="outline"
                  size="xs"
                  disabled={!terminalAvailable}
                >
                  <TerminalSquareIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!terminalAvailable
                ? "Terminal is unavailable until this session is active."
                : terminalToggleShortcutLabel
                  ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                  : "Toggle terminal drawer"}
            </TooltipPopup>
          </Tooltip>
          {previewAvailable ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={previewOpen}
                    onPressedChange={onTogglePreview}
                    aria-label="Toggle preview browser"
                    variant="outline"
                    size="xs"
                  >
                    <GlobeIcon className="size-3" />
                  </Toggle>
                }
              />
              <TooltipPopup side="bottom">Toggle preview browser</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={diffOpen}
                  onPressedChange={onToggleDiff}
                  aria-label="Toggle diff panel"
                  variant="outline"
                  size="xs"
                  disabled={!isGitRepo && !diffOpen}
                >
                  <DiffIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!isGitRepo && !diffOpen
                ? "Diff panel is unavailable because this project is not a git repository."
                : diffToggleShortcutLabel
                  ? `Toggle diff panel (${diffToggleShortcutLabel})`
                  : "Toggle diff panel"}
            </TooltipPopup>
          </Tooltip>
        </>
      }
      actionsClassName="gap-2 @3xl/header-actions:gap-3"
    >
      <h2
        className="min-w-0 shrink truncate text-sm font-medium text-foreground"
        title={activeSessionTitle}
      >
        {activeSessionTitle}
      </h2>
    </AppTopBar>
  );
});
