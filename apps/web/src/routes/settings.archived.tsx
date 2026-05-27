import { createFileRoute } from "@tanstack/react-router";

import { ArchivedSessionsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedSessionsPanel,
});
