/**
 * Upstream copy that speaks to developers, and what a researcher reads
 * instead. Applied to upstream's source as the web bundle is built
 * (linceiBrand.ts), so the source stays upstream's.
 *
 * `from` is exact source text and must occur exactly once in `file`:
 * `node scripts/lincei/identity.ts check` fails otherwise, and so does the
 * build. When upstream rewords a string, update `from` here.
 */
export interface CopyRule {
  /** Repository path of the upstream file. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export const COPY_RULES: ReadonlyArray<CopyRule> = [
  {
    file: "apps/web/src/components/chat/DraftHeroHeadline.tsx",
    from: '? "What should we work on?"',
    to: '? "What do you want to find out?"',
  },
  {
    file: "apps/web/src/components/chat/DraftHeroHeadline.tsx",
    from: "<>What should we work on?</>",
    to: "<>What do you want to find out?</>",
  },
  {
    file: "apps/web/src/components/chat/DraftHeroHeadline.tsx",
    from: "? `What should we build in ${activeProjectDisplayName}?`",
    to: "? `What do you want to find out in ${activeProjectDisplayName}?`",
  },
  {
    file: "apps/web/src/components/chat/DraftHeroHeadline.tsx",
    from: "<>What should we build in {projectSelector}?</>",
    to: "<>What do you want to find out in {projectSelector}?</>",
  },
  {
    file: "apps/web/src/components/NoProjectsHero.tsx",
    from: "<EmptyTitle>What should we work on?</EmptyTitle>",
    to: "<EmptyTitle>What do you want to find out?</EmptyTitle>",
  },
  {
    file: "apps/web/src/components/NoProjectsHero.tsx",
    from: '"Add a project, or start without one."',
    to: '"Add a project folder, or start without one."',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: 'description="Choose an agent to start coding. You can add more later."',
    to: 'description="Choose the AI agent that will do the analysis. You can add more later."',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: '"Ready to code."',
    to: '"Ready."',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: '"Review the command, then press Enter to run it."',
    to: '"Press Enter to run the command below. Your browser may open to finish signing in."',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: 'title="Choose your projects"',
    to: 'title="Bring in earlier work"',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: 'description="Import projects and conversations from your selected computers."',
    to: 'description="If you have used Claude Code or Codex on this computer, you can bring those projects in. Otherwise continue."',
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: "No existing Claude Code or Codex projects found.",
    to: "Nothing to bring in on this computer.",
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: "onClick={() => void onDone()}>\n            Do not import projects",
    to: "onClick={() => void onDone()}>\n            Continue without importing",
  },
  {
    file: "apps/web/src/components/onboarding/WelcomeWizard.tsx",
    from: "onClick={finishAfterImport}>\n          Do not import projects",
    to: "onClick={finishAfterImport}>\n          Continue without importing",
  },
  {
    file: "apps/web/src/composerPlaceholder.ts",
    from: '"Ask for changes, send follow-ups, or attach images"',
    to: '"Ask a question about your data, or describe the analysis you need"',
  },
  {
    file: "apps/web/src/components/chat/ChatComposer.tsx",
    from: '"Ask anything, @tag files/folders, $use skills, or / for commands"',
    to: '"Ask a question about your data, @ files, $ skills, or / for commands"',
  },
  {
    file: "apps/web/src/components/chat/ChatComposer.tsx",
    from: '"Enable a provider in Settings to send a message"',
    to: '"Sign in to an agent in Settings to send a message"',
  },
  {
    file: "apps/web/src/components/chat/ChatComposer.tsx",
    from: '"Enable a provider in Settings"',
    to: '"Sign in to an agent in Settings"',
  },
  {
    file: "apps/web/src/components/chat/ChatComposer.tsx",
    from: '"Open provider settings" : "No provider available"',
    to: '"Open agent settings" : "No agent available"',
  },
  {
    file: "apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts",
    from: '"Install the update now or review provider settings."',
    to: '"Install it now, or review your agents in Settings."',
  },
  {
    file: "apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts",
    from: "return `Updates Available: ${providers.length} providers`;",
    to: "return `Updates available for ${providers.length} agents`;",
  },
  {
    file: "apps/web/src/components/settings/SettingsSidebarNav.tsx",
    from: "                No settings found\n",
    to: "                No settings found. Developer settings appear when Techie mode is on.\n",
  },
];
