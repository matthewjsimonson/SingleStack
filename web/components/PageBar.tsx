"use client";

// PageBar — lets a page send its top-level ACTIONS up into the command bar's
// action slot (so primary buttons sit in the bar, not stacked on the page). It
// does NOT carry tabs: page/module tabs live IN the page (a standard in-page tab
// strip), never in the command bar. The command bar is title + actions + advisors.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shell publishes the action slot DOM node here (via callback-ref state, so this
// is reactive — consumers re-render once the slot mounts).
export const ChromeSlots = createContext<{ actionsSlot: HTMLElement | null }>({ actionsSlot: null });

export default function PageBar({ actions }: { actions?: ReactNode }) {
  const { actionsSlot } = useContext(ChromeSlots);
  if (!actionsSlot || !actions) return null;
  return createPortal(actions, actionsSlot);
}
