import { useAtomValue } from "@effect/atom-react";
import type {
  ClinicalImageRequest,
  EnvironmentId,
  PhysioNetCredentials,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { ImageDownIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import type { SessionPhase } from "~/types";

import { connectionProtectsSecrets, withDatasetName } from "./clinicalPresentation";
import {
  describeImageRequestButton,
  imageRequestNews,
  isOpenRequest,
  requestDatasetName,
} from "./imageRequests";
import {
  classifyLinceiFailure,
  describeLinceiFailure,
  type LinceiCommandResult,
  NO_ANSWER,
} from "./linceiAnswers";
import { linceiCommand } from "./linceiRequests";
import { PhysioNetAccessChecklist, PhysioNetLinkedText, physioNetProjectPage } from "./physioNet";
import { readRememberedUsername, rememberUsername } from "./physioNetUsername";
import { ProviderDataAcknowledgement, ProviderDataNotice } from "./ProviderDataNotice";
import { useLastPresent } from "./useLastPresent";

const POLL_INTERVAL_MS = 4_000;

/** Requests whose sign-in this window has already opened by itself, so it does so once. */
const askedRequests = new Set<string>();

/** The thread's requests from an answer, or why there are none. */
function requestsOf(
  result: LinceiCommandResult,
):
  | { readonly ok: true; readonly requests: ReadonlyArray<ClinicalImageRequest> }
  | { readonly ok: false; readonly message: string | null } {
  if (result._tag === "Failure") {
    return { ok: false, message: describeLinceiFailure(classifyLinceiFailure(result.cause)) };
  }
  return result.value._tag === "ClinicalImageRequests"
    ? { ok: true, requests: result.value.requests }
    : { ok: false, message: NO_ANSWER };
}

/**
 * Agents' requests for a cohort's images in this thread (the MCP tool
 * `lincei_clinical_fetch_images`). While one waits for the researcher's
 * PhysioNet login, the header shows a button and the sign-in opens by itself
 * once; while one fetches, the button shows how far it got; when one ends,
 * a toast says how. The login is typed only here and goes with one request.
 *
 * The thread is asked every few seconds while an agent works, which is when
 * requests are made, and while a request is open. Renders nothing otherwise,
 * and against a server that is not Lincei.
 */
export function ImageRequestPrompt({
  threadRef,
  phase,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly phase: SessionPhase;
}) {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const canOperate = useAtomValue(linceiCommand.permissionAtom(environmentId));
  const request = useAtomCommand(linceiCommand, { reportFailure: false });
  const [requests, setRequests] = useState<ReadonlyArray<ClinicalImageRequest>>([]);
  const [signingIn, setSigningIn] = useState<ClinicalImageRequest | null>(null);
  const previous = useRef<ReadonlyArray<ClinicalImageRequest>>([]);

  const show = (next: ReadonlyArray<ClinicalImageRequest>) => {
    const news = imageRequestNews(previous.current, next);
    previous.current = next;
    setRequests(next);
    const ask = news.newlyWaiting.find((waiting) => !askedRequests.has(waiting.id));
    if (ask !== undefined) {
      askedRequests.add(ask.id);
      setSigningIn((open) => open ?? ask);
    }
    for (const finished of news.finished) announce(finished);
  };

  const announce = (finished: ClinicalImageRequest) => {
    if (finished.state === "declined") return;
    const description = withDatasetName(finished.message, {
      name: finished.dataset,
      ...(finished.datasetTitle === undefined ? {} : { title: finished.datasetTitle }),
    });
    if (finished.state === "done") {
      toastManager.add({ type: "success", title: "Images fetched", description });
      return;
    }
    const id = toastManager.add({
      type: "error",
      title: "Fetching images stopped",
      description,
      actionProps: {
        children: "Sign in again",
        onClick: () => {
          toastManager.close(id);
          setSigningIn(finished);
        },
      },
    });
  };

  const onLook = useEffectEvent(show);

  const polling =
    canOperate &&
    environmentId !== null &&
    threadId !== null &&
    (phase === "running" || requests.some(isOpenRequest));

  useEffect(() => {
    if (!polling || environmentId === null || threadId === null) return;
    let stopped = false;
    const look = async () => {
      const answer = requestsOf(
        await request({ environmentId, input: { _tag: "ClinicalImageRequests", threadId } }),
      );
      if (!stopped && answer.ok) onLook(answer.requests);
    };
    void look();
    const timer = setInterval(() => void look(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [polling, environmentId, threadId, request]);

  const button = describeImageRequestButton(requests);
  if (environmentId === null || (button === null && signingIn === null)) return null;

  return (
    <>
      {button === null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={<span className="relative mr-1 flex shrink-0 [-webkit-app-region:no-drag]" />}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={button.label}
              onClick={() => setSigningIn(button.request)}
            >
              <ImageDownIcon />
            </Button>
            {button.waiting ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-warning"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{button.label}</TooltipPopup>
        </Tooltip>
      )}
      <ImageRequestDialog
        environmentId={environmentId}
        // The dialog shows the request as it now stands.
        request={
          signingIn === null
            ? null
            : (requests.find((candidate) => candidate.id === signingIn.id) ?? signingIn)
        }
        onClose={() => setSigningIn(null)}
        onAnswer={async (id, credentials) => {
          const answer = requestsOf(
            await request({
              environmentId,
              input: { _tag: "ClinicalImageRequestAnswer", id, credentials },
            }),
          );
          if (answer.ok) show(answer.requests);
          return answer.ok ? null : (answer.message ?? NO_ANSWER);
        }}
        onDecline={async (id) => {
          const answer = requestsOf(
            await request({ environmentId, input: { _tag: "ClinicalImageRequestDecline", id } }),
          );
          if (answer.ok) show(answer.requests);
          return answer.ok ? null : (answer.message ?? NO_ANSWER);
        }}
      />
    </>
  );
}

interface DialogActions {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  /** Resolves with why the server refused, or null when it took the login on. */
  readonly onAnswer: (id: string, credentials: PhysioNetCredentials) => Promise<string | null>;
  readonly onDecline: (id: string) => Promise<string | null>;
}

/**
 * Signing in for one image request, or watching it fetch. Like the dataset
 * dialog, it stays open until the server has taken the login on, so a refusal
 * shows beside the form, and it never sends a password over a connection that
 * would expose it.
 */
function ImageRequestDialog({
  request,
  ...actions
}: DialogActions & { readonly request: ClinicalImageRequest | null }) {
  const shown = useLastPresent(request);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => (open || busy ? undefined : actions.onClose())}
    >
      <DialogPopup className="max-w-md">
        {shown === null ? null : shown.state === "waiting-for-login" || shown.state === "failed" ? (
          // Keyed so a password typed for one request is gone when another opens.
          <SignInForm key={shown.id} request={shown} busy={busy} setBusy={setBusy} {...actions} />
        ) : (
          <RequestState request={shown} onClose={actions.onClose} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function SignInForm({
  request,
  environmentId,
  onClose,
  onAnswer,
  onDecline,
  busy,
  setBusy,
}: DialogActions & {
  readonly request: ClinicalImageRequest;
  readonly busy: boolean;
  readonly setBusy: (busy: boolean) => void;
}) {
  const usernameId = useId();
  const passwordId = useId();
  const problemId = useId();
  const [username, setUsername] = useState(readRememberedUsername);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const baseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const computer = useEnvironment(environmentId)?.label ?? "that computer";
  const connected = baseUrl !== null;
  const mayType = connected && connectionProtectsSecrets(baseUrl);
  const name = requestDatasetName(request);
  const ready =
    !busy && acknowledged && mayType && username.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (!ready) return;
    rememberUsername(username.trim());
    setBusy(true);
    const refused = await onAnswer(request.id, {
      username: username.trim(),
      password: Redacted.make(password),
    });
    setBusy(false);
    if (refused === null) {
      setPassword("");
      return;
    }
    setProblem(refused);
  };

  const decline = async () => {
    setBusy(true);
    const refused = await onDecline(request.id);
    setBusy(false);
    if (refused === null) onClose();
    else setProblem(refused);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fetch images for this conversation</DialogTitle>
        <DialogDescription>
          An agent here needs {request.images} images from {name}. Lincei downloads them from
          PhysioNet with your login, which it uses for this download only and does not save.
          Hundreds of images can take a few hours; this keeps running when you close this window.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {request.state === "failed" ? (
            <Alert variant="error">
              <AlertDescription>
                <PhysioNetLinkedText text={request.message} />
              </AlertDescription>
            </Alert>
          ) : null}
          <PhysioNetAccessChecklist
            name={name}
            agreementUrl={physioNetProjectPage({
              name: request.dataset,
              ...(request.agreementUrl === undefined ? {} : { agreementUrl: request.agreementUrl }),
            })}
          />
          {mayType ? null : (
            <Alert variant="warning">
              <AlertDescription>
                {connected
                  ? `The connection to ${computer} is not encrypted, so Lincei will not send your password over it. Open Lincei on ${computer} itself, or connect to it over HTTPS.`
                  : `Lincei is reconnecting to ${computer}. You can sign in once it is connected again.`}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={usernameId}>PhysioNet username</Label>
            <Input
              id={usernameId}
              autoFocus={username.length === 0}
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              disabled={!mayType}
              readOnly={busy}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setProblem(null);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              id={passwordId}
              type="password"
              autoFocus={username.length > 0}
              autoComplete="off"
              disabled={!mayType}
              readOnly={busy}
              aria-describedby={problem === null ? undefined : problemId}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setProblem(null);
              }}
            />
            {problem === null ? null : (
              <p id={problemId} role="alert" className="text-xs leading-relaxed text-destructive">
                {problem}
              </p>
            )}
          </div>
          <div className="grid gap-2.5">
            <ProviderDataNotice subject="this dataset" />
            <ProviderDataAcknowledgement checked={acknowledged} onCheckedChange={setAcknowledged} />
          </div>
          {/* Lets Return in a field submit. */}
          <button type="submit" hidden />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="ghost" disabled={busy} onClick={() => void decline()}>
          Decline
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Not now
        </Button>
        <Button disabled={!ready} onClick={() => void submit()}>
          {busy ? "Starting…" : "Fetch images"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A request that is fetching or has ended, as the dialog shows it after signing in. */
function RequestState({
  request,
  onClose,
}: {
  readonly request: ClinicalImageRequest;
  readonly onClose: () => void;
}) {
  const total = request.total ?? request.images;
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {request.state === "fetching" ? "Fetching images" : "Images for this conversation"}
        </DialogTitle>
        <DialogDescription>
          {request.state === "fetching"
            ? `${request.completed} of ${total} images from ${requestDatasetName(request)}. This keeps running when you close this window.`
            : withDatasetName(request.message, {
                name: request.dataset,
                ...(request.datasetTitle === undefined ? {} : { title: request.datasetTitle }),
              })}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter variant="bare">
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}
