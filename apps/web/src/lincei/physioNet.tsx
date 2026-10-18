import type { ClinicalDataset } from "@t3tools/contracts";
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
 * release. For a server whose M4 does not list the page (0.5.7 and before); a
 * dataset that is neither listed there nor here gets the general links only.
 */
const PROJECT_PAGES: Readonly<Record<string, string>> = {
  "mimic-iv": "https://physionet.org/content/mimiciv/",
  "mimic-iv-note": "https://physionet.org/content/mimic-iv-note/",
  eicu: "https://physionet.org/content/eicu-crd/",
};

/** Where an account signs the dataset's data use agreement, if Lincei knows. */
export const physioNetProjectPage = (
  dataset: Pick<ClinicalDataset, "name" | "agreementUrl">,
): string | null => dataset.agreementUrl ?? PROJECT_PAGES[dataset.name] ?? null;

/** A physionet.org address in a sentence, without the punctuation that follows it. */
const PHYSIONET_ADDRESS = /(https:\/\/physionet\.org\/\S*?)(?=[.,;:!?)]*(?:\s|$))/g;

/** Text split around the physionet.org addresses in it, which are the odd entries. */
export const splitPhysioNetAddresses = (text: string): ReadonlyArray<string> =>
  text.split(PHYSIONET_ADDRESS);

/** A link out of Lincei. A new window is how the desktop app hands a link to the system browser. */
export function ExternalLink({
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

/** Text the server wrote, such as why a download failed, with its physionet.org addresses as links. */
export function PhysioNetLinkedText({ text }: { readonly text: string }) {
  return (
    <>
      {splitPhysioNetAddresses(text).map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- the parts never move
          <ExternalLink key={index} href={part}>
            {part.replace(/^https:\/\//, "")}
          </ExternalLink>
        ),
      )}
    </>
  );
}

/** The host a link goes to, which a link to a page from a dataset's definition names. */
export function hostOf(href: string): string {
  return URL.canParse(href) ? new URL(href).host : href;
}

/**
 * What a PhysioNet account needs before it can download a credentialed
 * dataset, with the page for each step. The last step is the dataset's own:
 * its data use agreement is signed on its page.
 */
export function PhysioNetAccessChecklist({
  name,
  agreementUrl,
}: {
  readonly name: string;
  /** Where the agreement is signed, from `physioNetProjectPage`. */
  readonly agreementUrl: string | null;
}) {
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
      <p>Your PhysioNet account needs access to {name}:</p>
      <ol className="list-decimal space-y-0.5 pl-5">
        <li>
          <ExternalLink href={PHYSIONET_PAGES.credentialing}>Credentialed user status</ExternalLink>
        </li>
        <li>
          The <ExternalLink href={PHYSIONET_PAGES.training}>required training</ExternalLink>
        </li>
        <li>
          The data use agreement, signed on{" "}
          {agreementUrl === null ? (
            "the dataset's page on physionet.org"
          ) : (
            <ExternalLink href={agreementUrl}>the dataset&apos;s page</ExternalLink>
          )}
        </li>
      </ol>
    </div>
  );
}
