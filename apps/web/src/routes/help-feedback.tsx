import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  BugIcon,
  ClipboardIcon,
  LifeBuoyIcon,
  MailIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { useCallback } from "react";

import { APP_CONTENT_MAX_WIDTH_CLASS, AppMainSurface, AppTopBar } from "../components/appShell";
import { Button } from "../components/ui/button";
import { stackedSessionToast, toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";

const FEEDBACK_EMAIL = "tics.gaskets.0q@icloud.com";

type MailAction = {
  label: string;
  description: string;
  subject: string;
  bodyIntro: string;
  icon: typeof MailIcon;
};

const MAIL_ACTIONS: ReadonlyArray<MailAction> = [
  {
    label: "Email help",
    description: "Get help with setup, sessions, providers, or confusing behavior.",
    subject: "Lincei help request",
    bodyIntro: "What do you need help with?",
    icon: LifeBuoyIcon,
  },
  {
    label: "Send feedback",
    description: "Share what feels useful, missing, slow, unclear, or rough.",
    subject: "Lincei feedback",
    bodyIntro: "What feedback do you have?",
    icon: MessageSquareTextIcon,
  },
  {
    label: "Report bug",
    description: "Send a failure, crash, broken flow, or unexpected result.",
    subject: "Lincei bug report",
    bodyIntro: "What happened?",
    icon: BugIcon,
  },
];

function buildMailtoHref(action: MailAction): string {
  const body = [
    action.bodyIntro,
    "",
    "What did you expect?",
    "",
    "How urgent is this?",
    "",
    "Optional context:",
    "- Browser:",
    "- OS:",
    "- Session ID:",
    "",
    "Please do not include patient-identifying information or confidential study data.",
  ].join("\n");

  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(action.subject)}&body=${encodeURIComponent(body)}`;
}

function HelpFeedbackRouteView() {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => {
      toastManager.add({
        type: "success",
        title: "Email copied",
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedSessionToast({
          type: "error",
          title: "Could not copy email",
          description: error.message,
        }),
      );
    },
  });
  const copyEmail = useCallback(() => {
    copyToClipboard(FEEDBACK_EMAIL, undefined);
  }, [copyToClipboard]);

  return (
    <AppMainSurface className="isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <AppTopBar title="Help & Feedback" />

        <main className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className={cn("mx-auto flex w-full flex-col gap-6", APP_CONTENT_MAX_WIDTH_CLASS)}>
            <section className="space-y-3 px-1">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Email is the fastest way to get help, report rough edges, or shape the prototype
                while Lincei is early.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground/80">
                Do not include patient-identifying information or confidential study data.
              </p>
            </section>

            <section className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm/4 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:shadow-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
              <div className="divide-y divide-border/60">
                {MAIL_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <div
                      key={action.subject}
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 space-y-1">
                          <h2 className="text-[13px] font-semibold text-foreground">
                            {action.label}
                          </h2>
                          <p className="text-xs leading-relaxed text-muted-foreground/80">
                            {action.description}
                          </p>
                        </div>
                      </div>

                      <Button
                        render={<a href={buildMailtoHref(action)} />}
                        size="sm"
                        className="w-full sm:w-auto"
                      >
                        <MailIcon className="size-4" />
                        Open email
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                  Direct address
                </div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  {FEEDBACK_EMAIL}
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={copyEmail}>
                <ClipboardIcon className="size-4" />
                {isCopied ? "Copied" : "Copy email"}
              </Button>
            </section>
          </div>
        </main>
      </div>
    </AppMainSurface>
  );
}

export const Route = createFileRoute("/help-feedback")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: HelpFeedbackRouteView,
});
