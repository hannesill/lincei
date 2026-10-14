import type { ClinicalSkill, EnvironmentId } from "@t3tools/contracts";
import { type ReactNode, useId, useState } from "react";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { InlineButton } from "~/components/ui/button";

import { ClinicalNote } from "./ClinicalNote";
import { useAgentBriefing, useClinicalSkillText } from "./clinicalState";
import { CLINICAL_SETTINGS } from "./settingsSearchItems";

const TEXT_CLASS =
  "mt-1.5 max-h-80 overflow-y-auto border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground";

/** A text that stays closed until asked for, read as it is. */
function Disclosure({
  label,
  children,
}: {
  readonly label: string;
  /** What opening shows; rendered only while open. */
  readonly children: (open: boolean) => ReactNode;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 text-xs">
      <InlineButton
        tone="muted"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? `Hide ${label.replace(/^Show /, "")}` : label}
      </InlineButton>
      <div id={contentId} hidden={!open}>
        {children(open)}
      </div>
    </div>
  );
}

/** One skill's text, asked for when its disclosure first opens. */
function SkillText({
  environmentId,
  name,
  open,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly open: boolean;
}) {
  const { view, refresh } = useClinicalSkillText(environmentId, name, open);
  if (!open) return null;
  switch (view.phase) {
    case "loading":
      return <p className="mt-1.5 text-muted-foreground">Reading the skill…</p>;
    case "failed":
      return (
        <div className="mt-1.5">
          <ClinicalNote detail={view.detail} onRetry={refresh}>
            {view.message}
          </ClinicalNote>
        </div>
      );
    case "known":
      return <pre className={TEXT_CLASS}>{view.answer.text}</pre>;
  }
}

/** M4 calls its groups by folder name; these are the ones it has today. */
const CATEGORY_TITLES: Readonly<Record<string, string>> = {
  clinical: "Clinical methods",
  system: "Working with M4 and Vitrine",
};

const categoryTitle = (category: string) =>
  CATEGORY_TITLES[category] ?? category.charAt(0).toUpperCase() + category.slice(1);

function SkillList({
  environmentId,
  skills,
}: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ClinicalSkill>;
}) {
  const categories = [...new Set(skills.map((skill) => skill.category))].toSorted((a, b) =>
    // Clinical methods first: they are what a researcher recognises.
    a === "clinical" ? -1 : b === "clinical" ? 1 : a.localeCompare(b),
  );
  return (
    <div className="space-y-4 pb-2">
      {categories.map((category) => (
        <section key={category} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{categoryTitle(category)}</h4>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {skills
              .filter((skill) => skill.category === category)
              .map((skill) => (
                <li key={skill.name} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-foreground">{skill.name}</span>
                    {skill.shadowed ? (
                      <Badge variant="outline">Your own skill of this name is used</Badge>
                    ) : null}
                  </div>
                  {skill.description.length === 0 ? null : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {skill.description}
                    </p>
                  )}
                  <Disclosure label="Show the skill">
                    {(open) => (
                      <SkillText environmentId={environmentId} name={skill.name} open={open} />
                    )}
                  </Disclosure>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * What Lincei gives every agent on an environment, read-only: the
 * instructions it adds to each session for the current mode, and M4's
 * skills with their text. A researcher can check what the agent was told
 * before trusting what it did.
 */
export function AgentBriefingSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { view, refresh } = useAgentBriefing(environmentId);
  return (
    <SettingsSection {...CLINICAL_SETTINGS.agents}>
      {view.phase === "known" ? (
        <>
          <SettingsRow
            title="Instructions"
            description={`Lincei adds these to every conversation, on top of each agent's own. They are the ones for ${
              view.answer.techieMode ? "Techie mode" : "researcher mode"
            }; a project folder can add its own in AGENTS.md or CLAUDE.md.`}
          >
            <div className="pb-2">
              <Disclosure label="Show the instructions">
                {() => <pre className={TEXT_CLASS}>{view.answer.instructions}</pre>}
              </Disclosure>
            </div>
          </SettingsRow>
          <SettingsRow
            title="Clinical skills"
            description={
              view.answer.skills.length === 0
                ? "M4's skills appear here once the clinical research tools are set up."
                : `${view.answer.skills.length} skills from M4. An agent reads one when a task matches its description. You can also ask for one by name with $ in the message box.`
            }
          >
            {view.answer.skills.length === 0 ? null : (
              <SkillList environmentId={environmentId} skills={view.answer.skills} />
            )}
          </SettingsRow>
        </>
      ) : (
        <div className="px-3 py-3 sm:px-4">
          {view.phase === "loading" ? (
            <p className="text-xs text-muted-foreground">Reading what agents get…</p>
          ) : (
            <ClinicalNote detail={view.detail} onRetry={refresh}>
              {view.message}
            </ClinicalNote>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
