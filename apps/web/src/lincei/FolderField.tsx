import type { ReactNode } from "react";
import { useId } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { readLocalApi } from "~/localApi";

/**
 * A folder on the server's computer, typed or, where that is this computer
 * and the desktop app, chosen with its folder picker. `problem` is shown under
 * the field as what is wrong with the folder.
 */
export function FolderField({
  value,
  onChange,
  canBrowse,
  serverName,
  busy,
  placeholder,
  problem,
  autoFocus = false,
}: {
  readonly value: string;
  readonly onChange: (folder: string) => void;
  /** The folder is on this computer, so its own folder picker can choose it. */
  readonly canBrowse: boolean;
  /** The name of the computer the folder has to be on, when it may not be this one. */
  readonly serverName: string | null;
  readonly busy: boolean;
  readonly placeholder: string;
  readonly problem: ReactNode;
  readonly autoFocus?: boolean;
}) {
  const fieldId = useId();
  const problemId = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={fieldId}>Folder</Label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={fieldId}
            autoFocus={autoFocus}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={placeholder}
            aria-invalid={problem === null ? undefined : true}
            aria-describedby={problem === null ? undefined : problemId}
            readOnly={busy}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        {canBrowse ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void readLocalApi()
                ?.dialogs.pickFolder()
                .then((picked) => {
                  if (picked) onChange(picked);
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
      {canBrowse ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The folder has to be on {serverName ?? "the computer Lincei runs on"}
          {serverName === null ? "" : ", the computer Lincei runs on"}. That may not be the computer
          in front of you.
        </p>
      )}
    </div>
  );
}
