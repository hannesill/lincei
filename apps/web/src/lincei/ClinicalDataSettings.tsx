import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Button } from "~/components/ui/button";
import { environmentCatalog } from "~/connection/catalog";
import { type EnvironmentPresentation, usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { AgentBriefingSection } from "./AgentBriefingSection";
import { ClinicalDatasetList } from "./ClinicalDatasetList";
import { ClinicalStatusNote } from "./ClinicalNote";
import {
  clinicalSetupAction,
  clinicalSetupUnsettled,
  clinicalToolsInstalled,
  describeLostConnection,
} from "./clinicalPresentation";
import { ClinicalSetupProgress } from "./ClinicalSetupProgress";
import { useClinicalSetup, useClinicalStatus } from "./clinicalState";
import { linceiCommand } from "./linceiRequests";
import { CLINICAL_SETTINGS } from "./settingsSearchItems";

/**
 * The settings page frame without upstream's "Applying settings for <project>
 * across <environment>". That sentence picks where a setting is written, and
 * nothing on this page is a setting with a scope. The frame renders it as a
 * `<p>` around its project picker, which is what the class finds; should
 * upstream change that, the sentence comes back and nothing else goes.
 */
function ClinicalPage({ children }: { readonly children: ReactNode }) {
  return (
    <SettingsPageContainer className="[&>p:has([aria-label^='Project_scope'])]:hidden">
      {children}
    </SettingsPageContainer>
  );
}

function ClinicalDataPanel({
  environment,
  onThisComputer,
}: {
  readonly environment: EnvironmentPresentation;
  readonly onThisComputer: boolean;
}) {
  const { environmentId } = environment;
  const { view, refresh } = useClinicalStatus(environmentId);
  const canOperate = useAtomValue(linceiCommand.permissionAtom(environmentId));
  const setUp = useClinicalSetup(environmentId, refresh);
  // A page without a picker has to say whose tools it shows when that is not obvious.
  const elsewhere = onThisComputer ? null : (
    <p className="px-3 text-sm text-muted-foreground sm:px-4">
      These are the clinical research tools and datasets on {environment.label}.
    </p>
  );

  if (view.phase !== "known") {
    return (
      <ClinicalPage>
        {elsewhere}
        <SettingsSection {...CLINICAL_SETTINGS.tools}>
          <div className="px-3 py-3 sm:px-4">
            <ClinicalStatusNote view={view} onRetry={refresh} />
          </div>
        </SettingsSection>
      </ClinicalPage>
    );
  }

  const { status } = view;
  const action = clinicalSetupAction(status);
  return (
    <ClinicalPage>
      {elsewhere}
      <SettingsSection {...CLINICAL_SETTINGS.tools}>
        <SettingsRow
          title="Setup"
          description={status.message}
          control={
            action === null ? undefined : (
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate}
                onClick={() => void setUp()}
              >
                {action}
              </Button>
            )
          }
        >
          {clinicalSetupUnsettled(status) ? (
            <div className="pb-2">
              <ClinicalSetupProgress status={status} />
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection {...CLINICAL_SETTINGS.datasets}>
        {clinicalToolsInstalled(status) ? (
          <>
            <ClinicalDatasetList
              environmentId={environmentId}
              enabled
              storageDir={status.dataDir}
            />
          </>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            Datasets appear here once the clinical research tools are set up.
          </p>
        )}
      </SettingsSection>
      <AgentBriefingSection environmentId={environmentId} />
    </ClinicalPage>
  );
}

/**
 * What the page says when the server that holds the clinical research tools
 * cannot be reached. For most people that server is a background service of
 * the app itself, so "connect an environment" is nothing they could act on.
 */
function LostConnection({
  target,
  onThisComputer,
}: {
  readonly target: EnvironmentPresentation | null;
  readonly onThisComputer: boolean;
}) {
  const reconnect = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  if (target === null) {
    return (
      <ClinicalPage>
        <SettingsSection {...CLINICAL_SETTINGS.tools}>
          <SettingsRow
            title="Lincei is not connected to a computer that runs it"
            description="The clinical research tools live with Lincei's background service. Open the Lincei app on the computer that has them."
          />
        </SettingsSection>
      </ClinicalPage>
    );
  }
  const { phase } = target.connection;
  const reconnecting = phase === "connecting" || phase === "reconnecting";
  const lost = describeLostConnection({
    otherComputer: onThisComputer ? null : target.label,
    reconnecting,
  });
  return (
    <ClinicalPage>
      <SettingsSection {...CLINICAL_SETTINGS.tools}>
        <SettingsRow
          title={lost.title}
          description={lost.detail}
          control={
            reconnecting ? undefined : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void reconnect(target.environmentId)}
              >
                Reconnect
              </Button>
            )
          }
        />
      </SettingsSection>
    </ClinicalPage>
  );
}

/**
 * Settings, Clinical Data: the clinical research tools and datasets of one
 * computer. That is the computer the settings selection resolves to: the one
 * this app runs on, unless another was picked on a page that has the picker.
 */
export function ClinicalDataSettings() {
  const { environment, environments } = useSettingsScope();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  if (environment) {
    return (
      <ClinicalDataPanel
        // What the panel holds between answers belongs to one computer.
        key={environment.environmentId}
        environment={environment}
        onThisComputer={environment.environmentId === primaryEnvironmentId}
      />
    );
  }
  // Nothing in the selection is connected. The page is about this computer
  // when it is in the selection, and about the first one in it otherwise.
  const target =
    environments.find((candidate) => candidate.environmentId === primaryEnvironmentId) ??
    environments[0] ??
    null;
  return (
    <LostConnection
      target={target}
      onThisComputer={target !== null && target.environmentId === primaryEnvironmentId}
    />
  );
}
