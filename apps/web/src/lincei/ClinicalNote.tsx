import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

import { type ClinicalStatusView, describeUnknownStatus } from "./linceiAnswers";
import { TechnicalDetails } from "./TechnicalDetails";

/**
 * A sentence where content would be, with a way to ask the server again when
 * asking again can help, and the technical side of a failure for whoever is
 * asked about it. Padding is the parent's: a settings card and the wizard set
 * it differently.
 */
export function ClinicalNote({
  children,
  detail,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly detail?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 grow basis-64 space-y-1 text-xs">
        <p className="leading-relaxed text-muted-foreground">{children}</p>
        {detail ? <TechnicalDetails label="Show details" text={detail} /> : null}
      </div>
      {onRetry === undefined ? null : (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * What stands in for the clinical research tools' status while there is none:
 * it is being asked for, the request failed or was refused, or the server is
 * not Lincei. Only a failed request is worth repeating.
 */
export function ClinicalStatusNote({
  view,
  onRetry,
}: {
  readonly view: Exclude<ClinicalStatusView, { readonly phase: "known" }>;
  readonly onRetry: () => void;
}) {
  return (
    <ClinicalNote
      detail={view.phase === "failed" ? view.detail : null}
      onRetry={view.phase === "failed" ? onRetry : undefined}
    >
      {describeUnknownStatus(view)}
    </ClinicalNote>
  );
}
