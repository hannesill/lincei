import type { SidebarProjectGroupingMode } from "@t3tools/contracts";
import {
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  type SidebarProjectSortOrder,
  type SidebarSessionPreviewCount,
  type SidebarSessionSortOrder,
} from "@t3tools/contracts/settings";

import { shortcutLabelForCommand, sessionJumpCommandForIndex } from "../../shortcuts";
import type { useServerShortcuts } from "../../rpc/serverState";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";

export const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
export const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarSessionSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
export const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
export const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();
export const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};
export const SIDEBAR_CHROME_TRIGGER_CLASS =
  "size-6 rounded-md p-0 before:rounded-[calc(var(--radius-md)-1px)] hover:bg-sidebar-accent/70 data-[pressed]:bg-sidebar-accent/70 [&_svg]:size-4";

export function clampSidebarSessionPreviewCount(value: number): SidebarSessionPreviewCount {
  return Math.min(
    MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
    Math.max(MIN_SIDEBAR_THREAD_PREVIEW_COUNT, value),
  ) as SidebarSessionPreviewCount;
}

export function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.name;
  }

  return member.environmentLabel ? `${member.environmentLabel} — ${member.cwd}` : member.cwd;
}

export function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Studies from the same repository share one sidebar row.";
    case "repository_path":
      return "Studies group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every study path gets its own sidebar row.";
  }
}

export function buildSessionJumpLabelMap(input: {
  shortcuts: ReturnType<typeof useServerShortcuts>;
  platform: string;
  terminalOpen: boolean;
  sessionJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof sessionJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.sessionJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<string, string>();
  for (const [sessionKey, command] of input.sessionJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.shortcuts, command, shortcutLabelOptions);
    if (label) {
      mapping.set(sessionKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}
