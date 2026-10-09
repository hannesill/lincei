import { createFileRoute } from "@tanstack/react-router";

import { ClinicalDataSettings } from "../lincei/ClinicalDataSettings";

export const Route = createFileRoute("/settings/clinical")({ component: ClinicalDataSettings });
