import {
  AuthOrchestrationOperateScope,
  type ClinicalDataset,
  type EnvironmentId,
  type LinceiRequest,
} from "@t3tools/contracts";
import { type ReactNode, useId, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { AddFromFolderDialog } from "./AddFromFolderDialog";
import { ClinicalNote } from "./ClinicalNote";
import {
  datasetDisplayName,
  describeDataset,
  describeJobProgress,
  withDatasetName,
} from "./clinicalPresentation";
import { useClinicalDatasets } from "./clinicalState";
import { datasetActionOutcome, type DatasetActionOutcome } from "./linceiAnswers";
import { linceiCommand } from "./linceiRequests";
import { PhysioNetLink, physioNetProjectPage } from "./physioNet";
import { PhysioNetDownloadDialog } from "./PhysioNetDownloadDialog";
import { TechnicalDetails } from "./TechnicalDetails";

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
function ProgressBar({
  fraction,
  labelledBy,
}: {
  readonly fraction: number;
  /** The id of the sentence that says what is progressing. */
  readonly labelledBy: string;
}) {
  const percent = Math.round(fraction * 100);
  return (
    <div
      role="progressbar"
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

function DatasetRow({
  dataset,
  place,
  disabled,
  onAction,
  onAddFromFolder,
  onDownloadWithLogin,
}: {
  readonly dataset: ClinicalDataset;
  /** Where the datasets are kept, in the reader's words. */
  readonly place: string;
  readonly disabled: boolean;
  readonly onAction: (action: DatasetAction) => void;
  readonly onAddFromFolder: () => void;
  readonly onDownloadWithLogin: () => void;
}) {
  const progressId = useId();
  const { job, name } = dataset;
  const running = job?.state === "running";
  const progress = running ? describeJobProgress(job) : null;
  // Where the account gets access: the data use agreement is signed on the dataset's own page.
  const projectPage =
    dataset.requiresCredentials && dataset.state !== "ready" ? physioNetProjectPage(name) : null;
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{datasetDisplayName(name)}</h3>
          {dataset.requiresCredentials ? (
            <Badge variant="outline">Needs PhysioNet access</Badge>
          ) : null}
        </div>
        {progress === null ? (
          <p className="text-xs text-muted-foreground">
            {describeDataset(dataset, place)}
            {projectPage === null ? null : (
              <>
                {" "}
                <PhysioNetLink href={projectPage}>
                  {datasetDisplayName(name)} on PhysioNet
                </PhysioNetLink>
              </>
            )}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p id={progressId} className="text-xs wrap-anywhere text-muted-foreground">
              {progress.label}
            </p>
            {progress.fraction === null ? null : (
              <ProgressBar fraction={progress.fraction} labelledBy={progressId} />
            )}
          </div>
        )}
        {job?.state === "failed" ? (
          <div className="space-y-1 text-xs">
            <p className="text-destructive">{withDatasetName(job.message, name)}</p>
            {job.detail === undefined || job.detail === job.message ? null : (
              <TechnicalDetails label="Show what M4 reported" text={job.detail} />
            )}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {running ? (
          // Setup's own download of the demo is not a job to stop; it ends with setup.
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

/** A note in place of, or under, the rows, set in like them. */
function ListNote({
  children,
  detail,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly detail?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="px-3 py-3 sm:px-4">
      <ClinicalNote detail={detail} onRetry={onRetry}>
        {children}
      </ClinicalNote>
    </div>
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
  const { view, takingLong, refresh, accept } = useClinicalDatasets(environmentId, enabled);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const environment = useEnvironment(environmentId);
  // The server that serves this app is "this computer" to its user.
  const onThisComputer = usePrimaryEnvironmentId() === environmentId;
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [addingTo, setAddingTo] = useState<ClinicalDataset | null>(null);
  const [signingInFor, setSigningInFor] = useState<ClinicalDataset | null>(null);
  // Stopping a job waits for M4 to exit, which can take a few seconds.
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set());
  // The folder last handed over for each dataset. M4 only finds out whether it
  // holds the right files after the dialog has closed.
  const [folders, setFolders] = useState<ReadonlyMap<string, string>>(new Map());

  /**
   * Sends a dataset command. The server answers with the list as it is
   * afterwards, which is shown at once, so the row has changed by the time
   * its buttons work again.
   */
  const run = async (action: DatasetAction): Promise<DatasetActionOutcome> => {
    setActing((names) => new Set(names).add(action.name));
    const outcome = datasetActionOutcome(await request({ environmentId, input: action }));
    if (outcome.accepted) accept(outcome.datasets);
    refresh();
    setActing((names) => {
      const next = new Set(names);
      next.delete(action.name);
      return next;
    });
    return outcome;
  };

  /** For a row's own buttons, which have no form to show a refusal in. */
  const runFromRow = async (action: DatasetAction) => {
    const outcome = await run(action);
    if (outcome.accepted || outcome.message === null) return;
    toastManager.add({
      type: "error",
      title: FAILURE_TITLES[action._tag](datasetDisplayName(action.name)),
      description: withDatasetName(outcome.message, action.name),
    });
  };

  if (!enabled) return null;
  if (view.phase === "loading") {
    return (
      <ListNote onRetry={takingLong ? refresh : undefined}>
        {takingLong
          ? "Still looking for datasets. This is taking longer than it should."
          : "Looking for datasets…"}
      </ListNote>
    );
  }
  if (view.phase === "failed") {
    return (
      <ListNote detail={view.detail} onRetry={refresh}>
        {view.message}
      </ListNote>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border/60">
        {view.datasets.map((dataset) => (
          <DatasetRow
            key={dataset.name}
            dataset={dataset}
            place={onThisComputer ? "this computer" : (environment?.label ?? "that computer")}
            disabled={!canOperate || acting.has(dataset.name)}
            onAction={(action) => void runFromRow(action)}
            onAddFromFolder={() => setAddingTo(dataset)}
            onDownloadWithLogin={() => setSigningInFor(dataset)}
          />
        ))}
      </ul>
      {view.refreshProblem === null ? null : (
        <div className="border-t border-border/60">
          <ListNote detail={view.refreshProblem.detail} onRetry={refresh}>
            This list may be out of date. {view.refreshProblem.message}
          </ListNote>
        </div>
      )}
      <AddFromFolderDialog
        dataset={addingTo}
        canBrowse={window.desktopBridge !== undefined && onThisComputer}
        serverName={environment?.label ?? null}
        lastFolder={addingTo === null ? "" : (folders.get(addingTo.name) ?? "")}
        onAdd={async (name, source) => {
          const outcome = await run({ _tag: "ClinicalDatasetAdd", name, source });
          if (outcome.accepted) setFolders((known) => new Map(known).set(name, source));
          return outcome;
        }}
        onClose={() => setAddingTo(null)}
      />
      <PhysioNetDownloadDialog
        dataset={signingInFor}
        environmentId={environmentId}
        onDownload={(name, credentials) =>
          run({ _tag: "ClinicalDatasetDownload", name, credentials })
        }
        onClose={() => setSigningInFor(null)}
      />
    </>
  );
}
