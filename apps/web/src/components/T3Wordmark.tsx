import type { SVGProps } from "react";

// Lincei's monogram. The upstream export name is kept so every call site stays untouched.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        clipRule="evenodd"
        d="M5 0h14a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5Zm3.25 5.5v13h9v-2.6h-6.1V5.5h-2.9Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
