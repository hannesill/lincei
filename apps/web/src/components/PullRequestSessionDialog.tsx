import type { EnvironmentId, GitResolvePullRequestResult, SessionId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  gitPreparePullRequestSessionMutationOptions,
  gitResolvePullRequestQueryOptions,
} from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { cn } from "~/lib/utils";
import { parsePullRequestReference } from "~/pullRequestReference";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

interface PullRequestSessionDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  sessionId: SessionId;
  cwd: string | null;
  initialReference: string | null;
  onOpenChange: (open: boolean) => void;
  onPrepared: (input: { branch: string; worktreePath: string | null }) => Promise<void> | void;
}

export function PullRequestSessionDialog({
  open,
  environmentId,
  sessionId,
  cwd,
  initialReference,
  onOpenChange,
  onPrepared,
}: PullRequestSessionDialogProps) {
  const queryClient = useQueryClient();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState(initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [preparingMode, setPreparingMode] = useState<"local" | "worktree" | null>(null);
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const { data: gitStatus = null } = useGitStatus({ environmentId, cwd });
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(gitStatus?.sourceControlProvider),
    [gitStatus?.sourceControlProvider],
  );
  const terminology = sourceControlPresentation.terminology;
  const SourceControlIcon = sourceControlPresentation.Icon;

  useEffect(() => {
    if (!open) return;
    setReference(initialReference ?? "");
    setReferenceDirty(false);
    setPreparingMode(null);
  }, [initialReference, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus();
      referenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const resolvePullRequestQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      environmentId,
      cwd,
      reference: open ? parsedDebouncedReference : null,
    }),
  );
  const cachedPullRequest = useMemo(() => {
    if (!cwd || !parsedReference) {
      return null;
    }
    const cached = queryClient.getQueryData<GitResolvePullRequestResult>([
      "git",
      "pull-request",
      environmentId,
      cwd,
      parsedReference,
    ]);
    return cached?.pullRequest ?? null;
  }, [cwd, environmentId, parsedReference, queryClient]);
  const preparePullRequestSessionMutation = useMutation(
    gitPreparePullRequestSessionMutationOptions({ environmentId, cwd, queryClient }),
  );

  const liveResolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (resolvePullRequestQuery.data?.pullRequest ?? null)
      : null;
  const resolvedPullRequest = liveResolvedPullRequest ?? cachedPullRequest;
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      resolvePullRequestQuery.isPending ||
      resolvePullRequestQuery.isFetching);
  const statusTone = useMemo(() => {
    switch (resolvedPullRequest?.state) {
      case "merged":
        return "text-violet-600 dark:text-violet-300/90";
      case "closed":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "open":
        return "text-zinc-600 dark:text-zinc-300/90";
      default:
        return "text-muted-foreground";
    }
  }, [resolvedPullRequest?.state]);

  const handleConfirm = useCallback(
    async (mode: "local" | "worktree") => {
      if (!parsedReference) {
        setReferenceDirty(true);
        return;
      }
      if (!parsedReference || !resolvedPullRequest || !cwd) {
        return;
      }
      setPreparingMode(mode);
      try {
        const result = await preparePullRequestSessionMutation.mutateAsync({
          reference: parsedReference,
          mode,
          ...(mode === "worktree" ? { sessionId } : {}),
        });
        await onPrepared({
          branch: result.branch,
          worktreePath: result.worktreePath,
        });
        onOpenChange(false);
      } finally {
        setPreparingMode(null);
      }
    },
    [
      cwd,
      onOpenChange,
      onPrepared,
      parsedReference,
      preparePullRequestSessionMutation,
      resolvedPullRequest,
      sessionId,
    ],
  );

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? `Paste a ${terminology.singular} URL, checkout command, or enter 123 / #123.`
      : parsedReference === null
        ? `Use a ${terminology.singular} URL, checkout command, 123, or #123.`
        : null;
  const errorMessage =
    validationMessage ??
    (resolvedPullRequest === null && resolvePullRequestQuery.isError
      ? resolvePullRequestQuery.error instanceof Error
        ? resolvePullRequestQuery.error.message
        : `Failed to resolve ${terminology.singular}.`
      : preparePullRequestSessionMutation.error instanceof Error
        ? preparePullRequestSessionMutation.error.message
        : preparePullRequestSessionMutation.error
          ? `Failed to prepare ${terminology.singular} session.`
          : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!preparePullRequestSessionMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SourceControlIcon className="size-4" />
            Checkout {terminology.singular}
          </DialogTitle>
          <DialogDescription>
            Resolve a {sourceControlPresentation.providerName} {terminology.singular}, then create
            the draft session in the main repo or in a dedicated worktree.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground capitalize">
              {terminology.singular}
            </span>
            <Input
              ref={referenceInputRef}
              placeholder={`${terminology.shortLabel} URL, checkout command, or #42`}
              value={reference}
              onChange={(event) => {
                setReferenceDirty(true);
                setReference(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (!isResolving && !preparePullRequestSessionMutation.isPending) {
                  void handleConfirm("local");
                }
              }}
            />
          </label>

          {resolvedPullRequest ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{resolvedPullRequest.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    #{resolvedPullRequest.number} · {resolvedPullRequest.headBranch} to{" "}
                    {resolvedPullRequest.baseBranch}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs capitalize", statusTone)}>
                  {resolvedPullRequest.state}
                </span>
              </div>
            </div>
          ) : null}

          {isResolving ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Resolving {terminology.singular}...
            </div>
          ) : null}

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={preparePullRequestSessionMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void handleConfirm("local");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestSessionMutation.isPending
            }
          >
            {preparingMode === "local" ? "Preparing local..." : "Local"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm("worktree");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestSessionMutation.isPending
            }
          >
            {preparingMode === "worktree" ? "Preparing worktree..." : "Worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
