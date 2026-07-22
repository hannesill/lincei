import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function PreviewChromeRow(props: {
  url: string;
  loading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onSubmit: (url: string) => void;
  onOpenInBrowser?: (() => void) | undefined;
  trailingActions?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(props.url);
  useEffect(() => {
    setDraft((previous) => (document.activeElement === inputRef.current ? previous : props.url));
  }, [props.url]);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length > 0) props.onSubmit(next);
  };

  return (
    <div className="relative shrink-0">
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-b border-border bg-background px-2 py-1.5"
      >
        <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={props.onBack}
                  disabled={!props.canGoBack}
                  aria-label="Back"
                  type="button"
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipPopup>Back</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={props.onForward}
                  disabled={!props.canGoForward}
                  aria-label="Forward"
                  type="button"
                />
              }
            >
              <ArrowRight />
            </TooltipTrigger>
            <TooltipPopup>Forward</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={props.onRefresh}
                  disabled={props.refreshDisabled}
                  aria-label="Refresh"
                  type="button"
                />
              }
            >
              <RotateCw className={cn(props.loading && "animate-spin")} />
            </TooltipTrigger>
            <TooltipPopup>{props.loading ? "Loading…" : "Refresh"}</TooltipPopup>
          </Tooltip>
        </div>
        <div className="relative flex-1">
          <Globe
            className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            className="h-7 pl-7 text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit(event);
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(props.url);
                inputRef.current?.blur();
              }
            }}
            placeholder="Search or enter URL"
            spellCheck={false}
            data-preview-url-input
          />
        </div>
        {props.onOpenInBrowser ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={props.onOpenInBrowser}
                  aria-label="Open in system browser"
                  type="button"
                />
              }
            >
              <ExternalLink />
            </TooltipTrigger>
            <TooltipPopup>Open in system browser</TooltipPopup>
          </Tooltip>
        ) : null}
        {props.trailingActions}
      </form>
      {props.loadProgress > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 rounded-r-full bg-primary transition-all duration-150"
          style={{ width: `${props.loadProgress}%` }}
        />
      ) : null}
    </div>
  );
}
