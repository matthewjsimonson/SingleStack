"use client";

// App shell. Grouped sidebar, consolidated to a cohesive ~10-surface IA
// (the 22->10 cleanup):
//   Foundation   → Product records, GTM records
//   Intelligence → Signals, Competitive (incl. seller lens), Market, Frontier
//   Product      → Strategy, Roadmap, Ship
//   Go-to-market → Messaging, Content, Campaigns (each its own feature-rich
//                  module), GTM Org (the field-facing sink)
//   Agents, Settings
// Messaging is the GTM-strategy root; Content and Campaigns are full production
// surfaces (not tabs); GTM Org is where Enablement/Content/Competitive publish.
// Leads/PQL dropped as a surface (PQL stays a signal that feeds Messaging).
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ProductProvider, useProductScope } from "@/lib/ProductContext";
import AgentLauncher from "@/components/AgentLauncher";
import { ChromeSlots } from "@/components/PageBar";

// Active-product switcher — the cross-module "which line am I in?" selector.
// Hidden for single-product orgs (no clutter when there's nothing to switch).
function ProductSwitcher() {
  const { active, setActive, products } = useProductScope();
  if (products.length < 2) return null;
  return (
    <div style={{ padding: "0 16px 14px" }}>
      <label htmlFor="product-switcher" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--sb-text-dim)", display: "block", marginBottom: 5 }}>Product line</label>
      <select
        id="product-switcher"
        aria-label="Active product line"
        value={active}
        onChange={(e) => setActive(e.target.value)}
        style={{ width: "100%", background: "var(--sb-fill)", color: "#fff", border: "1px solid var(--sb-border)", borderRadius: 7, padding: "6px 8px", fontSize: 12.5, fontWeight: 600 }}
      >
        <option value="all">All products</option>
        <option value="company">Company-wide</option>
        <optgroup label="Lines">
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

export type Crumb = { label: string; href?: string };

type Item = { label: string; href: string; soon?: boolean };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Foundation",
    items: [
      { label: "Product records", href: "/products" },
      { label: "GTM records", href: "/gtm" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Signals", href: "/signals" },
      { label: "Competitive", href: "/competitive" },
      { label: "Market intel", href: "/market" },
      { label: "Frontier models", href: "/frontier" },
    ],
  },
  {
    label: "Product",
    items: [
      { label: "Strategy", href: "/strategy" },
      { label: "Roadmap", href: "/roadmap" },
      { label: "Ship", href: "/ship" },
    ],
  },
  {
    label: "Go-to-market",
    items: [
      { label: "Messaging", href: "/messaging" },
      { label: "Content", href: "/content" },
      { label: "Campaigns", href: "/campaigns" },
      { label: "GTM Org", href: "/gtm-org" },
    ],
  },
];

export default function Shell({
  children,
  email,
  crumbs,
}: {
  children: ReactNode;
  email?: string | null;
  crumbs?: Crumb[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  // Callback-ref state for the command bar's action slot, so PageBar's portal
  // becomes reactive (re-renders once the slot mounts). Tabs are NOT in the bar.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const trail: Crumb[] = crumbs ?? [{ label: "Foundation" }];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 10px", borderRadius: 7, fontSize: 13, fontWeight: 600,
    color: active ? "#fff" : "var(--sb-text)",
    background: active ? "var(--sb-fill)" : "transparent",
    letterSpacing: "-0.005em",
  });

  return (
   <ProductProvider>
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: 240, minWidth: 240, background: "var(--sb)", color: "var(--sb-text)", display: "flex", flexDirection: "column", padding: "16px 0" }}>
        <div style={{ padding: "0 16px 18px", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ac)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>S</span>
          <span style={{ color: "#fff", fontSize: 15, fontWeight: 680, letterSpacing: "-0.02em" }}>SingleStack</span>
        </div>

        <ProductSwitcher />

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {/* Command center home */}
          <a href="/" style={{ ...itemStyle(isActive("/")), marginBottom: 14 }}>
            <span>Homepage</span>
          </a>

          {GROUPS.map((g) => (
            <div key={g.label} style={{ marginBottom: 14 }}>
              <div style={{ padding: "0 10px 5px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--sb-text-dim)" }}>{g.label}</div>
              {g.items.map((it) => {
                const active = isActive(it.href);
                return (
                  <a key={it.href} href={it.href} style={itemStyle(active)}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                    {it.soon && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--sb-text-dim)", border: "1px solid var(--sb-border)", borderRadius: 4, padding: "1px 4px", letterSpacing: "0.04em" }}>SOON</span>}
                  </a>
                );
              })}
            </div>
          ))}

          {/* Agents — standalone */}
          <div style={{ marginBottom: 6 }}>
            <a href="/agents" style={itemStyle(isActive("/agents"))}>
              <span>Agents</span>
            </a>
            <a href="/settings" style={itemStyle(isActive("/settings"))}>
              <span>Settings</span>
            </a>
          </div>
        </div>

        <div style={{ padding: "12px 16px 0", borderTop: "1px solid var(--sb-border)", margin: "0 8px" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--sb-text-dim)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email ?? ""}</div>
          <button onClick={signOut} style={{ background: "transparent", border: "1px solid var(--sb-border)", color: "var(--sb-text)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, width: "100%" }}>Sign out</button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ height: 52, minHeight: 52, background: "var(--panel)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "stretch", padding: "0 24px", gap: 4 }}>
          {/* Title = the route's breadcrumb trail — no duplicate <h1> in the body */}
          <div className="row" style={{ gap: 6, alignItems: "center", flexShrink: 0 }}>
            {trail.map((c, i) => (
              <span key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
                {i > 0 && <span className="t-muted" style={{ fontSize: 13 }}>/</span>}
                {c.href ? <a href={c.href} className="t-sub" style={{ fontWeight: 600 }}>{c.label}</a> : <span style={{ fontSize: 14, fontWeight: 680 }}>{c.label}</span>}
              </span>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {/* Page actions — portaled up from the page (not tabs; tabs live in-page) */}
          <div ref={setActionsSlot} className="row gap-2" style={{ alignItems: "center" }} />
          {/* Advisors — the officers relevant to where you are, one click away */}
          <AgentLauncher />
        </header>
        <main style={{ flex: 1, overflowY: "auto" }}>
          <ChromeSlots.Provider value={{ actionsSlot }}>
            <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%", padding: "20px 28px 64px" }}>{children}</div>
          </ChromeSlots.Provider>
        </main>
      </div>
    </div>
   </ProductProvider>
  );
}
