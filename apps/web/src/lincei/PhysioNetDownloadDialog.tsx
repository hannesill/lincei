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
  withDatasetName,
} from "./clinicalPresentation";
import { type DatasetActionOutcome, NO_ANSWER } from "./linceiAnswers";
import { PHYSIONET_PAGES, PhysioNetLink, physioNetProjectPage } from "./physioNet";
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

interface PhysioNetDownloadProps {
  readonly environmentId: EnvironmentId;
  /** Asks the server to start the download, and answers whether it took that on. */
  readonly onDownload: (
    name: string,
    credentials: PhysioNetCredentials,
  ) => Promise<DatasetActionOutcome>;
  readonly onClose: () => void;
}

function LoginForm({
  dataset,
  environmentId,
  onDownload,
  onClose,
  starting,
  setStarting,
}: PhysioNetDownloadProps & {
  readonly dataset: ClinicalDataset;
  /** The server is being asked to start. Held by the dialog, which stays open meanwhile. */
  readonly starting: boolean;
  readonly setStarting: (starting: boolean) => void;
}) {
  const usernameId = useId();
  const passwordId = useId();
  const problemId = useId();
  const [username, setUsername] = useState(readRememberedUsername);
  // The password lives in this field and the one request that carries it.
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const baseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const computer = useEnvironment(environmentId)?.label ?? "that computer";
  // No address means Lincei is between connections, which is not the same as
  // an address that would expose the password.
  const connected = baseUrl !== null;
  const mayType = connected && connectionProtectsSecrets(baseUrl);
  const ready =
    mayType && acknowledged && !starting && username.trim().length > 0 && password.length > 0;
  const name = datasetDisplayName(dataset.name);
  const projectPage = physioNetProjectPage(dataset.name);

  const submit = async () => {
    if (!ready) return;
    rememberUsername(username.trim());
    setStarting(true);
    const outcome = await onDownload(dataset.name, {
      username: username.trim(),
      password: Redacted.make(password),
    });
    setStarting(false);
    if (outcome.accepted) {
      setPassword("");
      onClose();
      return;
    }
    setProblem(withDatasetName(outcome.message ?? NO_ANSWER, dataset.name));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Download {name}</DialogTitle>
        <DialogDescription>
          Sign in with your PhysioNet account. It needs access to {name}: credentialing, the{" "}
          <PhysioNetLink href={PHYSIONET_PAGES.training}>required training</PhysioNetLink>, and the
          data use agreement signed on{" "}
          {projectPage === null ? (
            "physionet.org"
          ) : (
            <PhysioNetLink href={projectPage}>the dataset&apos;s page</PhysioNetLink>
          )}
          .
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
              readOnly={starting}
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
              readOnly={starting}
              aria-describedby={problem === null ? undefined : problemId}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setProblem(null);
              }}
            />
            {problem === null ? null : (
              <p id={problemId} role="alert" className="text-xs leading-relaxed text-destructive">
                {problem}
              </p>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Lincei uses the password for this download only and does not save it, so it asks again
            next time. Files already downloaded are kept if the download stops.
          </p>
          <div className="grid gap-2.5">
            <ProviderDataNotice />
            <ProviderDataAcknowledgement checked={acknowledged} onCheckedChange={setAcknowledged} />
          </div>
          {/* Lets Return in a field start the download. */}
          <button type="submit" hidden />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" disabled={starting} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready} onClick={() => void submit()}>
          {starting ? "Starting…" : "Download"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Asks for the PhysioNet login a credentialed dataset's download needs. The
 * password is typed here and nowhere else: never in a conversation, where an
 * agent and its model provider would read it. The dialog stays open until the
 * server has started the download, so a refusal is shown beside the form.
 */
export function PhysioNetDownloadDialog({
  dataset,
  ...form
}: PhysioNetDownloadProps & { readonly dataset: ClinicalDataset | null }) {
  const shown = useLastPresent(dataset);
  const [starting, setStarting] = useState(false);
  return (
    <Dialog
      open={dataset !== null}
      // Closing mid-request would drop the server's answer with nowhere to show it.
      onOpenChange={(open) => (open || starting ? undefined : form.onClose())}
    >
      <DialogPopup className="max-w-md">
        {shown === null ? null : (
          // Keyed so a login typed for one dataset is gone when another is opened.
          <LoginForm
            key={shown.name}
            dataset={shown}
            starting={starting}
            setStarting={setStarting}
            {...form}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
