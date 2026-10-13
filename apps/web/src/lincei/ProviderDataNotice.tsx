const PHYSIONET_GUIDANCE_URL = "https://physionet.org/news/post/llm-responsible-use/";

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
      {/* A new window is how the desktop app hands a link to the system browser. */}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href={PHYSIONET_GUIDANCE_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        PhysioNet&apos;s guidance
      </a>
    </p>
  );
}
