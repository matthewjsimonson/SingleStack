"use client";

// Global advisors control. Lives in the top bar on every page. Opens a small
// menu of the officers most relevant to WHERE you are (Product pages → CPO +
// Chief Eng; GTM pages → CRO + CCO; intelligence/home → the whole team), and
// hands the chosen officer the CONTEXT of what you're looking at (the record,
// its type, its name) so the conversation is grounded in it. The agent itself
// is further scoped server-side by its connected areas + attached skills.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EXECUTIVE_TEAM, EXEC_BY_KEY, type Exec } from "@/lib/team";
import AgentDrawer, { type AgentContext } from "@/components/AgentDrawer";

// Which officers are most relevant on each part of the app.
const PRODUCT_TEAM = ["cpo", "ceng"];
const GTM_TEAM = ["cro", "cco"];

type Derived = { context: AgentContext; team: string[]; place: string };

function deriveFromPath(pathname: string): Derived {
  // Record detail pages carry a focusable record id in the URL.
  const productMatch = pathname.match(/^\/records\/([0-9a-f-]+)/i);
  const gtmMatch = pathname.match(/^\/gtm\/([0-9a-f-]+)/i);
  if (productMatch) return { context: { area: "products", record_type: "product", record_id: productMatch[1] }, team: PRODUCT_TEAM, place: "this product record" };
  if (gtmMatch) return { context: { area: "gtm", record_type: "gtm", record_id: gtmMatch[1] }, team: GTM_TEAM, place: "this GTM record" };

  if (pathname.startsWith("/products") || pathname.startsWith("/roadmap") || pathname.startsWith("/ship")) return { context: { area: "products" }, team: PRODUCT_TEAM, place: "your product" };
  if (pathname.startsWith("/gtm") || pathname.startsWith("/content") || pathname.startsWith("/campaigns") || pathname.startsWith("/enablement")) return { context: { area: "gtm" }, team: GTM_TEAM, place: "your go-to-market" };
  if (pathname.startsWith("/signals") || pathname.startsWith("/competitive") || pathname.startsWith("/market")) return { context: { area: "signals" }, team: EXECUTIVE_TEAM.map((e) => e.key), place: "your intelligence" };

  return { context: {}, team: EXECUTIVE_TEAM.map((e) => e.key), place: "your workspace" };
}

export default function AgentLauncher() {
  const pathname = usePathname();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [exec, setExec] = useState<Exec | null>(null);
  const [recordName, setRecordName] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const derived = useMemo(() => deriveFromPath(pathname), [pathname]);
  const team = derived.team.map((k) => EXEC_BY_KEY[k]).filter(Boolean);

  // When focused on a record, fetch its name so the drawer can show + ground it.
  useEffect(() => {
    const { record_id, record_type } = derived.context;
    if (!record_id || !record_type) { setRecordName(null); return; }
    let cancelled = false;
    (async () => {
      const table = record_type === "product" ? "product_records" : "gtm_records";
      const { data } = await supabase.from(table).select("name").eq("id", record_id).maybeSingle();
      if (!cancelled) setRecordName(data?.name ?? null);
    })();
    return () => { cancelled = true; };
  }, [derived.context, supabase]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const context: AgentContext = { ...derived.context, record_name: recordName ?? undefined };

  // Advisors: a dropdown in the bar. The trigger names the count of officers
  // relevant to where you are; the menu opens to a grounded conversation.
  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", alignItems: "center", paddingLeft: 12, marginLeft: 4, borderLeft: "1px solid var(--border)" }}>
      <button onClick={() => setMenuOpen((v) => !v)} className="btn btn-secondary btn-sm"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }} aria-haspopup="menu" aria-expanded={menuOpen}>
        Advisors
        <span style={{ fontSize: 10, color: "var(--tm)" }}>▾</span>
      </button>

      {menuOpen && (
        <div role="menu" style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, width: 300, zIndex: 50,
          background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-md)", overflow: "hidden",
        }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)" }}>
            <div className="t-label" style={{ color: "var(--tm)" }}>Advise on</div>
            <div style={{ fontSize: 13, fontWeight: 640 }}>{recordName ?? derived.place}</div>
          </div>
          <div style={{ padding: 6 }}>
            {team.map((e) => (
              <button key={e.key} role="menuitem" onClick={() => { setExec(e); setMenuOpen(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", background: "none", border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left" }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--fill)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "none")}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: e.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{e.short}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 620 }}>{e.name}</span>
                  <span className="t-sub t-muted" style={{ display: "block", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.role}</span>
                </span>
              </button>
            ))}
          </div>
          <a href="/agents" style={{ display: "block", padding: "9px 14px", borderTop: "1px solid var(--border)", fontSize: 12.5, fontWeight: 600, color: "var(--ac-text)" }}>Manage agents & skills →</a>
        </div>
      )}

      <AgentDrawer exec={exec} open={!!exec} onClose={() => setExec(null)} context={context} />
    </div>
  );
}
