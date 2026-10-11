import type { ClinicalDataset, EnvironmentId, PhysioNetCredentials } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { useState } from "react";

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
import { useEnvironmentHttpBaseUrl } from "~/state/environments";

import { connectionProtectsSecrets } from "./clinicalPresentation";

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

function LoginForm({
  dataset,
  environmentId,
  onDownload,
  onClose,
}: {
  readonly dataset: ClinicalDataset;
  readonly environmentId: EnvironmentId;
  readonly onDownload: (name: string, credentials: PhysioNetCredentials) => void;
  readonly onClose: () => void;
}) {
  const [username, setUsername] = useState(readRememberedUsername);
  // The password lives in this field and the one request that carries it.
  const [password, setPassword] = useState("");
  const protectedConnection = connectionProtectsSecrets(useEnvironmentHttpBaseUrl(environmentId));
  const ready = protectedConnection && username.trim().length > 0 && password.length > 0;

  const submit = () => {
    if (!ready) return;
    rememberUsername(username.trim());
    onDownload(dataset.name, { username: username.trim(), password: Redacted.make(password) });
    setPassword("");
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Download {dataset.name}</DialogTitle>
        <DialogDescription>
          Sign in with your PhysioNet account. It needs access to {dataset.name}: the required
          training and a signed data use agreement on physionet.org.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {protectedConnection ? null : (
            <Alert variant="warning">
              <AlertDescription>
                The connection to this computer is not encrypted, so Lincei will not send a password
                over it. Open Lincei on that computer, or connect to it over HTTPS.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="physionet-username">PhysioNet username</Label>
            <Input
              id="physionet-username"
              autoFocus={username.length === 0}
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              disabled={!protectedConnection}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="physionet-password">Password</Label>
            <Input
              id="physionet-password"
              type="password"
              autoFocus={username.length > 0}
              autoComplete="off"
              disabled={!protectedConnection}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Lincei uses the password for this download only and does not save it, so it asks again
            next time. Files already downloaded are kept if the download stops.
          </p>
          {/* Lets Return in a field start the download. */}
          <button type="submit" hidden />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready} onClick={submit}>
          Download
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Asks for the PhysioNet login a credentialed dataset's download needs. The
 * password is typed here and nowhere else: never in a conversation, where an
 * agent and its model provider would read it.
 */
export function PhysioNetDownloadDialog({
  dataset,
  environmentId,
  onDownload,
  onClose,
}: {
  readonly dataset: ClinicalDataset | null;
  readonly environmentId: EnvironmentId;
  readonly onDownload: (name: string, credentials: PhysioNetCredentials) => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={dataset !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        {dataset === null ? null : (
          // Keyed so a login typed for one dataset is gone when another is opened.
          <LoginForm
            key={dataset.name}
            dataset={dataset}
            environmentId={environmentId}
            onDownload={onDownload}
            onClose={onClose}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
