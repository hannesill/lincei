import { useState } from "react";

/**
 * The value, or the last one there was while it is gone. A dialog is closed
 * by clearing what it is about, and fades out for a moment after that: this
 * keeps its title and form as they were until it is off screen.
 */
export function useLastPresent<T>(value: T | null): T | null {
  const [last, setLast] = useState(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}
