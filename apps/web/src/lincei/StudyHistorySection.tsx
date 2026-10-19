import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { useProjects } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";

import { useStudyHistory } from "./clinicalState";
import { classifyLinceiFailure, describeLinceiFailure } from "./linceiAnswers";
import { linceiCommand } from "./linceiRequests";
import { CLINICAL_SETTINGS } from "./settingsSearchItems";

/** One project's folder: what Lincei keeps of it, and its switch. */
function StudyHistoryRow({
  environmentId,
  title,
  folder,
}: {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly folder: string;
}) {
  const { view, refresh, accept } = useStudyHistory(environmentId, folder);
  const canOperate = useAtomValue(linceiCommand.permissionAtom(environmentId));
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [changing, setChanging] = useState(false);
  const history = view.phase === "known" ? view.answer : null;

  const change = async (on: boolean) => {
    setChanging(true);
    const result = await request({
      environmentId,
      input: { _tag: "StudyHistoryUpdate", folder, on },
    });
    setChanging(false);
    if (result._tag === "Success" && result.value._tag === "StudyHistory")
      accept(result.value.history);
    const failure =
      result._tag === "Failure" ? describeLinceiFailure(classifyLinceiFailure(result.cause)) : null;
    if (failure !== null) {
      toastManager.add({
        type: "error",
        title: on
          ? `Could not keep a history of ${title}`
          : `Could not stop the history of ${title}`,
        description: failure,
      });
    }
    refresh();
  };

  const leftOut = history?.leftOut ?? [];
  return (
    <SettingsRow
      title={title}
      description={
        history === null
          ? view.phase === "failed"
            ? view.message
            : "Checking this folder's history…"
          : leftOut.length === 0
            ? history.message
            : `${history.message} Kept out for their size: ${leftOut.slice(0, 3).join(", ")}${leftOut.length > 3 ? `, and ${leftOut.length - 3} more` : ""}.`
      }
      control={
        // A repository of the researcher's own keeps its history: nothing to switch.
        history === null || history.state === "own" ? undefined : (
          <Switch
            checked={history.state === "on"}
            disabled={!canOperate || changing || history.state === "unavailable"}
            onCheckedChange={(on) => void change(on)}
            aria-label={`Keep a history of ${title}`}
          />
        )
      }
    >
      <p className="pb-2 font-mono text-xs break-all text-muted-foreground/70">{folder}</p>
    </SettingsRow>
  );
}

/**
 * Settings, Clinical Data: whether Lincei keeps a history of each project's
 * folder on one computer, which is what lets a researcher undo the
 * assistant's changes, with a switch per folder.
 */
export function StudyHistorySection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const projects = useProjects();
  const own = useMemo(
    () =>
      projects
        .filter((project) => project.environmentId === environmentId)
        .toSorted((a, b) => a.title.localeCompare(b.title)),
    [projects, environmentId],
  );
  return (
    <SettingsSection {...CLINICAL_SETTINGS.history}>
      <p className="px-3 pt-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
        A study's history lets you undo the assistant's changes to your scripts, notes, and figures:
        choose "Edit from here" on one of your messages, then "Undo file changes too". That works
        while no other conversation has changed the folder since this one started and none is
        working in it, because undoing would also undo their work. Data files stay out of the
        history, and undo leaves them as they are. Unless Techie mode is on, Lincei starts a project
        folder's history by itself at its next conversation, except where you turned it off here.
      </p>
      {own.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
          Add a project folder, and its history shows here.
        </p>
      ) : (
        own.map((project) => (
          <StudyHistoryRow
            key={project.id}
            environmentId={environmentId}
            title={project.title}
            folder={project.workspaceRoot}
          />
        ))
      )}
    </SettingsSection>
  );
}
