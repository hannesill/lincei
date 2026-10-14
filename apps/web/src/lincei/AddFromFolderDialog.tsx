import type { ClinicalDataset } from "@t3tools/contracts";
import { useId, useState } from "react";

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
import { readLocalApi } from "~/localApi";

import { datasetDisplayName, folderPathProblem, withDatasetName } from "./clinicalPresentation";
import { type DatasetActionOutcome, NO_ANSWER } from "./linceiAnswers";
import { ProviderDataAcknowledgement, ProviderDataNotice } from "./ProviderDataNotice";
import { useLastPresent } from "./useLastPresent";

interface AddFromFolderProps {
  /** The folder is on this computer, so its own folder picker can choose it. */
  readonly canBrowse: boolean;
  /** The name of the computer the folder has to be on, when it may not be this one. */
  readonly serverName: string | null;
  /** The folder last given for this dataset, to start from when that attempt failed. */
  readonly lastFolder: string;
  /** Asks the server to prepare the dataset from the folder, and answers whether it took that on. */
  readonly onAdd: (name: string, source: string) => Promise<DatasetActionOutcome>;
  readonly onClose: () => void;
}

function AddFromFolderForm({
  dataset,
  canBrowse,
  serverName,
  lastFolder,
  onAdd,
  onClose,
  checking,
  setChecking,
}: AddFromFolderProps & {
  readonly dataset: ClinicalDataset;
  /** The server is looking at the folder. Held by the dialog, which stays open meanwhile. */
  readonly checking: boolean;
  readonly setChecking: (checking: boolean) => void;
}) {
  const fieldId = useId();
  const problemId = useId();
  const [source, setSource] = useState(lastFolder);
  const [problem, setProblem] = useState<string | null>(null);
  // Only credentialed data comes with PhysioNet's rules for AI services.
  const [acknowledged, setAcknowledged] = useState(!dataset.requiresCredentials);
  const name = datasetDisplayName(dataset.name);
  const folder = source.trim();
  const ready = !checking && acknowledged && folder.length > 0;

  const submit = async () => {
    if (!ready) return;
    const unusable = folderPathProblem(folder);
    if (unusable !== null) {
      setProblem(unusable);
      return;
    }
    setChecking(true);
    const outcome = await onAdd(dataset.name, folder);
    setChecking(false);
    if (outcome.accepted) {
      onClose();
      return;
    }
    setProblem(withDatasetName(outcome.message ?? NO_ANSWER, dataset.name));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add {name} from a folder</DialogTitle>
        <DialogDescription>
          {canBrowse ? "Choose" : "Type the full path of"} the folder that holds the dataset&apos;s
          raw CSV.gz files as downloaded from PhysioNet. Lincei prepares them for queries and leaves
          the folder as it is.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>Folder</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id={fieldId}
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="/Users/you/Downloads/mimic-iv"
                  aria-invalid={problem !== null || undefined}
                  aria-describedby={problem === null ? undefined : problemId}
                  readOnly={checking}
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setProblem(null);
                  }}
                />
              </div>
              {canBrowse ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={checking}
                  onClick={() =>
                    void readLocalApi()
                      ?.dialogs.pickFolder()
                      .then((picked) => {
                        if (!picked) return;
                        setSource(picked);
                        setProblem(null);
                      })
                      .catch(() => undefined)
                  }
                >
                  Choose…
                </Button>
              ) : null}
            </div>
            {problem === null ? null : (
              <p id={problemId} role="alert" className="text-xs leading-relaxed text-destructive">
                {problem}
              </p>
            )}
          </div>
          {canBrowse ? null : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              The folder has to be on {serverName ?? "the computer Lincei runs on"}
              {serverName === null ? "" : ", the computer Lincei runs on"}. That may not be the
              computer in front of you.
            </p>
          )}
          {dataset.requiresCredentials ? (
            <div className="grid gap-2.5">
              <ProviderDataNotice />
              <ProviderDataAcknowledgement
                checked={acknowledged}
                onCheckedChange={setAcknowledged}
              />
            </div>
          ) : null}
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" disabled={checking} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready} onClick={() => void submit()}>
          {checking ? "Checking the folder…" : "Add dataset"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Asks for the folder that holds a dataset's raw files, on the server's
 * computer, and hands it to the server. The server checks the folder before
 * it starts, and the dialog stays open until it has said yes: a folder it
 * turns down is reported under the field, with the path still in it.
 */
export function AddFromFolderDialog({
  dataset,
  ...form
}: AddFromFolderProps & { readonly dataset: ClinicalDataset | null }) {
  const shown = useLastPresent(dataset);
  const [checking, setChecking] = useState(false);
  return (
    <Dialog
      open={dataset !== null}
      // Closing mid-check would drop the server's answer with nowhere to show it.
      onOpenChange={(open) => (open || checking ? undefined : form.onClose())}
    >
      <DialogPopup className="max-w-md">
        {shown === null ? null : (
          // Keyed so a path typed for one dataset is not offered for another.
          <AddFromFolderForm
            key={shown.name}
            dataset={shown}
            checking={checking}
            setChecking={setChecking}
            {...form}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
