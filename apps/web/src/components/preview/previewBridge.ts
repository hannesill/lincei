/**
 * Read the desktop preview bridge at point of use. The preload bridge can be
 * installed after renderer modules are evaluated in tests and during startup.
 */
export function readPreviewBridge() {
  return typeof window === "undefined" ? null : (window.desktopBridge?.preview ?? null);
}
