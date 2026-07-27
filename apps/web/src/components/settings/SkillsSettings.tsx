import type { ManagedSkillDescriptor, ServerProviderSkill } from "@t3tools/contracts";
import {
  LINCEI_WORKFLOWS,
  isExternalProviderSkill,
  isLinceiWorkflowEnabled,
} from "@t3tools/shared/linceiSkills";
import { ChevronDownIcon, Layers3Icon } from "lucide-react";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { formatProviderSkillInstallSource } from "../../providerSkillPresentation";
import { useServerProviders, useSkillCatalog } from "../../rpc/serverState";
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

function skillEnabled(
  skill: ManagedSkillDescriptor,
  settings: Readonly<Record<string, { readonly enabled: boolean } | undefined>>,
): boolean {
  return settings[skill.id]?.enabled ?? skill.enabled;
}

function deliveryRank(state: string | undefined): number {
  switch (state) {
    case "local-override":
      return 5;
    case "unavailable":
      return 4;
    case "stale":
      return 3;
    case "provider-native":
      return 2;
    case "managed-cache":
      return 1;
    default:
      return 0;
  }
}

function effectiveDeliveryState(
  skill: ManagedSkillDescriptor,
  providerSkills: ReadonlyArray<ServerProviderSkill>,
): string {
  const states = providerSkills
    .filter((providerSkill) => providerSkill.linceiSkillId === skill.id)
    .map((providerSkill) => providerSkill.linceiSyncStatus);
  return states.reduce(
    (selected, candidate) =>
      deliveryRank(candidate) > deliveryRank(selected) ? candidate : selected,
    skill.deliveryState as string | undefined,
  )!;
}

function workflowPreview(
  workflow: (typeof LINCEI_WORKFLOWS)[number],
  skills: ReadonlyArray<ManagedSkillDescriptor>,
  settings: Readonly<Record<string, { readonly enabled: boolean } | undefined>>,
): string {
  const byId = new Map(skills.map((skill) => [skill.id, skill] as const));
  const bodies = workflow.skillIds
    .map((id) => byId.get(id))
    .filter(
      (skill): skill is ManagedSkillDescriptor =>
        skill !== undefined && skillEnabled(skill, settings),
    )
    .map(
      (skill) =>
        `<lincei_skill id="${skill.id}" version="${skill.bundleVersion}">\n${skill.body}\n</lincei_skill>`,
    );
  const workflowBlock = workflow.body.trim()
    ? `<lincei_workflow id="${workflow.id}" version="${workflow.version}">\n${workflow.body}\n</lincei_workflow>`
    : "";
  return [workflowBlock, ...bodies].filter(Boolean).join("\n\n") || "Baseline only.";
}

function SkillRows({
  skills,
  providerSkills,
  expandedSkillIds,
  settings,
  onToggleExpanded,
  onEnabledChange,
}: {
  readonly skills: ReadonlyArray<ManagedSkillDescriptor>;
  readonly providerSkills: ReadonlyArray<ServerProviderSkill>;
  readonly expandedSkillIds: ReadonlySet<string>;
  readonly settings: Readonly<Record<string, { readonly enabled: boolean } | undefined>>;
  readonly onToggleExpanded: (id: string) => void;
  readonly onEnabledChange: (id: string, enabled: boolean) => void;
}) {
  return skills.map((skill) => {
    const expanded = expandedSkillIds.has(skill.id);
    const enabled = skillEnabled(skill, settings);
    const delivery = effectiveDeliveryState(skill, providerSkills);
    const conflict = providerSkills.find(
      (providerSkill) =>
        providerSkill.linceiSkillId === skill.id &&
        providerSkill.linceiSyncStatus === "local-override",
    );
    return (
      <SettingsRow
        key={skill.id}
        title={skill.title}
        description={skill.description}
        status={
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" size="sm">
              {skill.publisher} {skill.bundleVersion}
            </Badge>
            <Badge variant="outline" size="sm">
              {skill.tier}
            </Badge>
            <Badge variant="outline" size="sm">
              {skill.kind}
            </Badge>
            <Badge variant={delivery === "local-override" ? "secondary" : "outline"} size="sm">
              {delivery}
            </Badge>
            {!enabled ? (
              <Badge variant="outline" size="sm">
                disabled
              </Badge>
            ) : null}
          </div>
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
              onClick={() => onToggleExpanded(skill.id)}
            >
              <ChevronDownIcon
                className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </Button>
            <Switch
              checked={enabled}
              aria-label={`${skill.title} enabled`}
              onCheckedChange={(checked) => onEnabledChange(skill.id, Boolean(checked))}
            />
          </>
        }
      >
        {expanded ? (
          <div className="mt-3 space-y-2 border-t border-border/60 py-3">
            {delivery === "local-override" ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  A provider-local skill with the same name differs from the canonical M4 tree. The
                  local copy is preserved; explicitly selecting <code>{skill.id}</code> uses this
                  canonical content.
                </p>
                <code className="block break-all">canonical: {skill.treeDigest}</code>
                <code className="block break-all">
                  local: {conflict?.linceiNativeTreeDigest ?? "digest unavailable"}
                </code>
                {conflict?.path ? <code className="block break-all">{conflict.path}</code> : null}
              </div>
            ) : null}
            {skill.files.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {skill.files.length} verified files, including referenced assets.
              </p>
            ) : null}
            <ReadOnlyPromptWindow text={skill.body} className="h-72" />
          </div>
        ) : null}
      </SettingsRow>
    );
  });
}

