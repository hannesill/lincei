import type { ReactNode } from "react";

/** The PhysioNet pages a researcher needs on the way to credentialed data. */
export const PHYSIONET_PAGES = {
  /** "Use of MIMIC Data with Large Language Models and Online Services". */
  aiUse: "https://physionet.org/news/post/llm-responsible-use/",
  /** The application to become a credentialed user. PhysioNet asks to sign in first. */
  credentialing: "https://physionet.org/settings/credentialing/",
  /** How to take the CITI course that credentialed access requires. */
  training: "https://physionet.org/about/citi-course/",
} as const;

/**
 * Each credentialed dataset's project page, where its data use agreement is
 * signed, by M4's name for it. Without a version PhysioNet shows the latest
 * release. A dataset M4 adds later has no page here and gets the general
 * links only.
 */
const PROJECT_PAGES: Readonly<Record<string, string>> = {
  "mimic-iv": "https://physionet.org/content/mimiciv/",
  "mimic-iv-note": "https://physionet.org/content/mimic-iv-note/",
  eicu: "https://physionet.org/content/eicu-crd/",
};

export const physioNetProjectPage = (datasetName: string): string | null =>
  PROJECT_PAGES[datasetName] ?? null;

/** A link to physionet.org. A new window is how the desktop app hands a link to the system browser. */
export function PhysioNetLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      className="underline underline-offset-2 hover:text-foreground"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

/** How a PhysioNet account gets access to credentialed datasets, with the page for each step. */
export function PhysioNetAccessSteps() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      MIMIC-IV, eICU and the other credentialed datasets need your own PhysioNet access.{" "}
      <PhysioNetLink href={PHYSIONET_PAGES.credentialing}>
        Apply to be a credentialed user
      </PhysioNetLink>
      , complete the{" "}
      <PhysioNetLink href={PHYSIONET_PAGES.training}>required training</PhysioNetLink>, then sign
      the data use agreement on each dataset&apos;s page on physionet.org.
    </p>
  );
}
