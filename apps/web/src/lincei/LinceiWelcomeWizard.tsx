import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope, type ClinicalRuntimeStatus } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { WelcomeWizard } from "~/components/onboarding/WelcomeWizard";
import { T3Wordmark } from "~/components/T3Wordmark";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "~/components/ui/wizard";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";

import { ClinicalDatasetList } from "./ClinicalDatasetList";
import { ClinicalSetupProgress } from "./ClinicalSetupProgress";
import { clinicalToolsInstalled, useClinicalSetup, useClinicalStatus } from "./clinicalState";

/** T3 Code's stages plus Lincei's; `scripts/lincei/identity.ts` adds the last to its header too. */
const STAGES = ["Connect", "Agents", "Projects", "Clinical"] as const;

function ClinicalStep({
  environmentId,
  status,
  refresh,
  onContinue,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: ClinicalRuntimeStatus;
  readonly refresh: () => void;
  readonly onContinue: () => void;
}) {
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const setUp = useClinicalSetup(environmentId, refresh);
  const needsStart = status.state === "not-installed" || status.state === "failed";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Clinical research tools
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        Lincei installs M4 for clinical datasets and Vitrine for research cards into its own folder,
        with a small open demo of MIMIC-IV to try things on. {status.message}
      </p>
      <ScrollArea scrollFade className="mt-5 h-auto max-h-[min(32rem,55dvh)]">
        <div className="space-y-5 pr-3">
          <div className="flex items-start justify-between gap-6">
            <ClinicalSetupProgress status={status} />
            {needsStart ? (
              <Button variant="outline" disabled={!canOperate} onClick={() => void setUp()}>
                {status.state === "failed" ? "Try again" : "Set up"}
              </Button>
            ) : null}
          </div>
          {clinicalToolsInstalled(status) ? (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Datasets</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Optional. MIMIC-IV, eICU and the other credentialed datasets need your own PhysioNet
                access. You can add them now or later.
              </p>
              <div className="rounded-xl bg-card ring-1 ring-black/5 dark:ring-white/5">
                <ClinicalDatasetList environmentId={environmentId} enabled />
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <div className="mt-6 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          Setup and downloads keep running after you continue. Find them again under Settings,
          Clinical Data.
        </p>
        <div className="flex shrink-0 justify-end">
          <Button autoFocus onClick={onContinue}>
            Continue
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * T3 Code's first-run wizard followed by Lincei's clinical step. `welcome.tsx`
 * renders this in place of `WelcomeWizard`, which keeps the change to that
 * upstream file to the import and the tag name.
 *
 * The step comes after upstream's wizard has marked onboarding complete, so
 * leaving the app here does not bring the wizard back; everything on the step
 * is also under Settings, Clinical Data. Against a server that is not Lincei
 * the step is skipped.
 */
export function LinceiWelcomeWizard(props: ComponentProps<typeof WelcomeWizard>) {
  const environmentId = usePrimaryEnvironmentId();
  const { status, refresh } = useClinicalStatus(environmentId);
  const [finished, setFinished] = useState<{
    readonly projectRef: ScopedProjectRef | undefined;
  } | null>(null);

  if (finished === null || environmentId === null || status === null) {
    return (
      <WelcomeWizard
        {...props}
        onDone={(projectRef) =>
          environmentId === null || status === null
            ? props.onDone(projectRef)
            : setFinished({ projectRef })
        }
      />
    );
  }
  return (
    <Dialog open disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <WizardPopup size="wide" bottomStickOnMobile={false} showCloseButton={false}>
        <WizardHeader
          title="Set up Lincei"
          identity={
            <div className="flex items-baseline gap-1.5" role="img" aria-label="Lincei">
              <T3Wordmark className="h-4 w-auto shrink-0" aria-hidden />
              <span className="text-2xl font-medium tracking-tight text-muted-foreground">
                Lincei
              </span>
            </div>
          }
        >
          <WizardSteps steps={STAGES} currentStep={STAGES.length - 1} />
        </WizardHeader>
        <WizardPanel>
          <ClinicalStep
            environmentId={environmentId}
            status={status}
            refresh={refresh}
            onContinue={() => void props.onDone(finished.projectRef)}
          />
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}
