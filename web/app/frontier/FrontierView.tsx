"use client";

// Frontier Models — a dedicated space for what's newly POSSIBLE (frontier model
// & platform capabilities) and what the org does about it. Three parts:
//   1. Capabilities — the radar (logged as capability-domain signals).
//   2. Automated responses — workflows triggered on a new capability (agent +
//      skills), so a release can kick off a review/update.
//   3. Watching — which agents are connected to the frontier area and will act.
// Product-agnostic: nothing here assumes a particular product or company.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { signalDomain, SIGNAL_DOMAIN, groupByNode, sourceNameOf, sourceUrlOf, type NodeMeta } from "@/lib/signals";
import { Section, Chip, Banner } from "@/components/ui";
import CapabilityDrawer, { type DrawerCapability } from "@/components/CapabilityDrawer";
import SignalProfile from "@/components/SignalProfile";

type Cap = { id: string; title: string; why: string | null; observed_at: string | null; metadata: { domain?: string; provider?: string; area?: string; url?: string; node_key?: string; source?: string; channel?: string } | null };
type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string };
type Workflow = { id: string; name: string; trigger: string; is_active: boolean; agent_id: string | null; skill_ids: string[] | null };

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function FrontierView() {
  const supabase = createClient();
  const [caps, setCaps] = useState<Cap[]>([]);
  const [nodes, setNodes] = useState<NodeMeta[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCap, setOpenCap] = useState<DrawerCapability | null>(null);

  const [creatingWf, setCreatingWf] = useState(false);
  const [wf, setWf] = useState<{ name: string; agent_id: string; skill_ids: string[] }>({ name: "", agent_id: "", skill_ids: [] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: sigs }, { data: ag }, { data: sk }, { data: wfs }, { data: conns }] = await Promise.all([
      supabase.from("signals").select("id, title, why, observed_at, metadata").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("skills").select("id, name").order("name"),
      supabase.from("workflows").select("id, name, trigger, is_active, agent_id, skill_ids").eq("trigger", "on_capability_update").order("created_at"),
      supabase.from("connections").select("agent_id").eq("kind", "internal").eq("area", "capabilities"),
    ]);
    setCaps(((sigs ?? []) as Cap[]).filter((s) => signalDomain(s) === SIGNAL_DOMAIN.capability));
    setAgents(ag ?? []); setSkills(sk ?? []); setWorkflows((wfs ?? []) as Workflow[]);
    setWatchingIds(new Set((conns ?? []).map((c) => c.agent_id).filter(Boolean)));
    // The technology focus of the landscape profile — so capabilities group
    // under the node that pulled them.
    const { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "landscape").is("competitor_id", null).maybeSingle();
    if (prof) {
      const { data: ns } = await supabase.from("signal_profile_fields").select("field_key, label, weight, parent_key").eq("profile_id", prof.id).eq("vector", "technology");
      setNodes((ns ?? []) as NodeMeta[]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "—";
  const skillName = (id: string) => skills.find((s) => s.id === id)?.name;
  function toggleSkill(id: string) { setWf((f) => ({ ...f, skill_ids: f.skill_ids.includes(id) ? f.skill_ids.filter((x) => x !== id) : [...f.skill_ids, id] })); }

  async function createWf(e: React.FormEvent) {
    e.preventDefault(); if (!wf.name.trim() || !wf.agent_id) { setError("Name and an agent are required."); return; }
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("workflows").insert({
        org_id: orgId, agent_id: wf.agent_id, name: wf.name.trim(), trigger: "on_capability_update",
        function_key: "frontier", target_type: "none", skill_ids: wf.skill_ids,
      });
      if (error) throw error;
      setCreatingWf(false); setWf({ name: "", agent_id: "", skill_ids: [] }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workflow."); }
    finally { setBusy(false); }
  }
  async function removeWf(id: string) { setError(null); await supabase.from("workflows").delete().eq("id", id); await load(); }

  const watching = agents.filter((a) => watchingIds.has(a.id));

  return (
    <div>
      <Banner>{error}</Banner>

      {/* The technology vector of the central signals profile — the slice of
          the brain that aims this tab's discovery. Read-only here; tuned on
          the Signals home. */}
      <div style={{ marginBottom: "var(--sp-4)" }}>
        <SignalProfile scope="landscape" vectorFilter="technology" />
      </div>

      {/* 1. Capabilities radar — what the technology focus of your signals
          profile pulled in, grouped under the node that caught it. Setup
          lives on Signals. */}
      <Section label="Capabilities">
        {loading ? <div className="t-sub t-muted">Loading…</div> : caps.length === 0 ? (
          <div className="t-sub t-muted">No capabilities tracked yet. Set up the technology focus of your signals profile on <a href="/signals" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Signals</a> — its nodes aim the search, and releases they catch show up here.</div>
        ) : (
          <div className="stack-3">
            {groupByNode(caps, nodes).map((g) => (
              <div key={g.key}>
                <div className="row gap-2" style={{ marginBottom: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 680 }}>{g.label}</span>
                  <span className="t-sub t-muted" style={{ fontSize: 12 }}>{g.signals.length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: "var(--sp-3)" }}>
                  {g.signals.map((c) => {
                    const src = sourceNameOf(c);
                    return (
                      <div key={c.id} className="card card-pad card-link signal-card" style={{ cursor: "pointer" }} onClick={() => setOpenCap(c)} title="Drill in & leverage">
                        <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {c.metadata?.area && <Chip>{c.metadata.area}</Chip>}
                          {src && <span className="t-mono-xs t-muted">{src}</span>}
                          {c.observed_at && <span className="t-mono-xs" style={{ marginLeft: "auto" }}>{ago(c.observed_at)}</span>}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 640, lineHeight: 1.35, marginBottom: 4 }}>{c.title}</div>
                        {c.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 8 }}>{c.why}</div>}
                        <span className="t-sub" style={{ fontSize: 12, color: "var(--ac-text)", fontWeight: 600 }}>Drill in & leverage →</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2. Automated responses */}
      <Section label="Automated responses" action={<button className="btn btn-secondary btn-sm" onClick={() => { setCreatingWf((v) => !v); setError(null); }}>{creatingWf ? "Cancel" : "+ New workflow"}</button>}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Workflows that fire when a new capability lands — an agent + the skills it applies. (Triggers execute once the runtime ships; declared now.)</div>
        {creatingWf && (
          <form onSubmit={createWf} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Workflow</span><input className="input" autoFocus value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} placeholder="e.g. Review new capability for product impact" /></label>
              <label className="field"><span className="t-label">Run as agent</span>
                <select className="select" value={wf.agent_id} onChange={(e) => setWf({ ...wf, agent_id: e.target.value })}><option value="">Select…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            </div>
            {skills.length > 0 && (
              <div className="field"><span className="t-label">Skills it applies</span>
                <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 4 }}>{skills.map((s) => { const on = wf.skill_ids.includes(s.id); return <button type="button" key={s.id} onClick={() => toggleSkill(s.id)} className={`btn btn-sm ${on ? "" : "btn-secondary"}`}>{on ? "✓ " : ""}{s.name}</button>; })}</div>
              </div>
            )}
            <div className="row gap-2" style={{ marginTop: 8 }}><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add workflow"}</button></div>
          </form>
        )}
        {workflows.length === 0 && !creatingWf ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No automated responses yet. Add a workflow so a new capability triggers a review.</div>
        ) : (
          <div className="stack-3">
            {workflows.map((w) => (
              <div key={w.id} className="card card-pad row-between">
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}><span style={{ fontSize: 14, fontWeight: 620 }}>{w.name}</span><Chip tone="accent">on new capability</Chip>{!w.is_active && <Chip tone="amber">paused</Chip>}</div>
                  <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{agentName(w.agent_id)}{(w.skill_ids?.length ?? 0) > 0 ? ` · ${w.skill_ids!.map((id) => skillName(id)).filter(Boolean).join(", ")}` : ""}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => removeWf(w.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3. Watching */}
      <Section label="Agents watching frontier models">
        {watching.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No agents connected to this area yet. Connect agents on the <a href="/agents" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Agents</a> page (Connections → “Frontier models &amp; capabilities”) so they act on new capabilities in their own domain.</div>
        ) : (
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {watching.map((a) => <a key={a.id} href={`/agents/${a.id}`} className="chip chip-accent" style={{ textDecoration: "none" }}>{a.name}</a>)}
          </div>
        )}
      </Section>

      <CapabilityDrawer capability={openCap} onClose={() => setOpenCap(null)} onChanged={load} />
    </div>
  );
}
