"use client";

// Agent detail with tabs: Overview (identity + prompt), Skills (attach reusable
// capabilities), Connections (internal data areas + external MCP), Workflows
// (saved tasks). Everything org-scoped via RLS.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, BackLink, Empty } from "@/components/ui";

type Agent = { id: string; key: string; name: string; role: string | null; model: string | null; system_prompt: string | null; is_active: boolean };
type Skill = { id: string; key: string; name: string; description: string | null; category: string | null };
type Connection = { id: string; kind: string; label: string; area: string | null; mcp_url: string | null; status: string; config: { purpose?: string | null } | null };
type Workflow = { id: string; name: string; description: string | null; trigger: string; target_type: string | null; is_active: boolean; last_run_at: string | null };

type Tab = "overview" | "skills" | "connections" | "workflows";

const INTERNAL_AREAS = [
  { area: "products", label: "Product records" },
  { area: "gtm", label: "GTM records" },
  { area: "signals", label: "Signals" },
  { area: "records", label: "All records" },
];

export default function AgentDetail({ agentId }: { agentId: string }) {
  const supabase = createClient();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("agents").select("id, key, name, role, model, system_prompt, is_active").eq("id", agentId).maybeSingle();
    const [{ data: sk }, { data: as }, { data: cs }, { data: wf }] = await Promise.all([
      supabase.from("skills").select("id, key, name, description, category").order("name"),
      supabase.from("agent_skills").select("skill_id").eq("agent_id", agentId),
      supabase.from("connections").select("id, kind, label, area, mcp_url, status, config").eq("agent_id", agentId).order("created_at"),
      supabase.from("workflows").select("id, name, description, trigger, target_type, is_active, last_run_at").eq("agent_id", agentId).order("created_at"),
    ]);
    setAgent(a); setSkills(sk ?? []); setAttached(new Set((as ?? []).map((x) => x.skill_id)));
    setConnections(cs ?? []); setWorkflows(wf ?? []); setLoading(false);
  }, [supabase, agentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (!agent) return <Empty title="Agent not found" />;

  const TABS: [Tab, string, number][] = [
    ["overview", "Overview", 0],
    ["skills", "Skills", attached.size],
    ["connections", "Connections", connections.length],
    ["workflows", "Workflows", workflows.length],
  ];

  return (
    <div>
      <BackLink href="/agents" label="Agents" />
      <div className="row gap-2" style={{ marginBottom: 6 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--ac)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{agent.name.slice(0, 2).toUpperCase()}</span>
        <Chip>{agent.key}</Chip>
        {!agent.is_active && <Chip tone="amber">inactive</Chip>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 2 }}>{agent.name}</h1>
      <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-5)" }}>{agent.role || "Agent"} · <span className="mono" style={{ fontSize: 12 }}>{agent.model}</span></div>

      <Banner>{error}</Banner>

      {/* tabs */}
      <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
        {TABS.map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--ac)" : "2px solid transparent", color: tab === k ? "var(--tp)" : "var(--ts)", fontWeight: 640, fontSize: 13.5, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}>
            {label}{count > 0 ? ` · ${count}` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview agent={agent} onSaved={load} setError={setError} />}
      {tab === "skills" && <Skills agentId={agentId} skills={skills} attached={attached} reload={load} setError={setError} />}
      {tab === "connections" && <Connections agentId={agentId} connections={connections} reload={load} setError={setError} />}
      {tab === "workflows" && <Workflows agentId={agentId} workflows={workflows} reload={load} setError={setError} />}
    </div>
  );
}

