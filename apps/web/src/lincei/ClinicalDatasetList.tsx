import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ClinicalDataset,
  type EnvironmentId,
  type LinceiRequest,
} from "@t3tools/contracts";
import { useState } from "react";

import { ExpandableText } from "~/components/settings/ExpandableText";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { toastManager } from "~/components/ui/toast";
import { readLocalApi } from "~/localApi";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { describeDataset, describeJobProgress } from "./clinicalPresentation";
import { describeCommandFailure, useClinicalDatasets } from "./clinicalState";
import { linceiCommand } from "./linceiRequests";
import { PhysioNetDownloadDialog } from "./PhysioNetDownloadDialog";

type DatasetAction = Extract<
  LinceiRequest,
  { _tag: "ClinicalDatasetAdd" | "ClinicalDatasetDownload" | "ClinicalDatasetCancel" }
>;

const FAILURE_TITLES: Record<DatasetAction["_tag"], (name: string) => string> = {
  ClinicalDatasetAdd: (name) => `Could not add ${name}`,
  ClinicalDatasetDownload: (name) => `Could not download ${name}`,
  ClinicalDatasetCancel: (name) => `Could not stop ${name}`,
};

/** A bar that only moves when progress does: no animation to repaint between updates. */
function ProgressBar({ fraction }: { readonly fraction: number }) {
  const percent = Math.round(fraction * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

function AddFromFolderDialog({
  dataset,
  canBrowse,
  onAdd,
  onClose,
}: {
  readonly dataset: ClinicalDataset | null;
  /** The folder is on this computer, so its own folder picker can choose it. */
  readonly canBrowse: boolean;
  readonly onAdd: (name: string, source: string) => void;
  readonly onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const close = () => {
    setSource("");
    onClose();
  };
  const submit = () => {
    if (dataset === null || source.trim().length === 0) return;
    onAdd(dataset.name, source.trim());
    close();
  };
  return (
    <Dialog open={dataset !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add {dataset?.name} from a folder</DialogTitle>
          <DialogDescription>
            Choose the folder that holds the dataset&apos;s raw CSV.gz files as downloaded from
            PhysioNet. Lincei prepares them for queries and leaves the folder as it is.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Label htmlFor="clinical-dataset-source">Folder</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id="clinical-dataset-source"
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="/path/to/raw/files"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                />
              </div>
              {canBrowse ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void readLocalApi()
                      ?.dialogs.pickFolder()
                      .then((picked) => (picked ? setSource(picked) : undefined))
                      .catch(() => undefined)
                  }
                >
                  Choose…
                </Button>
              ) : null}
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={source.trim().length === 0} onClick={submit}>
            Add dataset
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DatasetRow({
  dataset,
  disabled,
  onAction,
  onAddFromFolder,
  onDownloadWithLogin,
}: {
  readonly dataset: ClinicalDataset;
  readonly disabled: boolean;
  readonly onAction: (action: DatasetAction) => void;
  readonly onAddFromFolder: () => void;
  readonly onDownloadWithLogin: () => void;
}) {
  const { job, name } = dataset;
  const running = job?.state === "running";
  const progress = running ? describeJobProgress(job) : null;
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{name}</h3>
          {dataset.requiresCredentials ? <Badge variant="outline">PhysioNet access</Badge> : null}
        </div>
        {progress === null ? (
          <p className="text-xs text-muted-foreground">{describeDataset(dataset)}</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{progress.label}</p>
            {progress.fraction === null ? null : <ProgressBar fraction={progress.fraction} />}
          </div>
        )}
        {job?.state === "failed" ? (
          <div className="space-y-1 text-xs">
            <p className="text-destructive">{job.message}</p>
            {job.detail === undefined || job.detail === job.message ? null : (
              <ExpandableText
                text={job.detail}
                className="font-mono text-muted-foreground"
                expandLabel="Show what M4 reported"
              />
            )}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {running ? (
          // Setup's own download of the demo is not a job; it ends with setup.
          job.kind === "setup" ? null : (
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => onAction({ _tag: "ClinicalDatasetCancel", name })}
            >
              Cancel
            </Button>
          )
        ) : dataset.state === "ready" ? null : (
          <>
            {job?.state === "failed" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onAction({ _tag: "ClinicalDatasetCancel", name })}
              >
                Dismiss
              </Button>
            ) : null}
            <Button size="xs" variant="outline" disabled={disabled} onClick={onAddFromFolder}>
              Add from folder…
            </Button>
            {dataset.downloadable ? (
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={
                  dataset.requiresCredentials
                    ? onDownloadWithLogin
                    : () => onAction({ _tag: "ClinicalDatasetDownload", name })
                }
              >
                {dataset.requiresCredentials ? "Download…" : "Download"}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * M4's datasets on one environment: what is there, what is being prepared,
 * and the ways to add one. Renders nothing until M4 is installed there.
 */
export function ClinicalDatasetList({
  environmentId,
  enabled,
}: {
  readonly environmentId: EnvironmentId;
  /** Whether M4 is installed, so there is something to ask. */
  readonly enabled: boolean;
}) {
  const { datasets, error, refresh } = useClinicalDatasets(environmentId, enabled);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [addingTo, setAddingTo] = useState<ClinicalDataset | null>(null);
  const [signingInFor, setSigningInFor] = useState<ClinicalDataset | null>(null);
  // Stopping a job waits for M4 to exit, which can take a few seconds.
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set());

  const run = async (action: DatasetAction) => {
    setActing((names) => new Set(names).add(action.name));
    const result = await request({ environmentId, input: action });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: FAILURE_TITLES[action._tag](action.name),
        description: describeCommandFailure(result),
      });
    }
    refresh();
    setActing((names) => {
      const next = new Set(names);
      next.delete(action.name);
      return next;
    });
  };

  if (!enabled) return null;
  if (datasets === null) {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        {error ?? "Looking for datasets…"}
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border/60">
        {datasets.map((dataset) => (
          <DatasetRow
            key={dataset.name}
            dataset={dataset}
            disabled={!canOperate || acting.has(dataset.name)}
            onAction={(action) => void run(action)}
            onAddFromFolder={() => setAddingTo(dataset)}
            onDownloadWithLogin={() => setSigningInFor(dataset)}
          />
        ))}
      </ul>
      <AddFromFolderDialog
        dataset={addingTo}
        canBrowse={window.desktopBridge !== undefined && environmentId === primaryEnvironmentId}
        onAdd={(name, source) => void run({ _tag: "ClinicalDatasetAdd", name, source })}
        onClose={() => setAddingTo(null)}
      />
      <PhysioNetDownloadDialog
        dataset={signingInFor}
        environmentId={environmentId}
        onDownload={(name, credentials) =>
          void run({ _tag: "ClinicalDatasetDownload", name, credentials })
        }
        onClose={() => setSigningInFor(null)}
      />
    </>
  );
}
