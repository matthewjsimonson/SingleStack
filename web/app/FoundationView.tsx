"use client";

// Overview — the command center. Not just a record list: a live view of what's
// happening across the Foundation (your agent team, pending proposals needing
// you, recent activity) plus quick actions. The natural-language bar is an
// honest first step — it routes intent to the right place; full agentic
// execution is a later layer.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Section, Chip, Confidence } from "@/components/ui";
import ExecutiveRow from "@/components/ExecutiveRow";

type Agent = { id: string; key: string; name: string; role: string | null };
type Run = { id: string; status: string; model: string | null; cost_usd: number | null; started_at: string; agent_id: string };
type Pending = { id: string; title: string; conf_label: string | null; conf_level: number | null; product_id: string | null; gtm_record_id: string | null };
type Product = { id: string; name: string };
type Gtm = { id: string; name: string };

export default function FoundationView() {
  const router = useRouter();
  const supabase = createClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [gtm, setGtm] = useState<Gtm[]>([]);
  const [totals, setTotals] = useState({ products: 0, gtm: 0, signals: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [{ data: ags }, { data: rns }, { data: prps }, { data: prods }, { data: gtms }, { count: sig }] = await Promise.all([
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("agent_runs").select("id, status, model, cost_usd, started_at, agent_id").order("started_at", { ascending: false }).limit(6),
      supabase.from("proposals").select("id, title, conf_label, conf_level, product_id, gtm_record_id").eq("status", "pending").order("created_at", { ascending: false }).limit(8),
      supabase.from("product_records").select("id, name"),
      supabase.from("gtm_records").select("id, name"),
      supabase.from("signals").select("id", { count: "exact", head: true }),
    ]);
    setAgents(ags ?? []); setRuns(rns ?? []); setPending(prps ?? []);
    setProducts(prods ?? []); setGtm(gtms ?? []);
    setTotals({ products: (prods ?? []).length, gtm: (gtms ?? []).length, signals: sig ?? 0, pending: (prps ?? []).length });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";
  const proposalHref = (p: Pending) => p.product_id ? `/records/${p.product_id}` : p.gtm_record_id ? `/gtm/${p.gtm_record_id}` : "/";
  const targetName = (p: Pending) =>
    p.product_id ? (products.find((x) => x.id === p.product_id)?.name ?? "product")
      : p.gtm_record_id ? (gtm.find((x) => x.id === p.gtm_record_id)?.name ?? "GTM record") : "";

  // NL bar: route obvious intents; otherwise point to where the action lives.
  function runIntent(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim().toLowerCase();
    if (!t) return;
    if (t.includes("product")) router.push("/products");
    else if (t.includes("gtm") || t.includes("messaging") || t.includes("go-to-market")) router.push("/gtm");
    else if (t.includes("agent")) router.push("/agents");
    else router.push("/products");
  }

  return (
    <div>
      <PageHeader title="Overview" meta="Your command center — agents, what needs you, and what's moving." />

      {/* NL action bar */}
      <form onSubmit={runIntent} className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: "var(--sp-6)" }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--ac-fill)", color: "var(--ac-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>⌘</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask or act — e.g. “new product record”, “review pending proposals”, “add an agent”…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", color: "var(--tp)" }} />
        <button className="btn btn-sm" type="submit">Go</button>
      </form>

      {/* stats */}
      {!loading && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-6)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-4)" }}>
          <Stat n={totals.products} label="Products" href="/products" />
          <Stat n={totals.gtm} label="GTM records" href="/gtm" />
          <Stat n={totals.signals} label="Signals" />
          <Stat n={totals.pending} label="Pending proposals" accent={totals.pending > 0} />
        </div>
      )}

      {/* Executive team */}
      <ExecutiveRow />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--sp-6)", alignItems: "start" }}>
        {/* Needs you: pending proposals */}
        <Section label="Needs your review">
          {loading ? <div className="t-sub t-muted">Loading…</div>
            : pending.length === 0 ? <div className="t-sub t-muted">Nothing pending. Agents will surface proposals here as they run.</div>
            : (
              <div className="stack-3">
                {pending.map((p) => (
                  <a key={p.id} href={proposalHref(p)} className="card card-link card-pad">
                    <div className="row-between" style={{ gap: 10, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 620, marginBottom: 3 }}>{p.title}</div>
                        <div className="t-sub t-muted" style={{ fontSize: 12 }}>{targetName(p)}</div>
                      </div>
                      <Confidence label={p.conf_label} level={p.conf_level} />
                    </div>
                  </a>
                ))}
              </div>
            )}
        </Section>

        {/* Your team + recent activity */}
        <div>
          <Section label="Your team">
            {agents.length === 0 ? (
              <a href="/agents" className="card card-link card-pad t-sub" style={{ color: "var(--ac-text)", fontWeight: 600 }}>+ Set up your first agent →</a>
            ) : (
              <div className="stack-3">
                {agents.map((a) => (
                  <a key={a.id} href="/agents" className="card card-link" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--ac-fill)", color: "var(--ac-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {a.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 620, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div className="t-sub t-muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role || "Agent"}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Section>

          <Section label="Recent activity">
            {runs.length === 0 ? <div className="t-sub t-muted">No agent runs yet.</div>
              : (
                <div className="card">
                  {runs.map((r, i) => (
                    <div key={r.id} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: r.status === "succeeded" ? "var(--gn)" : r.status === "failed" ? "var(--rd-text)" : "var(--am-text)" }} />
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentName(r.agent_id)}</span>
                      <span className="t-mono-xs">{new Date(r.started_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, href, accent }: { n: number; label: string; href?: string; accent?: boolean }) {
  const inner = (
    <div className="stat">
      <span className="stat-num" style={{ color: accent ? "var(--vl-text)" : undefined }}>{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
  return href ? <a href={href} style={{ display: "block" }}>{inner}</a> : inner;
}
