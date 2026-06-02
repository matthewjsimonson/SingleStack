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
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Cap = { id: string; title: string; why: string | null; observed_at: string | null; metadata: { domain?: string; provider?: string; area?: string; url?: string } | null };
type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string };
type Workflow = { id: string; name: string; trigger: string; is_active: boolean; agent_id: string | null; skill_ids: string[] | null };

const PROVIDERS: { key: string; label: string; tone: "accent" | "violet" | "green" | "default" }[] = [
  { key: "anthropic", label: "Anthropic", tone: "accent" },
  { key: "openai", label: "OpenAI", tone: "green" },
  { key: "platform", label: "Platform", tone: "violet" },
  { key: "other", label: "Other", tone: "default" },
];

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function FrontierView() {
  const supabase = createClient();
  const [caps, setCaps] = useState<Cap[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [logging, setLogging] = useState(false);
  const [cap, setCap] = useState({ title: "", summary: "", provider: "anthropic", area: "", url: "" });
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
    setCaps(((sigs ?? []) as Cap[]).filter((s) => s.metadata?.domain === "capability"));
    setAgents(ag ?? []); setSkills(sk ?? []); setWorkflows((wfs ?? []) as Workflow[]);
    setWatchingIds(new Set((conns ?? []).map((c) => c.agent_id).filter(Boolean)));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const tone = (p?: string) => PROVIDERS.find((x) => x.key === p)?.tone ?? "default";
  const plabel = (p?: string) => PROVIDERS.find((x) => x.key === p)?.label ?? p ?? "—";
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "—";
  const skillName = (id: string) => skills.find((s) => s.id === id)?.name;
  function toggleSkill(id: string) { setWf((f) => ({ ...f, skill_ids: f.skill_ids.includes(id) ? f.skill_ids.filter((x) => x !== id) : [...f.skill_ids, id] })); }

  async function logCap(e: React.FormEvent) {
    e.preventDefault(); if (!cap.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: cap.title.trim(), why: cap.summary.trim() || null, observed_at: new Date().toISOString(),
        metadata: { domain: "capability", provider: cap.provider, area: cap.area.trim() || null, url: cap.url.trim() || null },
      });
      if (error) throw error;
      setLogging(false); setCap({ title: "", summary: "", provider: "anthropic", area: "", url: "" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log capability."); }
    finally { setBusy(false); }
  }

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
      <PageHeader title="Frontier models" meta="What's newly possible — frontier model & platform capabilities — and what your agents do about it. Connect agents to this area and set workflows so releases turn into action." />
      <Banner>{error}</Banner>

      {/* 1. Capabilities radar */}
      <Section label="Capabilities" action={<button className="btn btn-secondary btn-sm" onClick={() => setLogging((v) => !v)}>{logging ? "Cancel" : "+ Log capability"}</button>}>
        {logging && (
          <form onSubmit={logCap} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Capability</span><input className="input" autoFocus value={cap.title} onChange={(e) => setCap({ ...cap, title: e.target.value })} placeholder="e.g. Tool orchestration" /></label>
              <label className="field"><span className="t-label">Provider</span>
                <select className="select" value={cap.provider} onChange={(e) => setCap({ ...cap, provider: e.target.value })}>{PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Area</span><input className="input" value={cap.area} onChange={(e) => setCap({ ...cap, area: e.target.value })} placeholder="orchestration · coding · memory" /></label>
              <label className="field"><span className="t-label">Link (optional)</span><input className="input mono" value={cap.url} onChange={(e) => setCap({ ...cap, url: e.target.value })} placeholder="https://…" /></label>
            </div>
            <label className="field"><span className="t-label">What it is &amp; how we could leverage it</span><textarea className="textarea" rows={3} value={cap.summary} onChange={(e) => setCap({ ...cap, summary: e.target.value })} placeholder="Plain-English summary and the opportunity." /></label>
            <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Logging…" : "Log capability"}</button>
          </form>
        )}
        {loading ? <div className="t-sub t-muted">Loading…</div> : caps.length === 0 && !logging ? (
          <div className="t-sub t-muted">No capabilities tracked yet. Log a frontier or platform release and your agents can act on it.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--sp-3)" }}>
            {caps.map((c) => (
              <div key={c.id} className="card card-pad">
                <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                  <Chip tone={tone(c.metadata?.provider)}>{plabel(c.metadata?.provider)}</Chip>
                  {c.metadata?.area && <Chip>{c.metadata.area}</Chip>}
                  {c.observed_at && <span className="t-mono-xs" style={{ marginLeft: "auto" }}>{ago(c.observed_at)}</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 640, lineHeight: 1.35, marginBottom: 4 }}>{c.title}</div>
                {c.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 8 }}>{c.why}</div>}
                {c.metadata?.url && <a href={c.metadata.url} target="_blank" rel="noreferrer" className="t-sub" style={{ fontSize: 12, color: "var(--ac-text)", fontWeight: 600 }}>Details →</a>}
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
    </div>
  );
}
