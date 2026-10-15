import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { type ComponentProps, type RefObject, useEffect, useRef, useState } from "react";

import { WelcomeWizard } from "~/components/onboarding/WelcomeWizard";
import { T3Wordmark } from "~/components/T3Wordmark";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Dialog } from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Switch } from "~/components/ui/switch";
import { WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "~/components/ui/wizard";
import { useUpdatePrimarySettings } from "~/hooks/useSettings";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";

import { ClinicalDatasetList } from "./ClinicalDatasetList";
import { ClinicalStatusNote } from "./ClinicalNote";
import {
  clinicalSetupAction,
  clinicalStepFooter,
  clinicalToolsInstalled,
  describeLostConnection,
  WIZARD_STAGES,
} from "./clinicalPresentation";
import { ClinicalSetupProgress } from "./ClinicalSetupProgress";
import { useClinicalSetup, useClinicalStatus } from "./clinicalState";
import type { ClinicalStatusView } from "./linceiAnswers";
import { linceiCommand } from "./linceiRequests";
import { useTechieModeSwitch } from "./mode/techieModeSwitch";
import { PhysioNetAccessSteps } from "./physioNet";
import { ProviderDataNotice } from "./ProviderDataNotice";
import { seedResearcherDefaults } from "./researcherDefaults";
import { TECHIE_MODE_SETTING } from "./settingsSearchItems";

function ClinicalStep({
  environmentId,
  view,
  refresh,
  headingRef,
  onContinue,
}: {
  readonly environmentId: EnvironmentId;
  readonly view: ClinicalStatusView;
  readonly refresh: () => void;
  /** Where focus lands when the step opens, so that Return does not leave it at once. */
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly onContinue: () => void;
}) {
  const canOperate = useAtomValue(linceiCommand.permissionAtom(environmentId));
  const setUp = useClinicalSetup(environmentId, refresh);
  const connection = useEnvironment(environmentId)?.connection.phase;
  const [techie, setTechie] = useTechieModeSwitch();
  const status = view.phase === "known" ? view.status : null;
  const action = status === null ? null : clinicalSetupAction(status);
  const lost =
    connection === undefined || connection === "connected"
      ? null
      : describeLostConnection({
          otherComputer: null,
          reconnecting: connection === "connecting" || connection === "reconnecting",
        });
  return (
    <>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-foreground outline-none"
      >
        Clinical research tools
      </h1>
      {/*
        The one scrolling region of the step. Its height is what the window
        leaves after the dialog's header, this heading and the footer below,
        so Continue stays in view however much is shown here.
      */}
      <ScrollArea
        scrollFade
        className="mt-2.5 h-auto max-h-[max(8rem,min(32rem,calc(100dvh-20rem)))] max-sm:max-h-[max(8rem,calc(100dvh-25rem))]"
      >
        <div className="space-y-5 pr-3">
          <div className="space-y-2.5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Lincei installs M4 for clinical datasets and Vitrine for research cards into its own
              folder, with a small open demo of MIMIC-IV to try things on.
            </p>
            {/* Its own line: it says what happened and what to do next. */}
            {status === null ? null : (
              <p className="text-sm leading-relaxed text-foreground">{status.message}</p>
            )}
          </div>
          {lost === null ? null : (
            <Alert variant="warning">
              <AlertTitle>{lost.title}</AlertTitle>
              <AlertDescription>{lost.detail}</AlertDescription>
            </Alert>
          )}
          {view.phase === "known" ? (
            <div className="flex items-start justify-between gap-6">
              <ClinicalSetupProgress status={view.status} className="flex-1" />
              {action === null ? null : (
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={!canOperate}
                  onClick={() => void setUp()}
                >
                  {action}
                </Button>
              )}
            </div>
          ) : (
            <ClinicalStatusNote view={view} onRetry={refresh} />
          )}
          {status !== null && clinicalToolsInstalled(status) ? (
            <Collapsible>
              <CollapsibleTrigger
                type="button"
                className="group flex items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRightIcon className="size-3.5 shrink-0 group-data-panel-open:rotate-90" />
                Add MIMIC-IV, eICU or other datasets (optional)
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="space-y-3 pt-3">
                  <PhysioNetAccessSteps />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    You can add them now or later, under Settings, Clinical Data.
                  </p>
                  <ProviderDataNotice subject="these datasets" />
                  <div className="rounded-xl bg-card ring-1 ring-black/5 dark:ring-white/5">
                    <ClinicalDatasetList environmentId={environmentId} enabled />
                  </div>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
          {/*
            Setup is the one place everybody passes, and a developer who misses
            the terminal would not know to look for a switch in Settings.
          */}
          <div className="flex items-start justify-between gap-6 border-t border-border pt-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{TECHIE_MODE_SETTING.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                For people who work with code: shows terminals, file changes and git beside the
                conversation. Leave it off otherwise. You can change it under Settings, General.
              </p>
            </div>
            <Switch
              checked={techie}
              onCheckedChange={setTechie}
              aria-label={TECHIE_MODE_SETTING.title}
            />
          </div>
        </div>
      </ScrollArea>
      <div className="mt-5 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {clinicalStepFooter(view)}
        </p>
        <Button className="shrink-0 self-end" onClick={onContinue}>
          Continue
          <ArrowRightIcon className="size-3.5" />
        </Button>
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
 * is also under Settings, Clinical Data. The step is shown whatever is known
 * about the clinical research tools, including nothing yet. Only a server
 * that is not Lincei has no step.
 */
export function LinceiWelcomeWizard(props: ComponentProps<typeof WelcomeWizard>) {
  const environmentId = usePrimaryEnvironmentId();
  const { view, refresh } = useClinicalStatus(environmentId);
  const [finished, setFinished] = useState<{
    readonly projectRef: ScopedProjectRef | undefined;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const updateSettings = useUpdatePrimarySettings();

  // The answer can arrive after upstream's wizard is done. If it is "this
  // server is not Lincei", the step that was waiting for it has nothing to
  // show and setup ends as upstream's would have.
  const { onDone } = props;
  const nothingToShow = finished !== null && (environmentId === null || view.phase === "absent");
  // Setup ends once, whether the step ends it or a second click on Continue tries to.
  const left = useRef(false);
  useEffect(() => {
    if (!nothingToShow || finished === null || left.current) return;
    left.current = true;
    void onDone(finished.projectRef);
  }, [nothingToShow, finished, onDone]);

  if (finished === null) {
    return (
      <WelcomeWizard
        {...props}
        onDone={(projectRef) => {
          if (environmentId === null || view.phase === "absent") return props.onDone(projectRef);
          seedResearcherDefaults(updateSettings);
          setFinished({ projectRef });
        }}
      />
    );
  }
  if (environmentId === null || view.phase === "absent") return null;
  return (
    <Dialog open disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <WizardPopup
        size="wide"
        bottomStickOnMobile={false}
        showCloseButton={false}
        initialFocus={headingRef}
      >
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
          <WizardSteps steps={WIZARD_STAGES} currentStep={WIZARD_STAGES.length - 1} />
        </WizardHeader>
        <WizardPanel>
          <ClinicalStep
            environmentId={environmentId}
            view={view}
            refresh={refresh}
            headingRef={headingRef}
            onContinue={() => {
              if (left.current) return;
              left.current = true;
              void props.onDone(finished.projectRef);
            }}
          />
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}
