import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Button } from "~/components/ui/button";
import { useEnvironmentScope } from "~/state/session";

import { ClinicalDatasetList } from "./ClinicalDatasetList";
import { ClinicalSetupProgress } from "./ClinicalSetupProgress";
import { clinicalToolsInstalled, useClinicalSetup, useClinicalStatus } from "./clinicalState";

function ClinicalDataPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { status, refresh } = useClinicalStatus(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const setUp = useClinicalSetup(environmentId, refresh);
  if (status === null) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          This environment has no clinical research tools.
        </p>
      </SettingsPageContainer>
    );
  }
  const demoFailed = status.state === "ready" && status.demoDataset === "failed";
  const setupLabel =
    status.state === "not-installed"
      ? "Set up"
      : status.state === "failed"
        ? "Try again"
        : demoFailed
          ? "Retry the demo download"
          : null;
  return (
    <SettingsPageContainer>
      <SettingsSection title="Environment">
        <SettingsRow
          title="Clinical research tools"
          description={status.message}
          control={
            setupLabel === null ? undefined : (
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate}
                onClick={() => void setUp()}
              >
                {setupLabel}
              </Button>
            )
          }
        >
          {status.state === "ready" && !demoFailed ? null : (
            <div className="pb-2">
              <ClinicalSetupProgress status={status} />
            </div>
          )}
        </SettingsRow>
        <SettingsRow
          title="Dataset storage"
          description="Where prepared datasets are kept. Agents and M4 read them from here."
        >
          <code className="block pb-2 text-xs break-all text-muted-foreground">
            {status.dataDir}
          </code>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Datasets">
        {clinicalToolsInstalled(status) ? (
          <ClinicalDatasetList environmentId={environmentId} enabled />
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            Datasets appear here once the clinical research tools are set up.
          </p>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** Settings → Clinical Data: the clinical tools and datasets of the selected environment. */
export function ClinicalDataSettings() {
  const { environment, scope } = useSettingsScope();
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? `Reconnect ${scope.label} to manage its clinical data.`
          : "Connect an environment to manage its clinical data."}
      </p>
    );
  }
  return <ClinicalDataPanel environmentId={environment.environmentId} />;
}
