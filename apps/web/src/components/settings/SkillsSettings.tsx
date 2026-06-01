import { Layers3Icon } from "lucide-react";
import { LINCEI_WORKFLOWS, buildEffectiveLinceiPrompt } from "@t3tools/shared/linceiSkills";

import { useServerProviders } from "../../rpc/serverState";
import { Badge } from "../ui/badge";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function statusLabel(value: string | undefined): string {
  switch (value) {
    case "current":
      return "native current";
    case "outdated":
      return "native outdated";
    case "conflict":
      return "native conflict";
    case "target-modified":
      return "native conflict";
    case "prompt-fallback":
      return "prompt fallback";
    case "unavailable":
      return "unavailable";
    case "unmanaged":
      return "native current";
    default:
      return "prompt fallback";
  }
}

export function SkillsSettingsPanel() {
  const providers = useServerProviders();
  const skillsByName = new Map<
    string,
    {
      readonly title: string;
      readonly description: string;
      readonly source: string;
      readonly providers: Array<{ readonly name: string; readonly status: string }>;
    }
  >();

  for (const provider of providers) {
    for (const skill of provider.skills) {
      const key = skill.linceiSkillId ?? skill.name;
      const existing = skillsByName.get(key);
      const row = existing ?? {
        title: skill.displayName ?? skill.name,
        description: skill.shortDescription ?? skill.description ?? "Provider skill",
        source: skill.linceiSource ?? "provider-native",
        providers: [],
      };
      row.providers.push({
        name: provider.displayName ?? provider.instanceId,
        status: statusLabel(skill.linceiSyncStatus),
      });
      skillsByName.set(key, row);
    }
  }

  return (
    <SettingsPageContainer>
      <SettingsSection title="Skills" icon={<Layers3Icon className="size-3.5" />}>
        {[...skillsByName.entries()].map(([id, skill]) => (
          <SettingsRow
            key={id}
            title={skill.title}
            description={skill.description}
            status={
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" size="sm">
                  {skill.source}
                </Badge>
                {skill.providers.map((provider) => (
                  <Badge key={`${id}:${provider.name}`} variant="outline" size="sm">
                    {provider.name}: {provider.status}
                  </Badge>
                ))}
              </div>
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Workflow Prompt Preview">
        {LINCEI_WORKFLOWS.map((workflow) => (
          <SettingsRow
            key={workflow.id}
            title={`${workflow.title} v${workflow.version}`}
            description={workflow.description}
          >
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border/60 bg-background/75 p-3 text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
              {buildEffectiveLinceiPrompt({ workflowId: workflow.id }) || "Baseline only."}
            </pre>
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
