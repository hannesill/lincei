import { createFileRoute } from "@tanstack/react-router";

import { DatasetSettingsPanel } from "../components/settings/DatasetSettings";

export const Route = createFileRoute("/settings/datasets")({
  component: DatasetSettingsPanel,
});