export function SkillsSettingsPanel() {
  const providers = useServerProviders();
  const catalog = useSkillCatalog();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [expandedSkillIds, setExpandedSkillIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const providerSkills = providers.flatMap((provider) => provider.skills);
  const linceiSkills = catalog.skills.filter((skill) => skill.publisher === "lincei");
  const m4ClinicalSkills = catalog.skills.filter(
    (skill) => skill.publisher === "m4" && skill.category === "clinical" && skill.kind === "domain",
  );
  const m4MethodsAndIntegrations = catalog.skills.filter(
    (skill) => skill.publisher === "m4" && !m4ClinicalSkills.includes(skill),
  );
  const overrides = providerSkills.filter(isExternalProviderSkill);

  const updateSkillSettings = (skillId: string, enabled: boolean) => {
    updateSettings({
      linceiSkills: {
        ...settings.linceiSkills,
        [skillId]: { enabled },
      },
    });
  };

  const updateWorkflowSettings = (workflowId: string, enabled: boolean) => {
    updateSettings({
      linceiWorkflows: {
        ...settings.linceiWorkflows,
        [workflowId]: { enabled },
      },
    });
  };

  const toggleSkillExpanded = (skillId: string) => {
    setExpandedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const toggleWorkflowExpanded = (workflowId: string) => {
    setExpandedWorkflowIds((current) => {
      const next = new Set(current);
      if (next.has(workflowId)) next.delete(workflowId);
      else next.add(workflowId);
      return next;
    });
  };

  const skillRows = (skills: ReadonlyArray<ManagedSkillDescriptor>) => (
    <SkillRows
      skills={skills}
      providerSkills={providerSkills}
      expandedSkillIds={expandedSkillIds}
      settings={settings.linceiSkills}
      onToggleExpanded={toggleSkillExpanded}
      onEnabledChange={updateSkillSettings}
    />
  );

  return (
    <SettingsPageContainer>
      {catalog.sources
        .filter((source) => source.state !== "ready")
        .map((source) => (
          <SettingsSection
            key={source.publisher}
            title={`${source.publisher.toUpperCase()} source`}
          >
            <SettingsRow
              title={source.state === "stale" ? "Using cached skills" : "Skills unavailable"}
              description={source.message ?? "The canonical skill source is not currently ready."}
              status={
                <Badge variant="outline" size="sm">
                  {source.state}
                </Badge>
              }
            />
          </SettingsSection>
        ))}

      <SettingsSection title="Lincei" icon={<Layers3Icon className="size-3.5" />}>
        {skillRows(linceiSkills)}
      </SettingsSection>

      <SettingsSection title="M4 Clinical">{skillRows(m4ClinicalSkills)}</SettingsSection>

      <SettingsSection title="M4 Methods and Integrations">
        {skillRows(m4MethodsAndIntegrations)}
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
                  <Badge variant="outline" size="sm">
                    disabled
                  </Badge>
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
                      enabled
                        ? workflowPreview(workflow, catalog.skills, settings.linceiSkills)
                        : "Workflow disabled."
                    }
                  />
                </div>
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Project and Provider Overrides">
        {overrides.length > 0 ? (
          overrides.map((skill) => {
            const installSourceLabel = formatProviderSkillInstallSource(skill);
            return (
              <SettingsRow
                key={`${skill.name}:${skill.path}`}
                title={skill.displayName ?? skill.name}
                description={
                  skill.linceiSyncStatus === "local-override"
                    ? "Local content differs from the canonical skill and is preserved."
                    : (skill.shortDescription ??
                      skill.description ??
                      "External instructions discovered from the provider.")
                }
                status={
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" size="sm">
                        {skill.linceiSyncStatus ?? "provider-native"}
                      </Badge>
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
            title="No additional provider skills"
            description="No unrelated project or provider-native skills were found."
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
