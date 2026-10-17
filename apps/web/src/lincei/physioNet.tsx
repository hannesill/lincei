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
  pageUrl,
}: {
  readonly name: string;
  readonly pageUrl: string | undefined;
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
          {pageUrl === undefined ? (
            "the dataset's page on physionet.org"
          ) : (
            <ExternalLink href={pageUrl}>the dataset&apos;s page</ExternalLink>
          )}
        </li>
      </ol>
    </div>
  );
}
