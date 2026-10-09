import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import { CheckIcon, CircleIcon, XIcon } from "lucide-react";

import { ExpandableText } from "~/components/settings/ExpandableText";
import { Spinner } from "~/components/ui/spinner";

import {
  CLINICAL_SETUP_STEPS,
  clinicalStepStates,
  type ClinicalStepState,
} from "./clinicalPresentation";

function StepMarker({ state }: { readonly state: ClinicalStepState }) {
  switch (state) {
    case "done":
      return <CheckIcon aria-label="Done" className="size-3.5 text-success-foreground" />;
    case "active":
      return <Spinner aria-label="In progress" size="sm" />;
    case "failed":
      return <XIcon aria-label="Failed" className="size-3.5 text-destructive" />;
    case "pending":
      return <CircleIcon aria-label="Not started" className="size-2 text-muted-foreground/50" />;
  }
}

/**
 * The steps of setting up the clinical environment and where each stands,
 * with what went wrong under the list when setup stopped.
 */
export function ClinicalSetupProgress({ status }: { readonly status: ClinicalRuntimeStatus }) {
  const states = clinicalStepStates(status);
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5" aria-label="Clinical setup steps">
        {CLINICAL_SETUP_STEPS.map(({ step, label }, index) => {
          const state = states[index]?.state ?? "pending";
          return (
            <li key={step} className="flex items-center gap-2 text-sm">
              <span className="grid size-4 shrink-0 place-items-center">
                <StepMarker state={state} />
              </span>
              <span className={state === "pending" ? "text-muted-foreground" : "text-foreground"}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {status.state === "failed" && status.detail !== undefined ? (
        <ExpandableText
          text={status.detail}
          className="font-mono text-xs text-muted-foreground"
          expandLabel="Show the full output"
        />
      ) : null}
    </div>
  );
}
