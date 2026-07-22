import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

import { previewViewManager } from "../../preview/Manager.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, type DesktopIpcInvokeEvent } from "../DesktopIpc.ts";

const PreviewTabId = Schema.String.check(Schema.isTrimmed()).check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
);
const PreviewScope = Schema.String.check(Schema.isTrimmed()).check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(512),
);
const PreviewUrl = Schema.String.check(Schema.isTrimmed()).check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(2048),
);

const TabInput = Schema.Struct({ tabId: PreviewTabId });
const ScopedTabInput = Schema.Struct({ tabId: PreviewTabId, scope: PreviewScope });
const RegisterWebviewInput = Schema.Struct({
  tabId: PreviewTabId,
  webContentsId: Schema.Int.check(Schema.isGreaterThan(0)),
});
const NavigateInput = Schema.Struct({ tabId: PreviewTabId, url: PreviewUrl });
const ScopeInput = Schema.Struct({ scope: PreviewScope });

export class PreviewIpcAuthorizationError extends Data.TaggedError(
  "PreviewIpcAuthorizationError",
)<{}> {
  override get message(): string {
    return "Preview IPC is only available to the trusted Lincei renderer";
  }
}

export class PreviewIpcOperationError extends Data.TaggedError("PreviewIpcOperationError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Desktop preview operation failed: ${this.operation}`;
  }
}

const invokeAuthorized = <A>(
  event: DesktopIpcInvokeEvent,
  operation: string,
  handler: () => A | Promise<A>,
): Effect.Effect<A, PreviewIpcAuthorizationError | PreviewIpcOperationError> => {
  if (!previewViewManager.isTrustedSender(event.sender)) {
    return Effect.fail(new PreviewIpcAuthorizationError());
  }
  return Effect.tryPromise({
    try: () => Promise.resolve().then(handler),
    catch: (cause) => new PreviewIpcOperationError({ operation, cause }),
  });
};

previewViewManager.onStateChange((tabId, state) => {
  const window = previewViewManager.getMainWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IpcChannels.PREVIEW_STATE_CHANGE_CHANNEL, tabId, state);
});

export const previewMethods = [
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_CREATE_TAB_CHANNEL,
    payload: ScopedTabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "create-tab", () => {
        previewViewManager.createTab(input.tabId, input.scope);
      }),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_CLOSE_TAB_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "close-tab", () => previewViewManager.closeTab(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_REGISTER_WEBVIEW_CHANNEL,
    payload: RegisterWebviewInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "register-webview", () =>
        previewViewManager.registerWebview(input.tabId, input.webContentsId),
      ),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_NAVIGATE_CHANNEL,
    payload: NavigateInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "navigate", () =>
        previewViewManager.navigate(input.tabId, input.url),
      ),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_GO_BACK_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "go-back", () => previewViewManager.goBack(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_GO_FORWARD_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "go-forward", () => previewViewManager.goForward(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_REFRESH_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "refresh", () => previewViewManager.refresh(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_ZOOM_IN_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "zoom-in", () => previewViewManager.zoomIn(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_ZOOM_OUT_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "zoom-out", () => previewViewManager.zoomOut(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_RESET_ZOOM_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "reset-zoom", () => previewViewManager.resetZoom(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_HARD_RELOAD_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "hard-reload", () => previewViewManager.hardReload(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_OPEN_DEVTOOLS_CHANNEL,
    payload: TabInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "open-devtools", () => previewViewManager.openDevTools(input.tabId)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_CLEAR_COOKIES_CHANNEL,
    payload: ScopeInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "clear-cookies", () => previewViewManager.clearCookies(input.scope)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_CLEAR_CACHE_CHANNEL,
    payload: ScopeInput,
    result: Schema.Void,
    handler: (input, event) =>
      invokeAuthorized(event, "clear-cache", () => previewViewManager.clearCache(input.scope)),
  }),
  makeIpcMethod({
    channel: IpcChannels.PREVIEW_GET_BROWSER_PARTITION_CHANNEL,
    payload: ScopeInput,
    result: Schema.String,
    handler: (input, event) =>
      invokeAuthorized(event, "get-browser-partition", () =>
        previewViewManager.getBrowserPartition(input.scope),
      ),
  }),
] as const;