// ---------- Overview ----------
function Overview({ agent, onSaved, setError }: { agent: Agent; onSaved: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [prompt, setPrompt] = useState(agent.system_prompt ?? "");
  const [role, setRole] = useState(agent.role ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    const { error } = await supabase.from("agents").update({ system_prompt: prompt, role }).eq("id", agent.id);
    if (error) setError(error.message); else onSaved();
    setBusy(false);
  }
  return (
    <Section label="Identity & instructions">
      <div className="card card-pad">
        <label className="field"><span className="t-label">Role</span>
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="What this agent is responsible for" /></label>
        <label className="field"><span className="t-label">System prompt</span>
          <textarea className="textarea" rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Section>
  );
}

// ---------- Skills ----------
function Skills({ agentId, skills, attached, reload, setError }: { agentId: string; skills: Skill[]; attached: Set<string>; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", instructions: "", category: "general" });
  const [busy, setBusy] = useState(false);

  async function toggle(skillId: string, on: boolean) {
    setError(null);
    if (on) {
      const orgId = await getOrgId();
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: skillId });
    } else {
      await supabase.from("agent_skills").delete().eq("agent_id", agentId).eq("skill_id", skillId);
    }
    reload();
  }

  async function createSkill(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const key = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
      const { data, error } = await supabase.from("skills").insert({ org_id: orgId, key, name: form.name.trim(), description: form.description.trim() || null, instructions: form.instructions.trim() || null, category: form.category }).select("id").single();
      if (error) throw error;
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: data.id });
      setCreating(false); setForm({ name: "", description: "", instructions: "", category: "general" });
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create skill."); }
    finally { setBusy(false); }
  }

  return (
    <Section label="Skills" action={!creating ? <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New skill</button> : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Reusable, tailorable capabilities. Attach what this agent should be able to do; author your own playbooks tailored to your company. (Importing from GitHub comes with the marketplace.)</div>

      {creating && (
        <form onSubmit={createSkill} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Competitive teardown" /></label>
            <label className="field"><span className="t-label">Category</span>
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
              </select></label>
          </div>
          <label className="field"><span className="t-label">Description</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it does" /></label>
          <label className="field"><span className="t-label">Instructions / playbook</span><textarea className="textarea" rows={5} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="How the agent should apply this skill, tailored to your company and goals." /></label>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create & attach"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {skills.length === 0 && !creating ? <Empty title="No skills yet" hint="Create a skill to give this agent a reusable capability." action={<button className="btn" onClick={() => setCreating(true)}>+ New skill</button>} /> : (
        <div className="stack-3">
          {skills.map((s) => {
            const on = attached.has(s.id);
            return (
              <div key={s.id} className="card card-pad row-between" style={{ gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-2"><span style={{ fontSize: 14, fontWeight: 620 }}>{s.name}</span><Chip tone={s.category === "product" ? "accent" : s.category === "gtm" ? "violet" : "default"}>{s.category}</Chip></div>
                  {s.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{s.description}</div>}
                </div>
                <button className={`btn btn-sm ${on ? "btn-secondary" : ""}`} onClick={() => toggle(s.id, !on)}>{on ? "Attached ✓" : "Attach"}</button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------- Connections ----------
function Connections({ agentId, connections, reload, setError }: { agentId: string; connections: Connection[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [mcp, setMcp] = useState({ label: "", url: "", purpose: "" });
  const [busy, setBusy] = useState(false);

  const haveArea = (area: string) => connections.some((c) => c.kind === "internal" && c.area === area);

  async function addInternal(area: string, label: string) {
    setError(null);
    const orgId = await getOrgId();
    if (!orgId) return;
    await supabase.from("connections").insert({ org_id: orgId, agent_id: agentId, kind: "internal", label, area, status: "connected" });
    reload();
  }
  async function addMcp(e: React.FormEvent) {
    e.preventDefault(); if (!mcp.label.trim() || !mcp.url.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      await supabase.from("connections").insert({
        org_id: orgId, agent_id: agentId, kind: "mcp", label: mcp.label.trim(), mcp_url: mcp.url.trim(),
        status: "manual", config: { purpose: mcp.purpose.trim() || null },
      });
      setMcp({ label: "", url: "", purpose: "" }); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add connection."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("connections").delete().eq("id", id); reload(); }

  return (
    <>
      <Section label="Internal data">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Give this agent access to areas of SingleStack to reason over.</div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {INTERNAL_AREAS.map((a) => (
            <button key={a.area} className={`btn btn-sm ${haveArea(a.area) ? "btn-secondary" : ""}`} disabled={haveArea(a.area)} onClick={() => addInternal(a.area, a.label)}>
              {haveArea(a.area) ? `${a.label} ✓` : `+ ${a.label}`}
            </button>
          ))}
        </div>
      </Section>

      <Section label="External tools (MCP)">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Connect an MCP server so this agent can use external tools (web search, GitHub, your own). Live execution + auth arrive with the connector runtime; declared here now.</div>
        <form onSubmit={addMcp} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" value={mcp.label} onChange={(e) => setMcp({ ...mcp, label: e.target.value })} placeholder="e.g. Web search" /></label>
            <label className="field"><span className="t-label">MCP server URL</span><input className="input mono" value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} placeholder="https://…/mcp" /></label>
          </div>
          <label className="field"><span className="t-label">What it does in SingleStack</span>
            <input className="input" value={mcp.purpose} onChange={(e) => setMcp({ ...mcp, purpose: e.target.value })} placeholder="e.g. Pulls competitor releases into external signals; used by the CRO agent for battlecards." /></label>
          <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "+ Add MCP connection"}</button>
        </form>
      </Section>

      <Section label="Connected">
        {connections.length === 0 ? <div className="t-sub t-muted">No connections yet.</div> : (
          <div className="stack-3">
            {connections.map((c) => (
              <div key={c.id} className="card card-pad row-between" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-2">
                    <Chip tone={c.kind === "internal" ? "accent" : "violet"}>{c.kind === "internal" ? "internal" : "MCP"}</Chip>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>
                    <Chip tone={c.status === "connected" ? "green" : "default"}>{c.status === "connected" ? "live" : "declared"}</Chip>
                  </div>
                  {c.mcp_url && <div className="mono t-muted" style={{ fontSize: 11, marginTop: 4 }}>{c.mcp_url}</div>}
                  {c.config?.purpose && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 4 }}>{c.config.purpose}</div>}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => remove(c.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ---------- Workflows ----------
function Workflows({ agentId, workflows, reload, setError }: { agentId: string; workflows: Workflow[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", trigger: "manual" });
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: agentId, name: form.name.trim(), description: form.description.trim() || null, trigger: form.trigger });
      if (error) throw error;
      setCreating(false); setForm({ name: "", description: "", trigger: "manual" }); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workflow."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("workflows").delete().eq("id", id); reload(); }

  return (
    <Section label="Workflows" action={!creating ? <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New workflow</button> : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Saved tasks this agent runs — on demand, on a schedule, or when a signal lands. (Manual run today; scheduled & signal triggers execute once the runtime ships.)</div>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekly competitive refresh" /></label>
          <label className="field"><span className="t-label">Description</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it does" /></label>
          <label className="field"><span className="t-label">Trigger</span>
            <select className="select" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              <option value="manual">Manual (run on demand)</option><option value="scheduled">Scheduled</option><option value="on_signal">When a signal lands</option>
            </select></label>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {workflows.length === 0 && !creating ? <Empty title="No workflows yet" hint="Create a saved task for this agent." action={<button className="btn" onClick={() => setCreating(true)}>+ New workflow</button>} /> : (
        <div className="stack-3">
          {workflows.map((w) => (
            <div key={w.id} className="card card-pad row-between">
              <div>
                <div className="row gap-2"><span style={{ fontSize: 14, fontWeight: 620 }}>{w.name}</span><Chip>{w.trigger}</Chip>{!w.is_active && <Chip tone="amber">paused</Chip>}</div>
                {w.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{w.description}</div>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => remove(w.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
