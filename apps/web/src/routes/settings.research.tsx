import { createFileRoute } from "@tanstack/react-router";

import { ResearchSettingsPanel } from "../components/settings/ResearchSettings";

export const Route = createFileRoute("/settings/research")({
  component: ResearchSettingsPanel,
});
