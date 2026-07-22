import { PREVIEW_ERROR_CODE_MESSAGES } from "./previewConstants";

export function describePreviewError(code: number, description: string): string {
  return (
    PREVIEW_ERROR_CODE_MESSAGES[description] ??
    (description.length > 0 ? description : `Network error (${code})`)
  );
}
