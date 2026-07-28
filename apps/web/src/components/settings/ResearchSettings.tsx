import type {
  EnvironmentId,
  ProjectId,
  VitrineRuntimeSource,
  VitrineRuntimeStatus,
  VitrineRuntimeStatusKind,
} from "@t3tools/contracts";
import { AlertTriangleIcon, MicroscopeIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { readEnvironmentApi } from "../../environmentApi";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { ensureLocalApi } from "../../localApi";
import { applySettingsUpdated } from "../../rpc/serverState";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import {
  forgetVitrineAutoOpenIntent,
  readVitrineAutoOpenIntent,
  rememberVitrineAutoOpenIntent,
} from "../../vitrinePreview";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { useSettings } from "../../hooks/useSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type RuntimeBadgeVariant = "error" | "success" | "warning";

export function formatVitrineRuntimeSource(source: VitrineRuntimeSource): string {
  switch (source) {
    case "environment":
      return "LINCEI_VITRINE_EXECUTABLE";
    case "settings":
      return "Research settings";
    case "path":
      return "Server PATH";
  }
}

export function formatVitrineRuntimeStatus(status: VitrineRuntimeStatusKind): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "unavailable":
      return "Unavailable";
    case "incompatible":
      return "Incompatible";
    case "failed":
      return "Failed";
  }
}

export function vitrineRuntimeBadgeVariant(status: VitrineRuntimeStatusKind): RuntimeBadgeVariant {
  switch (status) {
    case "ready":
      return "success";
    case "unavailable":
    case "incompatible":
      return "warning";
    case "failed":
      return "error";
  }
}

function projectIntentKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ResearchSettingsPanel() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const configuredExecutablePath = useSettings((settings) => settings.vitrine.executablePath);
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const primaryProjects = useMemo(
    () =>
      projects
        .filter((project) => project.environmentId === primaryEnvironmentId)
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [primaryEnvironmentId, projects],
  );
  const [executablePathDraft, setExecutablePathDraft] = useState(configuredExecutablePath);
  const [runtimeStatus, setRuntimeStatus] = useState<VitrineRuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [savingExecutablePath, setSavingExecutablePath] = useState(false);
  const [intentByProjectKey, setIntentByProjectKey] = useState<Record<string, boolean>>({});
  const runtimeStatusRequestIdRef = useRef(0);
  const autoReopenSupported = isPreviewSupportedInRuntime();

  useEffect(() => {
    setExecutablePathDraft(configuredExecutablePath);
  }, [configuredExecutablePath]);

  useEffect(() => {
    setIntentByProjectKey(
      Object.fromEntries(
        primaryProjects.map((project) => [
          projectIntentKey(project.environmentId, project.id),
          readVitrineAutoOpenIntent(project.environmentId, project.id),
        ]),
      ),
    );
  }, [primaryProjects]);

  const refreshRuntimeStatus = useCallback(async () => {
    const requestId = ++runtimeStatusRequestIdRef.current;
    if (primaryEnvironmentId === null) {
      setRuntimeStatus(null);
      setRuntimeError("The primary environment is not connected.");
      setCheckingRuntime(false);
      return;
    }
    const api = readEnvironmentApi(primaryEnvironmentId);
    if (!api) {
      setRuntimeStatus(null);
      setRuntimeError("Reconnect the primary environment to check Vitrine.");
      setCheckingRuntime(false);
      return;
    }

    setCheckingRuntime(true);
    setRuntimeError(null);
    try {
      const status = await api.vitrine.runtimeStatus();
      if (runtimeStatusRequestIdRef.current !== requestId) {
        return;
      }
      setRuntimeStatus(status);
    } catch (error) {
      if (runtimeStatusRequestIdRef.current !== requestId) {
        return;
      }
      setRuntimeStatus(null);
      setRuntimeError(
        error instanceof Error ? error.message : "Could not check the Vitrine runtime.",
      );
    } finally {
      if (runtimeStatusRequestIdRef.current === requestId) {
        setCheckingRuntime(false);
      }
    }
  }, [primaryEnvironmentId]);

  useEffect(() => {
    void refreshRuntimeStatus();
  }, [refreshRuntimeStatus]);

  useEffect(
    () => () => {
      runtimeStatusRequestIdRef.current += 1;
    },
    [],
  );

  const environmentOverrideActive = runtimeStatus?.source === "environment";
  const normalizedExecutablePath = executablePathDraft.trim();
  const executablePathDirty = normalizedExecutablePath !== configuredExecutablePath;

  const saveExecutablePath = useCallback(async () => {
    if (
      environmentOverrideActive ||
      checkingRuntime ||
      savingExecutablePath ||
      !executablePathDirty
    ) {
      return;
    }

    setSavingExecutablePath(true);
    setRuntimeError(null);
    try {
      const settings = await ensureLocalApi().server.updateSettings({
        vitrine: { executablePath: normalizedExecutablePath },
      });
      applySettingsUpdated(settings);
      await refreshRuntimeStatus();
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : "Could not save the Vitrine executable path.",
      );
    } finally {
      setSavingExecutablePath(false);
    }
  }, [
    environmentOverrideActive,
    checkingRuntime,
    executablePathDirty,
    normalizedExecutablePath,
    refreshRuntimeStatus,
    savingExecutablePath,
  ]);

  const updateProjectIntent = useCallback(
    (environmentId: EnvironmentId, projectId: ProjectId, enabled: boolean) => {
      const saved = enabled
        ? rememberVitrineAutoOpenIntent(environmentId, projectId)
        : forgetVitrineAutoOpenIntent(environmentId, projectId);
      if (!saved) {
        toastManager.add({
          type: "warning",
          title: "Could not update automatic Research reopening",
          description: "Browser storage is unavailable. The previous preference is unchanged.",
        });
        return;
      }
      setIntentByProjectKey((current) => ({
        ...current,
        [projectIntentKey(environmentId, projectId)]: enabled,
      }));
    },
    [],
  );

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection
        title="Vitrine runtime"
        icon={<MicroscopeIcon className="size-3.5" />}
        headerAction={
          <Button
            size="xs"
            variant="ghost"
            disabled={checkingRuntime || savingExecutablePath}
            onClick={() => void refreshRuntimeStatus()}
          >
            {checkingRuntime ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Check again
          </Button>
        }
      >
        <SettingsRow
          title="Lifecycle executable"
          description="Executable used for Vitrine status, start, and stop commands. Leave blank to resolve `vitrine` from the server PATH."
          status={
            environmentOverrideActive
              ? "LINCEI_VITRINE_EXECUTABLE overrides this setting. Change that environment variable and restart the backend to use a different executable."
              : "Changes apply to the next Vitrine lifecycle command."
          }
        >
          <div className="grid gap-3 pt-3 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              aria-label="Vitrine executable path"
              disabled={environmentOverrideActive || savingExecutablePath}
              placeholder="vitrine (from server PATH)"
              spellCheck={false}
              value={executablePathDraft}
              onChange={(event) => setExecutablePathDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveExecutablePath();
                }
              }}
            />
            <Button
              size="sm"
              disabled={
                environmentOverrideActive ||
                checkingRuntime ||
                savingExecutablePath ||
                !executablePathDirty
              }
              onClick={() => void saveExecutablePath()}
            >
              {savingExecutablePath ? <Spinner className="size-3.5" /> : null}
              Save
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Runtime status"
          description={
            runtimeStatus?.message ??
            runtimeError ??
            (runtimeStatus
              ? "Runtime check completed."
              : checkingRuntime
                ? "Checking the configured Vitrine runtime."
                : "Not checked.")
          }
          status={runtimeStatus ? `Checked ${formatCheckedAt(runtimeStatus.checkedAt)}` : undefined}
          control={
            runtimeStatus ? (
              <Badge variant={vitrineRuntimeBadgeVariant(runtimeStatus.status)}>
                {formatVitrineRuntimeStatus(runtimeStatus.status)}
              </Badge>
            ) : checkingRuntime ? (
              <Badge variant="outline">Checking</Badge>
            ) : (
              <Badge variant="error">Unknown</Badge>
            )
          }
        />

        {runtimeStatus ? (
          <>
            <SettingsRow
              title="Effective executable"
              description={runtimeStatus.executable}
              status={`Source: ${formatVitrineRuntimeSource(runtimeStatus.source)}`}
            />
            <SettingsRow
              title="Version and lifecycle contract"
              description={`Vitrine ${runtimeStatus.version ?? "not reported"} · supported ${runtimeStatus.supportedVersionRange}`}
              status={`Lifecycle contract ${runtimeStatus.lifecycleContractVersion ?? "not reported"} · required ${runtimeStatus.requiredLifecycleContractVersion}`}
            />
            <SettingsRow
              title="Analysis Python"
              description={runtimeStatus.pythonExecutable ?? "Python executable not reported"}
            />
          </>
        ) : null}

        <div className="border-t border-border/60 px-4 py-3.5 sm:px-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                The lifecycle executable and analysis Python are separate.
              </p>
              <p className="leading-relaxed text-muted-foreground">
                This setting controls the CLI Lincei invokes. Agent analysis code uses its own
                Python environment, where <code>from vitrine import show, confirm, ask</code> must
                also succeed. Prefer the same project virtual environment for both.
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Automatic reopen">
        {primaryEnvironmentId === null ? (
          <SettingsRow
            title="Primary environment unavailable"
            description="Reconnect the primary environment to manage project Research preferences."
          />
        ) : primaryProjects.length === 0 ? (
          <SettingsRow
            title="No local projects"
            description="Add a project in the primary environment to manage automatic Research reopening."
          />
        ) : (
          primaryProjects.map((project) => {
            const key = projectIntentKey(project.environmentId, project.id);
            return (
              <SettingsRow
                key={key}
                title={project.name}
                description={
                  autoReopenSupported
                    ? "Reopen this project's Research panel automatically when the project is next active."
                    : "Automatic Research reopening is available in the Lincei desktop app."
                }
                status={project.cwd}
                control={
                  <Switch
                    aria-label={`Automatically reopen Research for ${project.name}`}
                    checked={intentByProjectKey[key] ?? false}
                    disabled={!autoReopenSupported}
                    onCheckedChange={(checked) =>
                      updateProjectIntent(project.environmentId, project.id, Boolean(checked))
                    }
                  />
                }
              />
            );
          })
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
