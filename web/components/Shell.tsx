"use client";

// App shell with a FOUNDATION tree in the sidebar. The Foundation is the
// product's canonical truth; Product records and their GTM records are
// navigable children beneath it — so you keep the whole structure in view while
// drilling into any layer. The tree is fetched live (session-scoped via RLS).
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useCallback, type ReactNode } from "react";

type Product = { id: string; name: string };
type Gtm = { id: string; name: string; product_id: string };

export type Crumb = { label: string; href?: string };

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

  const [products, setProducts] = useState<Product[]>([]);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const [{ data: p }, { data: g }] = await Promise.all([
      supabase.from("product_records").select("id, name").order("created_at", { ascending: false }),
      supabase.from("gtm_records").select("id, name, product_id").order("created_at"),
    ]);
    setProducts(p ?? []);
    setGtm(g ?? []);
    // auto-expand the product whose page (or whose GTM child) is active
    const next: Record<string, boolean> = {};
    (p ?? []).forEach((prod) => {
      const onProduct = pathname === `/records/${prod.id}`;
      const childActive = (g ?? []).some((x) => x.product_id === prod.id && pathname === `/gtm/${x.id}`);
      if (onProduct || childActive) next[prod.id] = true;
    });
    setExpanded((e) => ({ ...next, ...e }));
  }, [supabase, pathname]);

  useEffect(() => { load(); }, [load]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const trail: Crumb[] = crumbs ?? [{ label: "Foundation" }];
  const childrenOf = (pid: string) => gtm.filter((g) => g.product_id === pid);
  const navItem = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 7,
    fontSize: 13, fontWeight: 600, color: active ? "#fff" : "var(--sb-text)",
    background: active ? "var(--sb-fill)" : "transparent", cursor: "pointer", width: "100%",
    textAlign: "left", border: "none", letterSpacing: "-0.005em",
  });

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: 248, minWidth: 248, background: "var(--sb)", color: "var(--sb-text)", display: "flex", flexDirection: "column", padding: "16px 0" }}>
        <div style={{ padding: "0 16px 16px", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ac)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>S</span>
          <span style={{ color: "#fff", fontSize: 15, fontWeight: 680, letterSpacing: "-0.02em" }}>SingleStack</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {/* Foundation root */}
          <a href="/" style={navItem(pathname === "/")}>
            <span style={{ fontSize: 14 }}>◆</span> Foundation
          </a>

          {/* Product tree */}
          <div style={{ marginTop: 4 }}>
            {products.length === 0 && (
              <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--sb-text-dim)" }}>No products yet</div>
            )}
            {products.map((p) => {
              const kids = childrenOf(p.id);
              const open = expanded[p.id];
              const active = pathname === `/records/${p.id}`;
              return (
                <div key={p.id} style={{ marginLeft: 6 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <button onClick={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}
                      style={{ background: "none", border: "none", color: "var(--sb-text-dim)", width: 18, cursor: "pointer", fontSize: 10, flexShrink: 0 }}
                      aria-label={open ? "collapse" : "expand"}>
                      {kids.length > 0 ? (open ? "▾" : "▸") : "·"}
                    </button>
                    <a href={`/records/${p.id}`} style={{ ...navItem(active), padding: "6px 8px" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ac)", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </a>
                  </div>
                  {open && kids.map((k) => (
                    <a key={k.id} href={`/gtm/${k.id}`} style={{ ...navItem(pathname === `/gtm/${k.id}`), padding: "5px 8px 5px 30px", fontWeight: 500, fontSize: 12.5 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--vl)", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}</span>
                    </a>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Agents */}
          <a href="/agents" style={{ ...navItem(pathname === "/agents"), marginTop: 10 }}>
            <span style={{ fontSize: 13 }}>✦</span> Agents
          </a>
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
          <div style={{ maxWidth: 980, margin: "0 auto", width: "100%", padding: "28px 24px 64px" }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
