"use client";

// PageBar — lets a page inject its module TABS and ACTIONS up into the shared
// top command bar (in Shell), instead of paying for a second/third stacked
// header band on the page body. A page renders <PageBar tabs/actions/> once; the
// content is portaled into the bar's slots, so it stays owned by the page (live
// state, handlers) while living visually in the bar. The page title comes from
// the breadcrumb the route already sets — no duplicate <h1>.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shell publishes the two slot DOM nodes here (via callback-ref state, so this is
// reactive — consumers re-render once the slots mount).
export const ChromeSlots = createContext<{ tabsSlot: HTMLElement | null; actionsSlot: HTMLElement | null }>({ tabsSlot: null, actionsSlot: null });

export type BarTab = { key: string; label: string; count?: number };

export default function PageBar({ tabs, active, onTab, actions }: {
  tabs?: BarTab[];
  active?: string;
  onTab?: (k: string) => void;
  actions?: ReactNode;
}) {
  const { tabsSlot, actionsSlot } = useContext(ChromeSlots);
  return (
    <>
      {tabsSlot && tabs && tabs.length > 0 && createPortal(
        <div style={{ display: "flex", alignItems: "stretch", height: "100%", gap: 2 }}>
          {tabs.map((t) => {
            const on = active === t.key;
            return (
              <button key={t.key} onClick={() => onTab?.(t.key)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, height: "100%",
                  background: "none", border: "none", borderBottom: on ? "2px solid var(--ac)" : "2px solid transparent",
                  color: on ? "var(--tp)" : "var(--ts)", fontWeight: on ? 680 : 600, fontSize: 13, padding: "0 12px", cursor: "pointer", whiteSpace: "nowrap",
                }}>
                {t.label}
                {t.count != null && t.count > 0 && <span className="t-mono-xs" style={{ color: on ? "var(--ac-text)" : "var(--tm)" }}>{t.count}</span>}
              </button>
            );
          })}
        </div>,
        tabsSlot,
      )}
      {actionsSlot && actions && createPortal(actions, actionsSlot)}
    </>
  );
}
