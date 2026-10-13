import type { ClinicalRuntimeStatus } from "@t3tools/contracts";
import { CheckIcon, CircleIcon, XIcon } from "lucide-react";

import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

import {
  CLINICAL_SETUP_STEPS,
  clinicalStepStates,
  type ClinicalStepState,
} from "./clinicalPresentation";
import { TechnicalDetails } from "./TechnicalDetails";

const STEP_STATE_NAMES: Record<ClinicalStepState, string> = {
  done: "Done",
  active: "In progress",
  failed: "Failed",
  pending: "Not started",
};

/** A step's state as a mark. The words for it are read out beside the step's name. */
function StepMarker({ state }: { readonly state: ClinicalStepState }) {
  switch (state) {
    case "done":
      return <CheckIcon aria-hidden className="size-3.5 text-success-foreground" />;
    case "active":
      return <Spinner aria-hidden size="sm" />;
    case "failed":
      return <XIcon aria-hidden className="size-3.5 text-destructive" />;
    case "pending":
      return <CircleIcon aria-hidden className="size-2 text-muted-foreground/50" />;
  }
}

/**
 * The steps of setting up the clinical research tools and where each stands,
 * with what the installer printed, on request, when setup stopped.
 */
export function ClinicalSetupProgress({
  status,
  className,
}: {
  readonly status: ClinicalRuntimeStatus;
  /** Layout only: how the list sits beside what stands next to it. */
  readonly className?: string;
}) {
  const states = clinicalStepStates(status);
  return (
    <div className={cn("min-w-0 space-y-2", className)}>
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
                <span className="sr-only">: {STEP_STATE_NAMES[state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {/* Setup that failed has it, and so do tools that work but could not be updated. */}
      {status.state !== "installing" && status.detail !== undefined ? (
        <TechnicalDetails label="Show what the installer reported" text={status.detail} />
      ) : null}
    </div>
  );
}
