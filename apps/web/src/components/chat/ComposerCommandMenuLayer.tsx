import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

type ComposerCommandMenuPosition = {
  bottom: number;
  left: number;
  maxHeight: number;
  width: number;
};

type ComposerCommandMenuLayerStyle = CSSProperties & {
  "--composer-command-menu-available-height": string;
};

export function ComposerCommandMenuLayer(props: {
  anchor: HTMLElement | null;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<ComposerCommandMenuPosition | null>(null);

  useLayoutEffect(() => {
    const anchor = props.anchor;
    if (!anchor) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        maxHeight: Math.max(0, rect.top - 24),
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor]);

  if (!position) return null;

  const style: ComposerCommandMenuLayerStyle = {
    "--composer-command-menu-available-height": `${position.maxHeight}px`,
    bottom: position.bottom,
    left: position.left,
    maxHeight: position.maxHeight,
    width: position.width,
  };

  return createPortal(
    <div
      data-chat-composer-menu-layer="true"
      className="pointer-events-auto fixed z-[70] flex min-h-0 flex-col overflow-hidden"
      style={style}
    >
      {props.children}
    </div>,
    document.body,
  );
}
