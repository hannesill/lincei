import { useId, useState } from "react";

import { InlineButton } from "~/components/ui/button";

/**
 * What a tool printed when something failed, closed until asked for. The
 * sentence beside it says what happened in words; this is for whoever is
 * asked to help. Long tokens such as download URLs wrap instead of widening
 * the layout around them.
 */
export function TechnicalDetails({
  label,
  text,
}: {
  /** What opening it shows, such as "Show what M4 reported". */
  readonly label: string;
  readonly text: string;
}) {
  const outputId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 text-xs">
      <InlineButton
        tone="muted"
        aria-expanded={open}
        aria-controls={outputId}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? "Hide the details" : label}
      </InlineButton>
      <pre
        id={outputId}
        hidden={!open}
        className="mt-1 max-h-48 overflow-y-auto font-mono text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground"
      >
        {text}
      </pre>
    </div>
  );
}
