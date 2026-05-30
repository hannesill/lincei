import {
  AlertCircleIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  DatabaseIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlayIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DATASET_IDS,
  type DatasetBackendId,
  type DatasetErrorDetail,
  type DatasetId,
  type DatasetReadinessState,
  type DatasetStatusResult,
  type DatasetStatusSnapshot,
} from "@t3tools/contracts";

import { ensureLocalApi } from "../../localApi";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const DATASET_LABELS: Record<DatasetId, string> = {
  "mimic-iv-demo": "MIMIC-IV Demo",
  "mimic-iv": "MIMIC-IV",
  "mimic-iv-note": "MIMIC-IV Note",
  eicu: "eICU",
};

const DATASET_DESCRIPTIONS: Record<DatasetId, string> = {
  "mimic-iv-demo": "Small local sample for first-run validation.",
  "mimic-iv": "Credentialed MIMIC-IV clinical database.",
  "mimic-iv-note": "Credentialed MIMIC-IV clinical notes.",
  eicu: "eICU collaborative research database.",
};

const DATA_LOCATION_LABELS: Record<DatasetBackendId, string> = {
  duckdb: "Local",
  bigquery: "Remote (BigQuery)",
};

const READINESS_LABELS: Record<DatasetReadinessState, string> = {
  missing_credentials: "Missing credentials",
  not_initialized: "Not initialized",
  initializing: "Initializing",
  ready: "Ready",
  failed: "Failed",
};

