"use client";

// App shell: a calm near-black sidebar + a light topbar with breadcrumbs.
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { key: "records", label: "Records", href: "/" },
  { key: "agents", label: "Agents", href: "/agents" },
];

export type Crumb = { label: string; href?: string };

export default function Shell({
  children,
  email,
  active,
  crumbs,
}: {
  children: ReactNode;
  email?: string | null;
  active?: string;
  crumbs?: Crumb[];
}) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const trail: Crumb[] = crumbs ?? [{ label: NAV.find((n) => n.key === active)?.label ?? "SingleStack" }];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 224, minWidth: 224, background: "var(--sb)", color: "var(--sb-text)",
          display: "flex", flexDirection: "column", padding: "18px 0",
        }}
      >
        <div style={{ padding: "0 18px 20px", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6, background: "var(--ac)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 13,
          }}>S</span>
          <span style={{ color: "#fff", fontSize: 15, fontWeight: 650, letterSpacing: "-0.02em" }}>SingleStack</span>
        </div>

        <nav style={{ flex: 1, padding: "0 10px" }}>
          {NAV.map((n) => {
            const on = active === n.key;
            return (
              <a key={n.key} href={n.href}
                style={{
                  display: "flex", alignItems: "center", padding: "8px 10px", marginBottom: 2,
                  borderRadius: 7, fontSize: 13.5, fontWeight: 600,
                  color: on ? "#fff" : "var(--sb-text)",
                  background: on ? "var(--sb-fill)" : "transparent",
                }}>
                {n.label}
              </a>
            );
          })}
        </nav>

        <div style={{ padding: "12px 18px 0", borderTop: "1px solid var(--sb-border)", margin: "0 8px" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--sb-text-dim)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email ?? ""}
          </div>
          <button onClick={signOut}
            style={{
              background: "transparent", border: "1px solid var(--sb-border)", color: "var(--sb-text)",
              borderRadius: 6, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, width: "100%",
            }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            height: 52, minHeight: 52, background: "var(--panel)", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", padding: "0 24px", gap: 6,
          }}
        >
          {trail.map((c, i) => (
            <span key={i} className="row gap-2" style={{ gap: 6 }}>
              {i > 0 && <span className="t-muted" style={{ fontSize: 13 }}>/</span>}
              {c.href ? (
                <a href={c.href} className="t-sub" style={{ fontWeight: 600 }}>{c.label}</a>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
              )}
            </span>
          ))}
        </header>
        <main style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 960, margin: "0 auto", width: "100%", padding: "28px 24px 64px" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
