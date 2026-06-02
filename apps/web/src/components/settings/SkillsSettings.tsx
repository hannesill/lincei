import { ChevronDownIcon, Layers3Icon } from "lucide-react";
import { useState } from "react";
import {
  LINCEI_WORKFLOWS,
  buildEffectiveLinceiPrompt,
  configuredBundledLinceiSkills,
  isExternalProviderSkill,
  isLinceiWorkflowEnabled,
} from "@t3tools/shared/linceiSkills";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { formatProviderSkillInstallSource } from "../../providerSkillPresentation";
import { useServerProviders } from "../../rpc/serverState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function ReadOnlyPromptWindow({ text, className }: { text: string; className: string }) {
  return (
    <ScrollArea
      scrollbarGutter
      className={`rounded-md border border-border/60 bg-background/75 ${className}`}
    >
      <pre className="p-3 text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </ScrollArea>
  );
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function externalSkillProviderLabel(providerName: string, path: string): string | null {
  const normalized = normalizedPath(path);
  if (normalized.includes("/.agents/skills/")) return null;
  if (normalized.includes("/.codex/")) return "Codex";
  return titleCaseWords(providerName);
}

export function SkillsSettingsPanel() {
  const providers = useServerProviders();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [expandedSkillIds, setExpandedSkillIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const linceiSkills = configuredBundledLinceiSkills(settings.linceiSkills);
  const externalProviderSkills = providers.flatMap((provider) =>
    provider.skills.filter(isExternalProviderSkill).map((skill) => ({
      providerName: provider.displayName ?? provider.instanceId,
      skill,
    })),
  );

  const updateSkillSettings = (skillId: string, enabled: boolean) => {
    updateSettings({
      linceiSkills: {
        ...settings.linceiSkills,
        [skillId]: {
          enabled,
        },
      },
    });
  };

  const updateWorkflowSettings = (workflowId: string, enabled: boolean) => {
    updateSettings({
      linceiWorkflows: {
        ...settings.linceiWorkflows,
        [workflowId]: {
          enabled,
        },
      },
    });
  };

  const toggleSkillExpanded = (skillId: string) => {
    setExpandedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  };

  const toggleWorkflowExpanded = (workflowId: string) => {
    setExpandedWorkflowIds((current) => {
      const next = new Set(current);
      if (next.has(workflowId)) {
        next.delete(workflowId);
      } else {
        next.add(workflowId);
      }
      return next;
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Lincei Skills" icon={<Layers3Icon className="size-3.5" />}>
        {linceiSkills.map((skill) => {
          const expanded = expandedSkillIds.has(skill.id);
          return (
            <SettingsRow
              key={skill.id}
              title={skill.title}
              description={skill.description}
              status={
                !skill.enabled ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" size="sm">
                      disabled
                    </Badge>
                  </div>
                ) : null
              }
              control={
                <>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`${expanded ? "Hide" : "Review"} ${skill.title} prompt`}
                    aria-expanded={expanded}
                    onClick={() => toggleSkillExpanded(skill.id)}
                  >
                    <ChevronDownIcon
                      className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                  <Switch
                    checked={skill.enabled}
                    aria-label={`${skill.title} enabled`}
                    onCheckedChange={(checked) => updateSkillSettings(skill.id, Boolean(checked))}
                  />
                </>
              }
            >
              {expanded ? (
                <div className="mt-3 border-t border-border/60 py-3">
                  <ReadOnlyPromptWindow text={skill.body} className="h-72" />
                </div>
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Workflow Prompt Preview">
        {LINCEI_WORKFLOWS.map((workflow) => {
          const expanded = expandedWorkflowIds.has(workflow.id);
          const enabled = isLinceiWorkflowEnabled(workflow.id, settings.linceiWorkflows);
          return (
            <SettingsRow
              key={workflow.id}
              title={`${workflow.title} v${workflow.version}`}
              description={workflow.description}
              status={
                !enabled ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" size="sm">
                      disabled
                    </Badge>
                  </div>
                ) : null
              }
              control={
                <>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`${expanded ? "Hide" : "Review"} ${workflow.title} prompt`}
                    aria-expanded={expanded}
                    onClick={() => toggleWorkflowExpanded(workflow.id)}
                  >
                    <ChevronDownIcon
                      className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                  <Switch
                    checked={enabled}
                    aria-label={`${workflow.title} enabled`}
                    onCheckedChange={(checked) =>
                      updateWorkflowSettings(workflow.id, Boolean(checked))
                    }
                  />
                </>
              }
            >
              {expanded ? (
                <div className="mt-3 border-t border-border/60 py-3">
                  <ReadOnlyPromptWindow
                    className="h-56"
                    text={
                      buildEffectiveLinceiPrompt({
                        workflowId: workflow.id,
                        skillSettings: settings.linceiSkills,
                        workflowSettings: settings.linceiWorkflows,
                      }) || "Baseline only."
                    }
                  />
                </div>
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="External Provider Skills">
        {externalProviderSkills.length > 0 ? (
          externalProviderSkills.map(({ providerName, skill }) => {
            const providerLabel = externalSkillProviderLabel(providerName, skill.path);
            const installSourceLabel = formatProviderSkillInstallSource(skill);
            return (
              <SettingsRow
                key={`${providerName}:${skill.name}:${skill.path}`}
                title={skill.displayName ?? skill.name}
                description={
                  skill.shortDescription ??
                  skill.description ??
                  "External instructions discovered from the provider."
                }
                status={
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {providerLabel ? (
                        <Badge variant="outline" size="sm">
                          {providerLabel}
                        </Badge>
                      ) : null}
                      {installSourceLabel ? (
                        <Badge variant="outline" size="sm">
                          {installSourceLabel}
                        </Badge>
                      ) : null}
                    </div>
                    <code className="block truncate text-[11px] text-muted-foreground/70">
                      {skill.path}
                    </code>
                  </div>
                }
              />
            );
          })
        ) : (
          <SettingsRow
            title="No external provider skills"
            description="No external provider skills were reported by the configured providers."
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