function formatDateTime(value: string | undefined): string {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatError(error: unknown): DatasetErrorDetail | null {
  if (!error) return null;
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (rawMessage.includes("Unknown request tag") && rawMessage.includes("datasets.")) {
    return {
      code: "unknown",
      detail: rawMessage,
      actionableMessage:
        "The web app and local server are using different dataset protocols. Restart Lincei, then reload this window.",
    };
  }
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail = String((error as { detail?: unknown }).detail ?? "Dataset request failed.");
    const actionableMessage =
      "actionableMessage" in error
        ? String((error as { actionableMessage?: unknown }).actionableMessage ?? "")
        : "";
    return {
      code:
        "code" in error
          ? ((error as { code?: DatasetErrorDetail["code"] }).code ?? "unknown")
          : "unknown",
      detail,
      ...(actionableMessage ? { actionableMessage } : {}),
    };
  }
  return {
    code: "unknown",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function readinessVariant(readiness: DatasetReadinessState) {
  switch (readiness) {
    case "ready":
      return "success";
    case "initializing":
      return "info";
    case "failed":
      return "error";
    case "missing_credentials":
      return "warning";
    case "not_initialized":
      return "outline";
  }
}

function formatDerivedTables(snapshot: DatasetStatusSnapshot | null): string | null {
  const derivedTables = snapshot?.derivedTables;
  if (derivedTables?.supported !== true) {
    return null;
  }
  if (derivedTables.ready) {
    return "Derived tables ready";
  }
  if (derivedTables.total !== undefined && derivedTables.materialized !== undefined) {
    return `Derived tables: ${derivedTables.materialized.toLocaleString()}/${derivedTables.total.toLocaleString()} materialized`;
  }
  if (derivedTables.materialized !== undefined) {
    return `Derived tables: ${derivedTables.materialized.toLocaleString()} materialized`;
  }
  return "Derived tables not ready";
}

function ErrorDetail({
  error,
  className = "mt-3",
}: {
  error: DatasetErrorDetail | null | undefined;
  className?: string;
}) {
  if (!error) return null;
  return (
    <div
      className={`${className} rounded-lg border border-destructive/25 bg-destructive/4 p-3 text-xs`}
    >
      <div className="flex items-center gap-2 font-medium text-destructive-foreground">
        <AlertCircleIcon className="size-3.5" />
        {error.actionableMessage ?? error.detail}
      </div>
      {error.actionableMessage ? (
        <p className="mt-1 text-muted-foreground">{error.detail}</p>
      ) : null}
      {error.command ? (
        <code className="mt-2 block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {error.command}
        </code>
      ) : null}
      {error.stderr ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {error.stderr}
        </pre>
      ) : null}
    </div>
  );
}

interface DatasetRowProps {
  readonly datasetId: DatasetId;
  readonly backendId: DatasetBackendId;
  readonly snapshot: DatasetStatusSnapshot | null;
  readonly busy: boolean;
  readonly onInitialize: (datasetId: DatasetId) => void;
}

function DatasetRow({ datasetId, backendId, snapshot, busy, onInitialize }: DatasetRowProps) {
  const readiness = snapshot?.readiness ?? "not_initialized";
  const initializing = readiness === "initializing";
  const initialized = snapshot?.initialized ?? false;
  const derivedTablesLabel = formatDerivedTables(snapshot);

  return (
    <div className="border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-foreground">
              {DATASET_LABELS[datasetId]}
            </h3>
            <Badge variant={readinessVariant(readiness)}>{READINESS_LABELS[readiness]}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/80">{DATASET_DESCRIPTIONS[datasetId]}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Location: {DATA_LOCATION_LABELS[backendId]}</span>
            {snapshot?.path ? <span className="truncate">Path: {snapshot.path}</span> : null}
            {snapshot?.tables[0]?.rowCount !== undefined ? (
              <span>{snapshot.tables[0].rowCount.toLocaleString()} rows</span>
            ) : null}
            {derivedTablesLabel ? <span>{derivedTablesLabel}</span> : null}
          </div>
          {snapshot?.operation ? (
            <div className="mt-2 inline-flex items-center gap-2 text-xs text-info-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Started {formatDateTime(snapshot.operation.startedAt)}
            </div>
          ) : null}
          <ErrorDetail error={snapshot?.error} />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!initialized ? (
            <Button
              size="xs"
              variant="outline"
              disabled={busy || initializing}
              onClick={() => onInitialize(datasetId)}
            >
              {initializing ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
              Initialize
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DatasetSettingsPanel() {
  const datasetSettings = useSettings((settings) => settings.datasets);
  const { updateSettings } = useUpdateSettings();
  const [status, setStatus] = useState<DatasetStatusResult | null>(null);
  const [loadError, setLoadError] = useState<DatasetErrorDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<DatasetBackendId>(
    datasetSettings.preferredBackendId,
  );
  const [workspacePath, setWorkspacePath] = useState(datasetSettings.workspacePath);
  const [m4Command, setM4Command] = useState(datasetSettings.m4Command);
  const [physioNetUsername, setPhysioNetUsername] = useState("");
  const [physioNetPassword, setPhysioNetPassword] = useState("");
  const [bigQueryProjectId, setBigQueryProjectId] = useState("");
  const [bigQueryServiceAccountJson, setBigQueryServiceAccountJson] = useState("");
  const [useBigQueryAdc, setUseBigQueryAdc] = useState(false);

  useEffect(() => {
    setSelectedBackend(datasetSettings.preferredBackendId);
    setWorkspacePath(datasetSettings.workspacePath);
    setM4Command(datasetSettings.m4Command);
  }, [datasetSettings]);

  const refreshStatus = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const showLoading = options.showLoading ?? false;
    const refreshPromise = (async () => {
      if (showLoading) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const nextStatus = await ensureLocalApi().datasets.getStatus();
        setStatus(nextStatus);
        setPhysioNetUsername(
          (current) => current || (nextStatus.credentials.physioNet.username ?? ""),
        );
        setBigQueryProjectId(
          (current) => current || (nextStatus.credentials.bigQuery.projectId ?? ""),
        );
        setUseBigQueryAdc(nextStatus.credentials.bigQuery.applicationDefaultCredentials);
      } catch (error) {
        setLoadError(formatError(error));
      } finally {
        if (showLoading) {
          setLoading(false);
        }
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    void refreshStatus({ showLoading: true });

    const handleRefreshRequest = () => {
      if (document.visibilityState === "visible") {
        void refreshStatus();
      }
    };
    const refreshInterval = window.setInterval(() => {
      void refreshStatus();
    }, 30_000);

    window.addEventListener("focus", handleRefreshRequest);
    document.addEventListener("visibilitychange", handleRefreshRequest);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleRefreshRequest);
      document.removeEventListener("visibilitychange", handleRefreshRequest);
    };
  }, [refreshStatus]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setActionKey(key);
    setLoadError(null);
    try {
      await action();
    } catch (error) {
      setLoadError(formatError(error));
    } finally {
      setActionKey(null);
    }
  }, []);

  const commitDatasetSettings = useCallback(
    (patch: Partial<typeof datasetSettings>) => {
      updateSettings({
        datasets: {
          ...datasetSettings,
          ...patch,
        },
      });
    },
    [datasetSettings, updateSettings],
  );

  const datasetSnapshots = useMemo(() => {
    const snapshots = new Map<DatasetId, DatasetStatusSnapshot>();
    for (const dataset of status?.datasets ?? []) {
      if (dataset.backendId === selectedBackend || !snapshots.has(dataset.datasetId)) {
        snapshots.set(dataset.datasetId, dataset);
      }
    }
    return snapshots;
  }, [selectedBackend, status?.datasets]);

  const runtimeError = status?.runtime.error ?? null;
  const visibleError = loadError ?? runtimeError;
  const busy = loading || actionKey !== null;

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection title="Credentials" icon={<KeyRoundIcon className="size-3.5" />}>
        <ErrorDetail error={visibleError} className="m-4" />
        <SettingsRow
          title="PhysioNet"
          description="Required for downloading restricted MIMIC datasets. Saved secrets are never echoed back."
          status={
            status?.credentials.physioNet.stored
              ? `Stored for ${status.credentials.physioNet.username ?? "saved user"}`
              : "Not stored"
          }
        >
          <div className="grid gap-3 pt-3 pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <Input
              aria-label="PhysioNet username"
              placeholder="Username"
              value={physioNetUsername}
              onChange={(event) => setPhysioNetUsername(event.currentTarget.value)}
            />
            <Input
              aria-label="PhysioNet password"
              nativeInput
              placeholder="Password"
              type="password"
              value={physioNetPassword}
              onChange={(event) => setPhysioNetPassword(event.currentTarget.value)}
            />
            <Button
              size="sm"
              disabled={busy || !physioNetUsername.trim() || !physioNetPassword.trim()}
              onClick={() =>
                void runAction("save-physionet", async () => {
                  await ensureLocalApi().datasets.savePhysioNetCredentials({
                    username: physioNetUsername,
                    password: physioNetPassword,
                  });
                  setPhysioNetPassword("");
                  await refreshStatus();
                })
              }
            >
              Save PhysioNet credentials
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !status?.credentials.physioNet.stored}
              onClick={() =>
                void runAction("clear-physionet", async () => {
                  await ensureLocalApi().datasets.clearCredentials({ credentialKind: "physionet" });
                  setPhysioNetPassword("");
                  await refreshStatus();
                })
              }
            >
              <Trash2Icon className="size-3.5" />
              Clear
            </Button>
          </div>
        </SettingsRow>
        {selectedBackend === "bigquery" || status?.credentials.bigQuery.stored ? (
          <SettingsRow
            title="BigQuery"
            description="Required when the data location is Remote (BigQuery)."
            status={
              status?.credentials.bigQuery.stored
                ? `Stored for ${status.credentials.bigQuery.projectId ?? "saved project"}`
                : "Not stored"
            }
          >
            <div className="space-y-3 pt-3 pb-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  aria-label="BigQuery project ID"
                  placeholder="Project ID"
                  value={bigQueryProjectId}
                  onChange={(event) => setBigQueryProjectId(event.currentTarget.value)}
                />
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    aria-label="Use BigQuery application default credentials"
                    checked={useBigQueryAdc}
                    onCheckedChange={setUseBigQueryAdc}
                  />
                  Use ADC
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground"
                          aria-label="Application Default Credentials details"
                        >
                          <CircleHelpIcon className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipPopup
                      side="top"
                      align="end"
                      className="max-w-[min(320px,calc(100vw-2rem))] whitespace-normal text-left leading-relaxed text-wrap"
                    >
                      Use credentials already configured in your Google Cloud environment, such as
                      gcloud application-default login or a runtime service account. When enabled,
                      no service account JSON is stored.
                    </TooltipPopup>
                  </Tooltip>
                </label>
              </div>
              <Textarea
                aria-label="BigQuery service account JSON"
                placeholder="Service account JSON"
                value={bigQueryServiceAccountJson}
                onChange={(event) => setBigQueryServiceAccountJson(event.currentTarget.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    !bigQueryProjectId.trim() ||
                    (!useBigQueryAdc && !bigQueryServiceAccountJson.trim())
                  }
                  onClick={() =>
                    void runAction("save-bigquery", async () => {
                      await ensureLocalApi().datasets.saveBigQueryCredentials({
                        projectId: bigQueryProjectId,
                        serviceAccountJson: bigQueryServiceAccountJson.trim() || undefined,
                        useApplicationDefaultCredentials: useBigQueryAdc,
                      });
                      setBigQueryServiceAccountJson("");
                      await refreshStatus();
                    })
                  }
                >
                  Save BigQuery credentials
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !status?.credentials.bigQuery.stored}
                  onClick={() =>
                    void runAction("clear-bigquery", async () => {
                      await ensureLocalApi().datasets.clearCredentials({
                        credentialKind: "bigquery",
                      });
                      setBigQueryServiceAccountJson("");
                      await refreshStatus();
                    })
                  }
                >
                  <Trash2Icon className="size-3.5" />
                  Clear
                </Button>
              </div>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Datasets" icon={<DatabaseIcon className="size-3.5" />}>
        {DATASET_IDS.map((datasetId) => (
          <DatasetRow
            key={datasetId}
            datasetId={datasetId}
            backendId={selectedBackend}
            snapshot={datasetSnapshots.get(datasetId) ?? null}
            busy={busy}
            onInitialize={(nextDatasetId) =>
              void runAction(`initialize-${nextDatasetId}`, async () => {
                const result = await ensureLocalApi().datasets.initialize({
                  datasetId: nextDatasetId,
                  backendId: selectedBackend,
                });
                setStatus(result);
                await refreshStatus();
              })
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Advanced Setup" icon={<Settings2Icon className="size-3.5" />}>
        {status?.runtime.available === false ? (
          <SettingsRow
            title="Dataset engine unavailable"
            description="Local dataset tooling is not available from the configured command."
            control={<Badge variant="error">Unavailable</Badge>}
          />
        ) : null}
        <details
          className={
            status?.runtime.available === false ? "group border-t border-border/60" : "group"
          }
          open={status?.runtime.available === false}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[13px] font-semibold text-foreground sm:px-5 [&::-webkit-details-marker]:hidden">
            Runtime and data location details
            <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <SettingsRow
            title="Workspace path"
            description="Directory where local dataset artifacts are managed."
            status={
              status?.runtime.workspacePath ?? "Defaults to Lincei's managed dataset directory."
            }
            control={
              <Input
                aria-label="Dataset workspace path"
                className="w-full sm:w-80"
                placeholder="Managed Lincei dataset directory"
                value={workspacePath}
                onBlur={() => commitDatasetSettings({ workspacePath })}
                onChange={(event) => setWorkspacePath(event.currentTarget.value)}
              />
            }
          />
          <SettingsRow
            title="Data location"
            description="Where Lincei initializes datasets for this workspace."
            control={
              <Select
                value={selectedBackend}
                onValueChange={(value) => {
                  const backendId = value as DatasetBackendId;
                  setSelectedBackend(backendId);
                  commitDatasetSettings({ preferredBackendId: backendId });
                }}
              >
                <SelectTrigger aria-label="Dataset data location" className="w-48" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="duckdb">Local</SelectItem>
                  <SelectItem value="bigquery">Remote (BigQuery)</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          <details
            className="group border-t border-border/60"
            open={status?.runtime.available === false}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[13px] font-semibold text-foreground sm:px-5 [&::-webkit-details-marker]:hidden">
              M4 command troubleshooting
              <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <SettingsRow
              title="M4 command"
              description="Override the server command only when the default M4 launcher cannot run here."
              control={
                <Input
                  aria-label="M4 command"
                  className="w-full sm:w-80"
                  placeholder="uvx --from m4-infra m4"
                  value={m4Command}
                  onBlur={() => commitDatasetSettings({ m4Command })}
                  onChange={(event) => setM4Command(event.currentTarget.value)}
                />
              }
            />
          </details>
        </details>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
