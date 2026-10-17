import type { ClinicalDataset, EnvironmentId, PhysioNetCredentials } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
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
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";

import {
  connectionProtectsSecrets,
  datasetDisplayName,
  folderPathProblem,
  formatBytes,
  withDatasetName,
} from "./clinicalPresentation";
import { FolderField } from "./FolderField";
import { type DatasetActionOutcome, NO_ANSWER } from "./linceiAnswers";
import { PhysioNetAccessChecklist } from "./physioNet";
import { ProviderDataAcknowledgement, ProviderDataNotice } from "./ProviderDataNotice";
import { useLastPresent } from "./useLastPresent";

/** The username is remembered on this device so only the password is typed again. */
const USERNAME_STORAGE_KEY = "lincei:physionet-username";

function readRememberedUsername(): string {
  try {
    return window.localStorage.getItem(USERNAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberUsername(username: string) {
  try {
    window.localStorage.setItem(USERNAME_STORAGE_KEY, username);
  } catch {
    // Storage is a convenience; the download does not depend on it.
  }
}

/** The two ways in: Lincei downloads the files, or prepares ones already on the server. */
export type AddDatasetMode = "download" | "folder";

/** Which dataset the dialog adds, and the way it starts with. */
export interface AddDatasetRequest {
  readonly dataset: ClinicalDataset;
  readonly mode: AddDatasetMode;
}

interface AddDatasetProps {
  readonly environmentId: EnvironmentId;
  /** The folder is on this computer, so its own folder picker can choose it. */
  readonly canBrowse: boolean;
  /** The folder last given for each dataset, to start from when that attempt failed. */
  readonly lastFolders: ReadonlyMap<string, string>;
  /** Asks the server to start the download, and answers whether it took that on. */
  readonly onDownload: (
    name: string,
    credentials: PhysioNetCredentials | undefined,
  ) => Promise<DatasetActionOutcome>;
  /** Asks the server to prepare the dataset from the folder, and answers whether it took that on. */
  readonly onAdd: (name: string, source: string) => Promise<DatasetActionOutcome>;
  readonly onClose: () => void;
}

/** A link-like control in running text, for switching between the two ways in. */
function SwitchMode({
  disabled,
  onClick,
  children,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-64"
    >
      {children}
    </button>
  );
}

function AddDatasetForm({
  dataset,
  initialMode,
  environmentId,
  canBrowse,
  lastFolders,
  onDownload,
  onAdd,
  onClose,
  busy,
  setBusy,
}: AddDatasetProps & {
  readonly dataset: ClinicalDataset;
  readonly initialMode: AddDatasetMode;
  /** The server is being asked. Held by the dialog, which stays open meanwhile. */
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
}) {
  const usernameId = useId();
  const passwordId = useId();
  const problemId = useId();
  const [mode, setMode] = useState<AddDatasetMode>(dataset.downloadable ? initialMode : "folder");
  const [username, setUsername] = useState(readRememberedUsername);
  // The password lives in this field and the one request that carries it.
  const [password, setPassword] = useState("");
  const [source, setSource] = useState(lastFolders.get(dataset.name) ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  // Only credentialed data comes with PhysioNet's rules for AI services.
  const [acknowledged, setAcknowledged] = useState(!dataset.requiresCredentials);
  const baseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const serverName = useEnvironment(environmentId)?.label ?? null;
  const computer = serverName ?? "that computer";
  const name = datasetDisplayName(dataset);
  const signIn = mode === "download" && dataset.requiresCredentials;
  // No address means Lincei is between connections, which is not the same as
  // an address that would expose the password.
  const connected = baseUrl !== null;
  const mayType = connected && connectionProtectsSecrets(baseUrl);
  const folder = source.trim();
  const ready =
    !busy &&
    acknowledged &&
    (mode === "folder"
      ? folder.length > 0
      : !signIn || (mayType && username.trim().length > 0 && password.length > 0));
  const size =
    dataset.downloadSizeGb === undefined
      ? "its files"
      : `about ${formatBytes(dataset.downloadSizeGb * 1024 ** 3)}`;

  const switchTo = (next: AddDatasetMode) => {
    setMode(next);
    setProblem(null);
  };

  const submit = async () => {
    if (!ready) return;
    if (mode === "folder") {
      const unusable = folderPathProblem(folder);
      if (unusable !== null) {
        setProblem(unusable);
        return;
      }
    }
    if (signIn) rememberUsername(username.trim());
    setBusy(true);
    const outcome =
      mode === "folder"
        ? await onAdd(dataset.name, folder)
        : await onDownload(
            dataset.name,
            signIn ? { username: username.trim(), password: Redacted.make(password) } : undefined,
          );
    setBusy(false);
    if (outcome.accepted) {
      setPassword("");
      onClose();
      return;
    }
    setProblem(withDatasetName(outcome.message ?? NO_ANSWER, dataset));
  };

  const problemNote =
    problem === null ? null : (
      <p id={problemId} role="alert" className="text-xs leading-relaxed text-destructive">
        {problem}
      </p>
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add {name}</DialogTitle>
        <DialogDescription>
          {mode === "folder"
            ? `${canBrowse ? "Choose" : "Type the full path of"} the folder that holds the dataset's raw CSV.gz files as downloaded. Lincei prepares them for queries and leaves the folder as it is.`
            : `Lincei downloads ${size}, then prepares the dataset for queries. This keeps running when you close this window, and files already downloaded are kept if it stops.`}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {signIn ? (
            <>
              <PhysioNetAccessChecklist name={name} pageUrl={dataset.pageUrl} />
              {mayType ? null : (
                <Alert variant="warning">
                  <AlertDescription>
                    {connected
                      ? `The connection to ${computer} is not encrypted, so Lincei will not send your password over it. Open Lincei on ${computer} itself, or connect to it over HTTPS.`
                      : `Lincei is reconnecting to ${computer}. You can sign in once it is connected again.`}
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={usernameId}>PhysioNet username</Label>
                <Input
                  id={usernameId}
                  autoFocus={username.length === 0}
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  disabled={!mayType}
                  readOnly={busy}
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setProblem(null);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={passwordId}>Password</Label>
                <Input
                  id={passwordId}
                  type="password"
                  autoFocus={username.length > 0}
                  autoComplete="off"
                  disabled={!mayType}
                  readOnly={busy}
                  aria-describedby={problem === null ? undefined : problemId}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setProblem(null);
                  }}
                />
                {problemNote}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Lincei uses the password for this download only and does not save it.
                </p>
              </div>
            </>
          ) : null}
          {mode === "folder" ? (
            <FolderField
              value={source}
              onChange={(folder) => {
                setSource(folder);
                setProblem(null);
              }}
              canBrowse={canBrowse}
              serverName={serverName}
              busy={busy}
              placeholder={`/Users/you/Downloads/${dataset.name}`}
              problem={problem}
              autoFocus
            />
          ) : null}
          {/* An open download has no fields of its own, so a refusal shows here. */}
          {mode === "download" && !signIn ? problemNote : null}
          {dataset.requiresCredentials ? (
            <div className="grid gap-2.5">
              <ProviderDataNotice />
              <ProviderDataAcknowledgement
                checked={acknowledged}
                onCheckedChange={setAcknowledged}
              />
            </div>
          ) : null}
          {dataset.downloadable ? (
            mode === "download" ? (
              <SwitchMode disabled={busy} onClick={() => switchTo("folder")}>
                Already downloaded the files? Choose their folder instead.
              </SwitchMode>
            ) : (
              <SwitchMode disabled={busy} onClick={() => switchTo("download")}>
                Let Lincei download the files instead.
              </SwitchMode>
            )
          ) : null}
          {/* Lets Return in a field submit. */}
          <button type="submit" hidden />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready} onClick={() => void submit()}>
          {mode === "folder"
            ? busy
              ? "Checking the folder…"
              : "Add dataset"
            : busy
              ? "Starting…"
              : "Download"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Adds one dataset: Lincei downloads it, or prepares raw files already in a
 * folder on the server's computer. A PhysioNet password is typed here and
 * nowhere else: never in a conversation, where an agent and its model
 * provider would read it. The dialog stays open until the server has taken
 * the request on, so a refusal is shown beside the form.
 */
export function AddDatasetDialog({
  request,
  ...form
}: AddDatasetProps & { readonly request: AddDatasetRequest | null }) {
  const shown = useLastPresent(request);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={request !== null}
      // Closing mid-request would drop the server's answer with nowhere to show it.
      onOpenChange={(open) => (open || busy ? undefined : form.onClose())}
    >
      <DialogPopup className="max-w-md">
        {shown === null ? null : (
          // Keyed so a login or path typed for one dataset is gone when another is opened.
          <AddDatasetForm
            key={shown.dataset.name}
            dataset={shown.dataset}
            initialMode={shown.mode}
            busy={busy}
            setBusy={setBusy}
            {...form}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
