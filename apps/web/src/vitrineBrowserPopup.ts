export const VITRINE_POPUP_BLOCKED_MESSAGE =
  "Your browser blocked the Research window. Allow pop-ups for Lincei and try again.";

export interface VitrineBrowserPopup {
  readonly navigate: (url: string) => void;
  readonly discard: () => void;
}

type OpenPopup = (url: string, target: string) => Window | null;

/** Reserve user activation before the asynchronous Vitrine lifecycle request. */
export function reserveVitrineBrowserPopup(
  openPopup: OpenPopup = (url, target) => window.open(url, target),
): VitrineBrowserPopup {
  const popup = openPopup("about:blank", "_blank");
  if (!popup) {
    throw new Error(VITRINE_POPUP_BLOCKED_MESSAGE);
  }

  try {
    popup.opener = null;
    popup.document.title = "Starting Vitrine…";

    const referrerPolicy = popup.document.createElement("meta");
    referrerPolicy.name = "referrer";
    referrerPolicy.content = "no-referrer";
    popup.document.head.append(referrerPolicy);

    const status = popup.document.createElement("p");
    status.textContent = "Starting Vitrine…";
    popup.document.body.replaceChildren(status);
  } catch {
    // A browser may restrict placeholder DOM access. The retained WindowProxy
    // is still sufficient to navigate the reserved tab safely.
  }

  let navigated = false;
  return {
    navigate: (url) => {
      if (popup.closed) {
        throw new Error("The reserved Research window was closed before Vitrine was ready.");
      }
      popup.location.replace(url);
      navigated = true;
    },
    discard: () => {
      if (!navigated && !popup.closed) {
        popup.close();
      }
    },
  };
}
