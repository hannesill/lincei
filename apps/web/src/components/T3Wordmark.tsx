import type { SVGProps } from "react";

// Lincei's mark: a card with an outline and a hard shadow, holding a serif L, in the text colour.
// The same drawing as the app icon (scripts/lincei/icons.ts). The upstream export name is kept so
// every call site stays untouched.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 0h14v14H0Zm1 1v12h12V1ZM14 2h2v14H2v-2h12ZM3.58 3v1.024h1.088v5.952H3.58V11h7.04V8.024h-.832q-.192 1.728-1.024 1.92H6.588V4.024h1.088V3Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
