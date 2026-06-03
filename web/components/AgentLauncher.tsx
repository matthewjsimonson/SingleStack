"use client";

// Global advisors control. Lives in the top bar on every page. Opens a small
// menu of the officers most relevant to WHERE you are (Product pages → CPO +
// Chief Eng; GTM pages → CRO + CCO; intelligence/home → the whole team), and
// hands the chosen officer the CONTEXT of what you're looking at (the record,
// its type, its name) so the conversation is grounded in it. The agent itself
// is further scoped server-side by its connected areas + attached skills.
import { useEffect, useMemo, useState } from "react";
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
  const [exec, setExec] = useState<Exec | null>(null);
  const [recordName, setRecordName] = useState<string | null>(null);

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

  const context: AgentContext = { ...derived.context, record_name: recordName ?? undefined };

  // Advisors live IN the bar as an avatar strip — the officers relevant to where
  // you are, each one click from a grounded conversation. No dropdown, no wasted
  // movement.
  return (
    <div className="row" style={{ alignItems: "center", gap: 6, paddingLeft: 12, marginLeft: 4, borderLeft: "1px solid var(--border)" }}>
      <span className="t-label" style={{ color: "var(--tm)" }}>Advisors</span>
      <div className="row" style={{ gap: 4 }}>
        {team.map((e) => (
          <button key={e.key} onClick={() => setExec(e)} title={`${e.name} — ${e.role}`} aria-label={`Ask ${e.name}`}
            style={{ width: 28, height: 28, borderRadius: 8, background: e.accent, color: "#fff", border: "none", cursor: "pointer", fontWeight: 800, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {e.short}
          </button>
        ))}
      </div>
      <AgentDrawer exec={exec} open={!!exec} onClose={() => setExec(null)} context={context} />
    </div>
  );
}
