import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedShortcutsConfig,
  type SessionId,
  type VitrineLifecycleStatus,
} from "@t3tools/contracts";
import { scopeSessionRef } from "@t3tools/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import {
  DiffIcon,
  GlobeIcon,
  LoaderCircleIcon,
  MicroscopeIcon,
  TerminalSquareIcon,
} from "lucide-react";
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
  researchAvailable: boolean;
  researchOpen: boolean;
  researchStatus: VitrineLifecycleStatus | null;
  researchMessage: string | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onTogglePreview: () => void;
  onOpenResearch: () => void;
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
  researchAvailable,
  researchOpen,
  researchStatus,
  researchMessage,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onTogglePreview,
  onOpenResearch,
  reserveTitleBarControlInset,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeSessionEnvironmentId,
    primaryEnvironmentId,
  });
  const researchTooltip = !researchAvailable
    ? (researchMessage ?? "Reconnect this environment before opening project research.")
    : researchStatus === "starting"
      ? "Starting Vitrine..."
      : researchOpen
        ? "Close project research. It will stay closed after restart until you open it again."
        : (researchMessage ?? "Open project research in Vitrine");

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
          {activeProjectName ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label={
                      researchOpen
                        ? "Close project research in Vitrine"
                        : "Open project research in Vitrine"
                    }
                    className="shrink-0"
                    disabled={!researchAvailable || researchStatus === "starting"}
                    onPressedChange={() => onOpenResearch()}
                    pressed={researchOpen}
                    size="xs"
                    variant="outline"
                  >
                    {researchStatus === "starting" ? (
                      <LoaderCircleIcon className="size-3 animate-spin" />
                    ) : (
                      <MicroscopeIcon
                        className={
                          researchStatus === "ready"
                            ? "size-3 text-success"
                            : researchStatus === "failed" || researchStatus === "unavailable"
                              ? "size-3 text-destructive"
                              : "size-3"
                        }
                      />
                    )}
                  </Toggle>
                }
              />
              <TooltipPopup side="bottom">{researchTooltip}</TooltipPopup>
            </Tooltip>
          ) : null}
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
