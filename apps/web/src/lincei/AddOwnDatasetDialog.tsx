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

import { datasetIdFromTitle, folderPathProblem } from "./clinicalPresentation";
import { FolderField } from "./FolderField";
import { type DatasetActionOutcome, NO_ANSWER } from "./linceiAnswers";
import { OwnDataNotice, ProviderDataAcknowledgement } from "./ProviderDataNotice";

interface AddOwnDatasetProps {
  /** The folder is on this computer, so its own folder picker can choose it. */
  readonly canBrowse: boolean;
  /** The name of the computer the folder has to be on, when it may not be this one. */
  readonly serverName: string | null;
  /** The ids already taken, which a new dataset cannot have. */
  readonly takenIds: ReadonlySet<string>;
  /** Asks the server to define the dataset and start preparing it, and answers whether it did. */
  readonly onDefine: (input: {
    readonly name: string;
    readonly title: string;
    readonly source: string;
  }) => Promise<DatasetActionOutcome>;
  readonly onClose: () => void;
}

function AddOwnDatasetForm({
  canBrowse,
  serverName,
  takenIds,
  onDefine,
  onClose,
  busy,
  setBusy,
}: AddOwnDatasetProps & {
  /** The server is checking the folder. Held by the dialog, which stays open meanwhile. */
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
}) {
  const titleId = useId();
  const idNoteId = useId();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const id = datasetIdFromTitle(title);
  const folder = source.trim();
  const nameProblem =
    title.trim().length > 0 && id.length === 0
      ? "Use some letters or digits in the name."
      : takenIds.has(id)
        ? `There is already a dataset called "${id}". Choose another name.`
        : null;
  const ready = !busy && acknowledged && id.length > 0 && nameProblem === null && folder.length > 0;

  const submit = async () => {
    if (!ready) return;
    const unusable = folderPathProblem(folder);
    if (unusable !== null) {
      setProblem(unusable);
      return;
    }
    setBusy(true);
    const outcome = await onDefine({ name: id, title: title.trim(), source: folder });
    setBusy(false);
    if (outcome.accepted) {
      onClose();
      return;
    }
    setProblem(outcome.message ?? NO_ANSWER);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add your own dataset</DialogTitle>
        <DialogDescription>
          {canBrowse ? "Choose" : "Type the full path of"} a folder of CSV files (.csv or .csv.gz),
          such as an export from your hospital. Each folder inside it becomes a schema and each file
          a table. Lincei prepares them for queries and leaves the folder as it is.
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
          <div className="grid gap-1.5">
            <Label htmlFor={titleId}>Name</Label>
            <Input
              id={titleId}
              autoFocus
              placeholder="ICU registry 2024"
              aria-invalid={nameProblem === null ? undefined : true}
              aria-describedby={idNoteId}
              readOnly={busy}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setProblem(null);
              }}
            />
            <p
              id={idNoteId}
              className={
                nameProblem === null
                  ? "text-xs leading-relaxed text-muted-foreground"
                  : "text-xs leading-relaxed text-destructive"
              }
            >
              {nameProblem ??
                (id.length === 0 ? (
                  "Agents will call it by a short id made from this name."
                ) : (
                  <>
                    Agents will call it <span className="font-mono">{id}</span>.
                  </>
                ))}
            </p>
          </div>
          <FolderField
            value={source}
            onChange={(next) => {
              setSource(next);
              setProblem(null);
            }}
            canBrowse={canBrowse}
            serverName={serverName}
            busy={busy}
            placeholder="/Users/you/Documents/icu-registry"
            problem={problem}
          />
          <div className="grid gap-2.5">
            <OwnDataNotice />
            <ProviderDataAcknowledgement
              checked={acknowledged}
              onCheckedChange={setAcknowledged}
              label="I have checked that these rules allow it."
            />
          </div>
          {/* Lets Return in a field submit. */}
          <button type="submit" hidden />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!ready} onClick={() => void submit()}>
          {busy ? "Checking the folder…" : "Add dataset"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Adds a dataset of the user's own from a folder of raw files on the server's
 * computer. The server has M4 work out its tables from the folder and refuses
 * one it cannot use before anything starts, so the dialog stays open until it
 * has answered.
 */
export function AddOwnDatasetDialog({
  open,
  ...form
}: AddOwnDatasetProps & { readonly open: boolean }) {
  const [busy, setBusy] = useState(false);
  // Counted up on each opening, so a name or folder typed last time is gone.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }
  return (
    <Dialog
      open={open}
      // Closing mid-request would drop the server's answer with nowhere to show it.
      onOpenChange={(next) => (next || busy ? undefined : form.onClose())}
    >
      <DialogPopup className="max-w-md">
        <AddOwnDatasetForm key={opening} busy={busy} setBusy={setBusy} {...form} />
      </DialogPopup>
    </Dialog>
  );
}
