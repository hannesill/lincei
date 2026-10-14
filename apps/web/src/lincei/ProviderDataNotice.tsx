import { Checkbox } from "~/components/ui/checkbox";

import { PHYSIONET_PAGES, PhysioNetLink } from "./physioNet";

/**
 * What a researcher has to know before credentialed data comes into reach of
 * an agent: the agent's model provider sees what the agent reads, and
 * PhysioNet's data use agreement restricts which providers may. Shown where
 * such data is brought in, not for the open demo dataset.
 */
export function ProviderDataNotice({
  subject = "this dataset",
}: {
  /** What the notice is about where it stands. */
  readonly subject?: "this dataset" | "these datasets";
}) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Agents send what they read from {subject}, including query results, to your AI provider.
      PhysioNet allows this only with a service that keeps none of the data, does not train on it,
      and has no human review. Checking that for your account is your responsibility.{" "}
      <PhysioNetLink href={PHYSIONET_PAGES.aiUse}>
        PhysioNet&apos;s rules for AI services
      </PhysioNetLink>
    </p>
  );
}

/**
 * The researcher's confirmation, under the notice, that their AI provider
 * account meets those rules. A dialog that brings credentialed data in does
 * not go ahead without it. It is asked every time rather than remembered,
 * because the account an agent uses can change between datasets.
 */
export function ProviderDataAcknowledgement({
  checked,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-foreground">
      {/* One line high, so the box sits on the first line of the sentence. */}
      <span className="flex h-lh shrink-0 items-center">
        <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      </span>
      I have checked that my AI provider account meets these rules.
    </label>
  );
}
