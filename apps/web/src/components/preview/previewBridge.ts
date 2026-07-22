/** Stable desktop preview bridge handle; null in web builds. */
export const previewBridge =
  typeof window === "undefined" ? null : (window.desktopBridge?.preview ?? null);
