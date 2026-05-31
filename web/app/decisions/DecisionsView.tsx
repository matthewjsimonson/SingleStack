"use client";

// Decisions — where synthesized intel becomes a committed call. A decision is a
// bet decided among OPTIONS (each with tradeoffs), backed by cited evidence, and
// routable to Ship. This list groups by status: Open (awaiting a call), Decided
// (chosen, not yet routed), Routed (a build item exists). Pointed, not a feed.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Decision = { id: string; title: string; question: string | null; status: string; scope: string; owner: string | null; theme_id: string | null; created_at: string };

const STATUS_TONE: Record<string, "default" | "accent" | "green"> = { open: "accent", decided: "default", routed: "green" };
const STATUS_GROUPS: [string, string][] = [["open", "Open — awaiting a call"], ["decided", "Decided"], ["routed", "Routed to Ship"]];

export default function DecisionsView() {
  const supabase = createClient();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("decisions").select("id, title, question, status, scope, owner, theme_id, created_at").order("created_at", { ascending: false });
    if (error) setError(error.message);
    setDecisions(data ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      await supabase.from("decisions").insert({ org_id: orgId, title: title.trim(), scope: "org", status: "open" });
      setTitle(""); setCreating(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Decisions"
        meta="Where intel becomes a committed call — decided among options with tradeoffs, backed by evidence, routed to Ship."
        actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New decision</button> : undefined}
      />
      <Banner>{error}</Banner>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">What are you deciding?</span>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How we answer post-demo pricing friction" /></label>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : decisions.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No decisions yet</div>
          <div className="t-sub" style={{ maxWidth: 520, marginInline: "auto" }}>Synthesize signals into themes, then turn a theme into a decision — or start one here. Each decision weighs options with tradeoffs and can spawn a build item in Ship.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--sp-6)" }}>
          {STATUS_GROUPS.map(([status, label]) => {
            const group = decisions.filter((d) => d.status === status);
            if (group.length === 0) return null;
            return (
              <Section key={status} label={`${label} · ${group.length}`}>
                <div className="stack-3">
                  {group.map((d) => (
                    <Link key={d.id} href={`/decisions/${d.id}`} className="card card-pad" style={{ display: "block", color: "inherit", textDecoration: "none" }}>
                      <div className="row-between" style={{ alignItems: "baseline" }}>
                        <span style={{ fontSize: 14, fontWeight: 640 }}>{d.title}</span>
                        <Chip tone={STATUS_TONE[d.status] ?? "default"}>{d.status}</Chip>
                      </div>
                      {d.question && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{d.question}</div>}
                      <div className="row gap-2" style={{ marginTop: 8 }}>
                        <Chip>{d.scope}</Chip>
                        {d.theme_id && <Chip tone="violet">from theme</Chip>}
                        {d.owner && <span className="t-sub t-muted" style={{ fontSize: 11 }}>· {d.owner}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}
