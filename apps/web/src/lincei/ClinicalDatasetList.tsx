import { useAtomValue } from "@effect/atom-react";
import { type ClinicalDataset, type EnvironmentId, type LinceiRequest } from "@t3tools/contracts";
import { type ReactNode, useId, useState } from "react";

import { EllipsisIcon } from "lucide-react";

import { SettingsSearchTarget } from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { AddDatasetDialog, type AddDatasetMode, type AddDatasetRequest } from "./AddDatasetDialog";
import { AddOwnDatasetDialog } from "./AddOwnDatasetDialog";
import { ClinicalNote } from "./ClinicalNote";
import {
  datasetDisplayName,
  datasetFacts,
  datasetGroup,
  describeDataset,
  describeJobProgress,
  serverOnThisComputer,
  withDatasetName,
} from "./clinicalPresentation";
import { useClinicalDatasets } from "./clinicalState";
import {
  classifyLinceiFailure,
  datasetActionOutcome,
  type DatasetActionOutcome,
  describeLinceiFailure,
} from "./linceiAnswers";
import { linceiCommand } from "./linceiRequests";
import { ExternalLink, hostOf, PhysioNetLinkedText } from "./physioNet";
import { ProviderDataNotice } from "./ProviderDataNotice";
import { RemoveDatasetDialog } from "./RemoveDatasetDialog";
import { CLINICAL_SETTINGS } from "./settingsSearchItems";
import { TechnicalDetails } from "./TechnicalDetails";

type DatasetAction = Extract<
  LinceiRequest,
  {
    _tag:
      | "ClinicalDatasetAdd"
      | "ClinicalDatasetDownload"
      | "ClinicalDatasetDefine"
      | "ClinicalDatasetRemove"
      | "ClinicalDatasetCancel";
  }
>;

