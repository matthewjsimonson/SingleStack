"use client";

// Homepage — the command center. Chat/action bar, the executive team row, a row
// of dynamic KPI widgets (including "Needs your review" → opens a drawer), and
// tailored suggested-prompt widgets. Not a list of record counts — a useful,
// dynamic view of what's happening and what to do next.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Section } from "@/components/ui";
import ExecutiveRow from "@/components/ExecutiveRow";
import ReviewDrawer from "@/components/ReviewDrawer";

type Run = { id: string; status: string; started_at: string; cost_usd: number | null };

export default function FoundationView() {
  const router = useRouter();
  const supabase = createClient();
  const [stats, setStats] = useState({ pending: 0, runs7d: 0, signals7d: 0, fieldsCompletion: 0, cost30d: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    const now = Date.now();
    const d7 = new Date(now - 7 * 864e5).toISOString();
    const d30 = new Date(now - 30 * 864e5).toISOString();
    const [{ count: pending }, { data: runs }, { count: sig7 }, { data: fields }, { data: cost }] = await Promise.all([
      supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("agent_runs").select("id, status, started_at").gte("started_at", d7),
      supabase.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", d7),
      supabase.from("record_fields").select("value"),
      supabase.from("agent_runs").select("cost_usd").gte("started_at", d30),
    ]);
    const filled = (fields ?? []).filter((f) => f.value && (f.value as string).trim()).length;
    const total = (fields ?? []).length;
    const cost30d = (cost ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    setStats({
      pending: pending ?? 0,
      runs7d: (runs ?? []).length,
      signals7d: sig7 ?? 0,
      fieldsCompletion: total ? Math.round((filled / total) * 100) : 0,
      cost30d,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // open the review drawer if linked with ?review=1 (from a suggestion)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("review") === "1") {
      setReviewOpen(true);
    }
  }, []);

  function runIntent(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim().toLowerCase();
    if (!t) return;
    if (t.includes("review") || t.includes("proposal")) setReviewOpen(true);
    else if (t.includes("gtm") || t.includes("messaging")) router.push("/gtm");
    else if (t.includes("agent") || t.includes("brief")) router.push("/"); // exec row is here
    else if (t.includes("signal")) router.push("/signals");
    else router.push("/products");
  }

  // Suggested prompts — tailored to current state. (Heuristic today; will key off
  // role/company once that exists.)
  const suggestions = buildSuggestions(stats);

  return (
    <div>
      <PageHeader title="Homepage" meta="Your command center — what's moving, what needs you, and what to do next." />

      {/* chat / action bar */}
      <form onSubmit={runIntent} className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: "var(--sp-6)" }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--ac-fill)", color: "var(--ac-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>⌘</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask or act — e.g. “review pending proposals”, “open GTM records”, “brief me”…"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", color: "var(--tp)" }} />
        <button className="btn btn-sm" type="submit">Go</button>
      </form>

      {/* executive team */}
      <ExecutiveRow />

      {/* KPI widgets — dynamic, useful */}
      <Section label="At a glance">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-3)" }}>
          <Widget label="Needs review" value={loading ? "—" : String(stats.pending)} hint="pending proposals" accent={stats.pending > 0} onClick={() => setReviewOpen(true)} cta="Review →" />
          <Widget label="Agent activity" value={loading ? "—" : String(stats.runs7d)} hint="runs · last 7d" />
          <Widget label="New signals" value={loading ? "—" : String(stats.signals7d)} hint="last 7d" />
          <Widget label="Foundation filled" value={loading ? "—" : `${stats.fieldsCompletion}%`} hint="record completeness" ring={stats.fieldsCompletion} />
        </div>
      </Section>

      {/* suggested prompts */}
      <Section label="Suggested for you">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-3)" }}>
          {suggestions.map((s, i) => (
            <button key={i} className="card card-pad pop" style={{ textAlign: "left" }} onClick={s.action}>
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, background: s.tint, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{s.icon}</span>
                <span className="t-label" style={{ color: "var(--tm)" }}>{s.tag}</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>{s.text}</div>
            </button>
          ))}
        </div>
      </Section>

      <ReviewDrawer open={reviewOpen} onClose={() => setReviewOpen(false)} onChanged={load} />
    </div>
  );
}

function Widget({ label, value, hint, accent, onClick, cta, ring }: {
  label: string; value: string; hint: string; accent?: boolean; onClick?: () => void; cta?: string; ring?: number;
}) {
  const clickable = !!onClick;
  return (
    <div className={`card card-pad ${clickable ? "pop" : ""}`} onClick={onClick} style={{ cursor: clickable ? "pointer" : "default", display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="row-between">
        <span className="stat-label">{label}</span>
        {ring != null && <Ring pct={ring} />}
      </div>
      <span className="stat-num" style={{ color: accent ? "var(--vl-text)" : undefined }}>{value}</span>
      <span className="t-sub t-muted" style={{ fontSize: 12 }}>{hint}</span>
      {cta && <span style={{ color: "var(--ac-text)", fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{cta}</span>}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 8, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const color = pct === 100 ? "var(--gn)" : pct > 0 ? "var(--ac)" : "var(--border-strong)";
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--fill-2)" strokeWidth="2.5" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
    </svg>
  );
}

type Suggestion = { tag: string; text: string; icon: string; tint: string; action: () => void };
function buildSuggestions(stats: { pending: number; fieldsCompletion: number; signals7d: number }): Suggestion[] {
  // Note: client-side, so we build closures lazily via window.location for routing.
  const go = (href: string) => () => { window.location.href = href; };
  const list: Suggestion[] = [];
  if (stats.pending > 0)
    list.push({ tag: "Review", text: `Review ${stats.pending} pending proposal${stats.pending === 1 ? "" : "s"} and accept what's ready`, icon: "📝", tint: "var(--vl-fill)", action: go("/?review=1") });
  if (stats.fieldsCompletion < 70)
    list.push({ tag: "Foundation", text: "Fill out your product record — completeness is low", icon: "◆", tint: "var(--ac-fill)", action: go("/products") });
  list.push({ tag: "Product", text: "Ask the CPO agent to sharpen your positioning", icon: "✦", tint: "var(--ac-fill)", action: go("/") });
  list.push({ tag: "GTM", text: "Draft hero messaging for a GTM record", icon: "◈", tint: "var(--vl-fill)", action: go("/gtm") });
  if (stats.signals7d === 0)
    list.push({ tag: "Signals", text: "Connect a signal source to start informing your agents", icon: "📡", tint: "var(--gn-fill)", action: go("/signals") });
  return list.slice(0, 4);
}
