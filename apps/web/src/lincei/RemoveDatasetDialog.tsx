import type { ClinicalDataset } from "@t3tools/contracts";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

import { describeRemoval } from "./clinicalPresentation";
import { useLastPresent } from "./useLastPresent";

/** Asks before a dataset's files are deleted, saying what goes and what stays. */
export function RemoveDatasetDialog({
  dataset,
  place,
  onRemove,
  onClose,
}: {
  readonly dataset: ClinicalDataset | null;
  /** Where the datasets are kept, in the reader's words. */
  readonly place: string;
  readonly onRemove: (dataset: ClinicalDataset) => void;
  readonly onClose: () => void;
}) {
  const shown = useLastPresent(dataset);
  const removal = shown === null ? null : describeRemoval(shown, place);
  return (
    <AlertDialog open={dataset !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogPopup>
        {shown === null || removal === null ? null : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{removal.title}</AlertDialogTitle>
              <AlertDialogDescription>{removal.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  onRemove(shown);
                  onClose();
                }}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogPopup>
    </AlertDialog>
  );
}