const FAILURE_TITLES: Record<DatasetAction["_tag"], (name: string) => string> = {
  ClinicalDatasetAdd: (name) => `Could not add ${name}`,
  ClinicalDatasetDownload: (name) => `Could not download ${name}`,
  ClinicalDatasetDefine: (name) => `Could not add ${name}`,
  ClinicalDatasetRemove: (name) => `Could not remove ${name}`,
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

/** Why the last attempt on a dataset stopped, with what M4 reported for whoever helps. */
function JobFailure({ dataset }: { readonly dataset: ClinicalDataset }) {
  const { job } = dataset;
  if (job?.state !== "failed") return null;
  return (
    <div className="space-y-1 text-xs">
      <p className="text-destructive">
        <PhysioNetLinkedText text={withDatasetName(job.message, dataset)} />
      </p>
      {job.detail === undefined || job.detail === job.message ? null : (
        <TechnicalDetails label="Show what M4 reported" text={job.detail} />
      )}
    </div>
  );
}

/** What sets a dataset apart in its row: that it needs PhysioNet access, or was defined here. */
/** The way back into the dialog after an attempt: the way that attempt went. */
const retryMode = (dataset: ClinicalDataset): AddDatasetMode =>
  dataset.job?.kind === "add" || !dataset.downloadable ? "folder" : "download";

/** A dataset this computer has, or is getting: its state, and what can be done about it. */
function PresentRow({
  dataset,
  place,
  disabled,
  onAction,
  onOpen,
  onShowFiles,
  onRemove,
}: {
  readonly dataset: ClinicalDataset;
  /** Where the datasets are kept, in the reader's words. */
  readonly place: string;
  readonly disabled: boolean;
  readonly onAction: (action: DatasetAction) => void;
  readonly onOpen: (mode: AddDatasetMode) => void;
  /** Shows its files, where they are on this computer. */
  readonly onShowFiles: (() => void) | null;
  /** Null where the server cannot remove datasets. */
  readonly onRemove: (() => void) | null;
}) {
  const progressId = useId();
  const { job, name } = dataset;
  const running = job?.state === "running";
  const progress = running ? describeJobProgress(job) : null;
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium text-foreground">{datasetDisplayName(dataset)}</h4>
          {dataset.custom === true ? <Badge variant="outline">Custom</Badge> : null}
        </div>
        {progress === null ? (
          <p className="text-xs text-muted-foreground">{describeDataset(dataset, place)}</p>
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
        {dataset.notes === undefined || running ? null : (
          <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
            {dataset.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <JobFailure dataset={dataset} />
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
        ) : (
          <>
            {dataset.state === "ready" ? null : (
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
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onOpen(retryMode(dataset))}
                >
                  {job?.state === "failed" ? "Try again…" : "Finish…"}
                </Button>
              </>
            )}
            <DatasetMenu
              dataset={dataset}
              disabled={disabled}
              onShowFiles={onShowFiles}
              onRemove={onRemove}
            />
          </>
        )}
      </div>
    </li>
  );
}

/** What else can be done with a dataset; nothing at all where there is nothing to offer. */
function DatasetMenu({
  dataset,
  disabled,
  onShowFiles,
  onRemove,
}: {
  readonly dataset: ClinicalDataset;
  readonly disabled: boolean;
  readonly onShowFiles: (() => void) | null;
  readonly onRemove: (() => void) | null;
}) {
  if (onShowFiles === null && onRemove === null) return null;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={`More for ${datasetDisplayName(dataset)}`}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {onShowFiles === null ? null : <MenuItem onClick={onShowFiles}>Show files</MenuItem>}
        {onRemove === null ? null : (
          <MenuItem variant="destructive" onClick={onRemove}>
            Remove…
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** A dataset that can be added: what it is, what it takes, and the one way to start. */
function AvailableRow({
  dataset,
  disabled,
  onAction,
  onOpen,
  onRemove,
}: {
  readonly dataset: ClinicalDataset;
  readonly disabled: boolean;
  readonly onAction: (action: DatasetAction) => void;
  readonly onOpen: (mode: AddDatasetMode) => void;
  /**
   * Forgets a dataset defined here whose files are gone. Null for one M4
   * ships, which stays in the list, and where the server cannot remove.
   */
  readonly onRemove: (() => void) | null;
}) {
  const failed = dataset.job?.state === "failed";
  const facts = datasetFacts(dataset);
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="text-sm font-medium text-foreground">{datasetDisplayName(dataset)}</h4>
        {dataset.summary === undefined ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">{dataset.summary}</p>
        )}
        {facts.length === 0 && dataset.pageUrl === undefined ? null : (
          <p className="text-xs text-muted-foreground/80">
            {facts.join(" · ")}
            {dataset.pageUrl === undefined ? null : (
              <>
                {facts.length === 0 ? null : " · "}
                <ExternalLink href={dataset.pageUrl}>{hostOf(dataset.pageUrl)}</ExternalLink>
              </>
            )}
          </p>
        )}
        <JobFailure dataset={dataset} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {failed ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => onAction({ _tag: "ClinicalDatasetCancel", name: dataset.name })}
          >
            Dismiss
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => onOpen(retryMode(dataset))}
        >
          {failed ? "Try again…" : "Add…"}
        </Button>
        <DatasetMenu dataset={dataset} disabled={disabled} onShowFiles={null} onRemove={onRemove} />
      </div>
    </li>
  );
}

/** The way to add a dataset M4 does not know: the user's own files. */
function OwnDatasetRow({
  disabled,
  onOpen,
}: {
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-6 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="text-sm font-medium text-foreground">Your own dataset</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A folder of CSV files, such as an export from your hospital or a registry.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="xs" variant="outline" disabled={disabled} onClick={onOpen}>
          Add…
        </Button>
      </div>
    </li>
  );
}

/** One of the list's groups, under a heading of its own. */
function DatasetGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <h3 className="px-3 pt-3 text-xs font-medium text-muted-foreground sm:px-4">{title}</h3>
      <ul className="divide-y divide-border/60">{children}</ul>
    </div>
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
  storageDir,
}: {
  readonly environmentId: EnvironmentId;
  /** Whether M4 is installed, so there is something to ask. */
  readonly enabled: boolean;
  /** Where the prepared datasets are kept, to name under the list. */
  readonly storageDir?: string;
}) {
  const { view, takingLong, refresh, accept } = useClinicalDatasets(environmentId, enabled);
  const canOperate = useAtomValue(linceiCommand.permissionAtom(environmentId));
  const environment = useEnvironment(environmentId);
  // Not "the primary environment": a browser reaches that one over the network too.
  const onThisComputer = serverOnThisComputer(useEnvironmentHttpBaseUrl(environmentId));
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [adding, setAdding] = useState<AddDatasetRequest | null>(null);
  const [addingOwn, setAddingOwn] = useState(false);
  const [removing, setRemoving] = useState<ClinicalDataset | null>(null);
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
    if (outcome.accepted) accept(outcome.datasets, outcome.actions);
    refresh();
    setActing((names) => {
      const next = new Set(names);
      next.delete(action.name);
      return next;
    });
    return outcome;
  };

  /** For a row's own buttons, which have no form to show a refusal in. */
  const runFromRow = async (dataset: ClinicalDataset, action: DatasetAction) => {
    const outcome = await run(action);
    if (outcome.accepted || outcome.message === null) return;
    toastManager.add({
      type: "error",
      title: FAILURE_TITLES[action._tag](datasetDisplayName(dataset)),
      description: withDatasetName(outcome.message, dataset),
    });
  };

  /** Opens the dataset's folder on this computer's screen, where the server runs too. */
  const showFiles = async (dataset: ClinicalDataset | null) => {
    const result = await request({
      environmentId,
      input:
        dataset === null
          ? { _tag: "ClinicalDataFolderOpen" }
          : { _tag: "ClinicalDataFolderOpen", name: dataset.name },
    });
    if (result._tag !== "Failure") return;
    toastManager.add({
      type: "error",
      title:
        dataset === null
          ? "Could not open the folder"
          : `Could not show the files of ${datasetDisplayName(dataset)}`,
      description: describeLinceiFailure(classifyLinceiFailure(result.cause)) ?? undefined,
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
  const place = onThisComputer ? "this computer" : (environment?.label ?? "that computer");
  const { actions } = view;
  // A server that describes its actions also opens folders; one elsewhere would open them on its own screen.
  const canOpenFolder = actions !== null && onThisComputer;
  const grouped = (group: ReturnType<typeof datasetGroup>) =>
    view.datasets.filter((dataset) => datasetGroup(dataset) === group);
  const present = grouped("present");
  const open = grouped("open");
  const credentialed = grouped("credentialed");
  const own = grouped("own");
  const rowProps = (dataset: ClinicalDataset) => ({
    dataset,
    disabled: !canOperate || acting.has(dataset.name),
    onAction: (action: DatasetAction) => void runFromRow(dataset, action),
    onOpen: (mode: AddDatasetMode) => setAdding({ dataset, mode }),
  });
  const availableRow = (dataset: ClinicalDataset) => (
    <AvailableRow
      key={dataset.name}
      onRemove={
        dataset.custom === true && actions?.remove === true ? () => setRemoving(dataset) : null
      }
      {...rowProps(dataset)}
    />
  );
  return (
    <>
      {present.length === 0 ? null : (
        <DatasetGroup title={onThisComputer ? "On this computer" : `On ${place}`}>
          {present.map((dataset) => (
            <PresentRow
              key={dataset.name}
              place={place}
              onShowFiles={canOpenFolder ? () => void showFiles(dataset) : null}
              onRemove={actions?.remove === true ? () => setRemoving(dataset) : null}
              {...rowProps(dataset)}
            />
          ))}
        </DatasetGroup>
      )}
      {present.some((dataset) => dataset.requiresCredentials) ? (
        <div className="px-3 pb-3 sm:px-4">
          <ProviderDataNotice subject="these datasets" />
        </div>
      ) : null}
      {open.length + credentialed.length + own.length === 0 && actions?.define !== true ? null : (
        <div
          className={
            present.length === 0
              ? "divide-y divide-border/60"
              : "divide-y divide-border/60 border-t border-border/60"
          }
        >
          {open.length === 0 ? null : (
            <DatasetGroup title="Open, no login needed">{open.map(availableRow)}</DatasetGroup>
          )}
          {credentialed.length === 0 ? null : (
            <DatasetGroup title="Needs PhysioNet access">
              {credentialed.map(availableRow)}
            </DatasetGroup>
          )}
          {own.length === 0 && actions?.define !== true ? null : (
            <DatasetGroup title="Your own data">
              {own.map(availableRow)}
              {actions?.define === true ? (
                <OwnDatasetRow disabled={!canOperate} onOpen={() => setAddingOwn(true)} />
              ) : null}
            </DatasetGroup>
          )}
        </div>
      )}
      {storageDir === undefined ? null : (
        <SettingsSearchTarget
          id={CLINICAL_SETTINGS.location.id}
          className="flex items-center gap-3 border-t border-border/60 px-3 py-3 sm:px-4"
        >
          {/* Not "Lincei's folder": a user who set M4_DATA_DIR keeps their own. */}
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Stored in{" "}
            <span className="font-mono break-all text-muted-foreground/80">{storageDir}</span>
          </p>
          {canOpenFolder ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void showFiles(null)}
            >
              Open folder
            </Button>
          ) : null}
        </SettingsSearchTarget>
      )}
      {view.refreshProblem === null ? null : (
        <div className="border-t border-border/60">
          <ListNote detail={view.refreshProblem.detail} onRetry={refresh}>
            This list may be out of date. {view.refreshProblem.message}
          </ListNote>
        </div>
      )}
      <AddDatasetDialog
        request={adding}
        environmentId={environmentId}
        canBrowse={window.desktopBridge !== undefined && onThisComputer}
        lastFolders={folders}
        onAdd={async (name, source) => {
          const outcome = await run({ _tag: "ClinicalDatasetAdd", name, source });
          if (outcome.accepted) setFolders((known) => new Map(known).set(name, source));
          return outcome;
        }}
        onDownload={(name, credentials) =>
          run({
            _tag: "ClinicalDatasetDownload",
            name,
            ...(credentials === undefined ? {} : { credentials }),
          })
        }
        onClose={() => setAdding(null)}
      />
      <RemoveDatasetDialog
        dataset={removing}
        place={place}
        onRemove={(dataset) =>
          void runFromRow(dataset, { _tag: "ClinicalDatasetRemove", name: dataset.name })
        }
        onClose={() => setRemoving(null)}
      />
      <AddOwnDatasetDialog
        open={addingOwn}
        canBrowse={window.desktopBridge !== undefined && onThisComputer}
        serverName={environment?.label ?? null}
        takenIds={new Set(view.datasets.map((dataset) => dataset.name))}
        onDefine={(input) => run({ _tag: "ClinicalDatasetDefine", ...input })}
        onClose={() => setAddingOwn(false)}
      />
    </>
  );
}
