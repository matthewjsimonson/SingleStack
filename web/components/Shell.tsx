"use client";

// App shell. Grouped sidebar matching the product's mental model:
//   Foundation  → Overview, Product records, GTM records
//   Intelligence → Signals, Competitors        (placeholders)
//   Build        → Roadmap, Ship               (placeholders)
//   Campaigns    → Content, Enablement         (placeholders)
//   Agents
// Live sections route to real pages; placeholders route to a "coming soon"
// scaffold so the full IA is visible and navigable now.
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: 240, minWidth: 240, background: "var(--sb)", color: "var(--sb-text)", display: "flex", flexDirection: "column", padding: "16px 0" }}>
        <div style={{ padding: "0 16px 18px", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ac)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>S</span>
          <span style={{ color: "#fff", fontSize: 15, fontWeight: 680, letterSpacing: "-0.02em" }}>SingleStack</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {/* Command center home */}
          <a href="/" style={{ ...itemStyle(isActive("/")), marginBottom: 14 }}>
            <span>Overview</span>
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
          <div style={{ marginBottom: 14 }}>
            <a href="/agents" style={itemStyle(isActive("/agents"))}>
              <span>Agents</span>
            </a>
          </div>
        </div>

        <div style={{ padding: "12px 16px 0", borderTop: "1px solid var(--sb-border)", margin: "0 8px" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--sb-text-dim)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email ?? ""}</div>
          <button onClick={signOut} style={{ background: "transparent", border: "1px solid var(--sb-border)", color: "var(--sb-text)", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, width: "100%" }}>Sign out</button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ height: 52, minHeight: 52, background: "var(--panel)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 24px", gap: 6 }}>
          {trail.map((c, i) => (
            <span key={i} className="row" style={{ gap: 6 }}>
              {i > 0 && <span className="t-muted" style={{ fontSize: 13 }}>/</span>}
              {c.href ? <a href={c.href} className="t-sub" style={{ fontWeight: 600 }}>{c.label}</a> : <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>}
            </span>
          ))}
        </header>
        <main style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto", width: "100%", padding: "28px 28px 64px" }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
