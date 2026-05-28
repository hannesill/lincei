import { createFileRoute } from "@tanstack/react-router";

import { ShortcutsSettingsPanel } from "../components/settings/ShortcutsSettings";

export const Route = createFileRoute("/settings/shortcuts")({
  component: ShortcutsSettingsPanel,
});
