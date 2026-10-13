import type { SVGProps } from "react";

// Lincei's monogram: the serif L of the app icon, cut out of a tile in the text colour.
// The upstream export name is kept so every call site stays untouched.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        clipRule="evenodd"
        d="M5 0h14a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5Zm1.5 5.75v1.6h1.7v9.3H6.5v1.6h11V13.6h-1.3q-.3 2.7-1.6 3h-3.4V7.35h1.7v-1.6Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
