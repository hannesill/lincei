import { useState } from "react";

import { Button } from "~/components/ui/button";

import { describePreviewError } from "./errorCodeMessages";

export function PreviewUnreachable(props: {
  url: string;
  code: number;
  description: string;
  onReload: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const host = safeHost(props.url) ?? props.url;
  const friendly = describePreviewError(props.code, props.description);
  const errorLabel =
    props.description.length > 0 ? props.description : `ERR_${Math.abs(props.code) || "FAILED"}`;
  return (
    <div className="relative flex h-full min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 py-12 sm:py-16">
        <h1 className="mb-3 text-2xl font-semibold leading-tight text-foreground">
          This site can&rsquo;t be reached
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{host}</span>: {friendly}.
        </p>
        {showDetails ? (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            Confirm that the local server is running and listening on the displayed port.
          </div>
        ) : null}
        <div className="mt-8 text-xs uppercase tracking-wide text-muted-foreground/70">
          {errorLabel}
        </div>
        <div className="mt-auto flex items-center gap-2 pt-8">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? "Hide details" : "Details"}
          </Button>
          <div className="flex-1" />
          <Button type="button" size="sm" onClick={props.onReload}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
