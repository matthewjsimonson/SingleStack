"use client";

// Agent detail with tabs: Overview (identity + prompt), Skills (attach reusable
// capabilities), Connections (internal data areas + external MCP), Workflows
// (saved tasks). Everything org-scoped via RLS.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, BackLink, Empty, Modal } from "@/components/ui";
import PageBar from "@/components/PageBar";

type Agent = { id: string; key: string; name: string; role: string | null; model: string | null; system_prompt: string | null; is_active: boolean };
type Skill = { id: string; key: string; name: string; description: string | null; category: string | null };
type Connection = { id: string; kind: string; label: string; area: string | null; mcp_url: string | null; status: string; config: { purpose?: string | null } | null; targets: { type?: string; ref: string; label?: string }[] | null; guidance: string | null };
type Workflow = { id: string; name: string; description: string | null; trigger: string; target_type: string | null; is_active: boolean; last_run_at: string | null; skill_ids: string[] | null };
type InitiativeOpt = { id: string; title: string; stage: string | null; scope: string | null };
type WorkstreamOpt = { id: string; title: string; area: string | null; initiative_id: string; initiative_title?: string };
type Alignment = { id: string; role: string; guidance: string | null; initiative_id: string | null; workstream_id: string | null; title: string; kind: "initiative" | "task"; sub: string | null };

type Tab = "overview" | "skills" | "connections" | "alignment" | "workflows";

const INTERNAL_AREAS = [
  { area: "products", label: "Product records" },
  { area: "gtm", label: "GTM records" },
  { area: "signals", label: "Signals" },
  { area: "capabilities", label: "Frontier models & capabilities" },
  { area: "records", label: "All records" },
];

export default function AgentDetail({ agentId }: { agentId: string }) {
  const supabase = createClient();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [alignments, setAlignments] = useState<Alignment[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeOpt[]>([]);
  const [workstreams, setWorkstreams] = useState<WorkstreamOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("agents").select("id, key, name, role, model, system_prompt, is_active").eq("id", agentId).maybeSingle();
    const [{ data: sk }, { data: as }, { data: cs }, { data: wf }, { data: al }, { data: inits }, { data: ws }] = await Promise.all([
      supabase.from("skills").select("id, key, name, description, category").order("name"),
      supabase.from("agent_skills").select("skill_id").eq("agent_id", agentId),
      supabase.from("connections").select("id, kind, label, area, mcp_url, status, config, targets, guidance").eq("agent_id", agentId).order("created_at"),
      supabase.from("workflows").select("id, name, description, trigger, target_type, is_active, last_run_at, skill_ids").eq("agent_id", agentId).order("created_at"),
      supabase.from("agent_alignments").select("id, role, guidance, initiative_id, workstream_id, initiatives(title, stage), initiative_workstreams(title, area)").eq("agent_id", agentId).order("created_at"),
      supabase.from("initiatives").select("id, title, stage, scope").order("created_at", { ascending: false }).limit(200),
      supabase.from("initiative_workstreams").select("id, title, area, initiative_id").order("created_at", { ascending: false }).limit(400),
    ]);
    setAgent(a); setSkills(sk ?? []); setAttached(new Set((as ?? []).map((x) => x.skill_id)));
    setConnections(cs ?? []); setWorkflows(wf ?? []);
    const initById = new Map((inits ?? []).map((i) => [i.id, i.title]));
    // deno-lint-ignore no-explicit-any
    setAlignments(((al ?? []) as any[]).map((r) => r.workstream_id
      ? { id: r.id, role: r.role, guidance: r.guidance, initiative_id: r.initiative_id, workstream_id: r.workstream_id, kind: "task" as const, title: r.initiative_workstreams?.title ?? "Task", sub: r.initiative_workstreams?.area ?? null }
      : { id: r.id, role: r.role, guidance: r.guidance, initiative_id: r.initiative_id, workstream_id: r.workstream_id, kind: "initiative" as const, title: r.initiatives?.title ?? "Initiative", sub: r.initiatives?.stage ?? null }));
    setInitiatives((inits ?? []) as InitiativeOpt[]);
    setWorkstreams(((ws ?? []) as WorkstreamOpt[]).map((w) => ({ ...w, initiative_title: initById.get(w.initiative_id) })));
    setLoading(false);
  }, [supabase, agentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (!agent) return <Empty title="Agent not found" />;

  const TABS: [Tab, string, number][] = [
    ["overview", "Overview", 0],
    ["skills", "Skills", attached.size],
    ["connections", "Connections", connections.length],
    ["alignment", "Alignment", alignments.length],
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

      <PageBar tabs={TABS.map(([k, label, count]) => ({ key: k, label, count }))} active={tab} onTab={(k) => setTab(k as Tab)} />

      {tab === "overview" && <Overview agent={agent} onSaved={load} setError={setError} />}
      {tab === "skills" && <Skills agentId={agentId} skills={skills} attached={attached} reload={load} setError={setError} />}
      {tab === "connections" && <Connections agentId={agentId} connections={connections} reload={load} setError={setError} />}
      {tab === "alignment" && <Alignment agentId={agentId} alignments={alignments} initiatives={initiatives} workstreams={workstreams} reload={load} setError={setError} />}
      {tab === "workflows" && <Workflows agentId={agentId} workflows={workflows} skills={skills.filter((s) => attached.has(s.id))} reload={load} setError={setError} />}
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
  const [evolving, setEvolving] = useState(false);
  const [histSkill, setHistSkill] = useState<Skill | null>(null);

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

  const attachedCount = skills.filter((s) => attached.has(s.id)).length;

  return (
    <Section label="Skills" action={!creating ? (
      <div className="row gap-2">
        {attachedCount > 0 && <button className="btn btn-sm" onClick={() => setEvolving((v) => !v)} style={{ background: "var(--ac)", color: "#fff" }}>Evolve from signals</button>}
        <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New skill</button>
      </div>
    ) : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Reusable, tailorable capabilities. Attach what this agent should be able to do; author your own playbooks tailored to your company. <strong>Evolve from signals</strong> rewrites the attached playbooks as new intelligence lands — you review and ratify each change.</div>

      {evolving && <EvolvePanel agentId={agentId} onApplied={reload} onClose={() => setEvolving(false)} setError={setError} />}
      {histSkill && <SkillHistory skill={histSkill} onClose={() => setHistSkill(null)} />}

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
                <div className="row gap-2">
                  {on && <button className="btn btn-secondary btn-sm" onClick={() => setHistSkill(s)}>History</button>}
                  <button className={`btn btn-sm ${on ? "btn-secondary" : ""}`} onClick={() => toggle(s.id, !on)}>{on ? "Attached ✓" : "Attach"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------- Alignment ----------
// Point this agent at the concrete WORK it is responsible for — specific
// initiatives or single tasks — not just broad areas. The binding is real
// (agent_alignments), so coverage is auditable and (phase 2) scopes what the
// agent sees in context.
function Alignment({ agentId, alignments, initiatives, workstreams, reload, setError }: { agentId: string; alignments: Alignment[]; initiatives: InitiativeOpt[]; workstreams: WorkstreamOpt[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [sel, setSel] = useState("");
  const [role, setRole] = useState("watcher");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);

  const alignedInit = new Set(alignments.filter((a) => a.kind === "initiative").map((a) => a.initiative_id));
  const alignedTask = new Set(alignments.filter((a) => a.kind === "task").map((a) => a.workstream_id));
  const openInits = initiatives.filter((i) => !alignedInit.has(i.id));
  const openTasks = workstreams.filter((w) => !alignedTask.has(w.id));

  async function add() {
    if (!sel) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const [type, id] = sel.split(":");
      const row = type === "task"
        ? { org_id: orgId, agent_id: agentId, workstream_id: id, initiative_id: workstreams.find((w) => w.id === id)?.initiative_id ?? null, role, guidance: guidance.trim() || null }
        : { org_id: orgId, agent_id: agentId, initiative_id: id, role, guidance: guidance.trim() || null };
      const { error } = await supabase.from("agent_alignments").insert(row);
      if (error && (error as { code?: string }).code !== "23505") throw error;
      setSel(""); setGuidance(""); setRole("watcher"); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not align."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("agent_alignments").delete().eq("id", id); reload(); }
  async function flipRole(a: Alignment) { setError(null); await supabase.from("agent_alignments").update({ role: a.role === "owner" ? "watcher" : "owner" }).eq("id", a.id); reload(); }

  const inits = alignments.filter((a) => a.kind === "initiative");
  const tasks = alignments.filter((a) => a.kind === "task");

  function row(a: Alignment) {
    return (
      <div key={a.id} className="card card-pad row-between" style={{ gap: 10, padding: "10px 12px" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 620 }}>{a.title}</span>
            {a.sub && <Chip tone={a.kind === "task" ? (a.sub === "gtm" ? "violet" : "accent") : "default"}>{a.sub}</Chip>}
          </div>
          {a.guidance && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 3 }}>{a.guidance}</div>}
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => flipRole(a)} title="Toggle watcher / owner">
            {a.role === "owner" ? "● owner" : "○ watcher"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => remove(a.id)} style={{ color: "var(--rd-text)" }}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Section label="Aligned to">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Point this agent at the work it answers for — whole initiatives or single tasks. <strong>Owner</strong> = accountable and proactive; <strong>watcher</strong> = keeps an eye and weighs in when asked.
        </div>
        {alignments.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Not aligned to any initiative or task yet.</div>
        ) : (
          <div className="stack-3" style={{ marginBottom: 12 }}>
            {inits.length > 0 && <>
              <div className="t-label" style={{ color: "var(--tm)" }}>Initiatives · {inits.length}</div>
              {inits.map(row)}
            </>}
            {tasks.length > 0 && <>
              <div className="t-label" style={{ color: "var(--tm)", marginTop: inits.length > 0 ? 8 : 0 }}>Tasks · {tasks.length}</div>
              {tasks.map(row)}
            </>}
          </div>
        )}

        {/* add a binding */}
        <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Align to</span>
              <select className="select" value={sel} onChange={(e) => setSel(e.target.value)}>
                <option value="">— pick an initiative or task —</option>
                {openInits.length > 0 && (
                  <optgroup label="Initiatives">
                    {openInits.map((i) => <option key={i.id} value={`init:${i.id}`}>{i.title}{i.stage ? ` · ${i.stage}` : ""}</option>)}
                  </optgroup>
                )}
                {openTasks.length > 0 && (
                  <optgroup label="Tasks">
                    {openTasks.map((w) => <option key={w.id} value={`task:${w.id}`}>{w.initiative_title ? `${w.initiative_title} › ` : ""}{w.title}</option>)}
                  </optgroup>
                )}
              </select></label>
            <label className="field"><span className="t-label">Role</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="watcher">Watcher</option>
                <option value="owner">Owner</option>
              </select></label>
          </div>
          <label className="field"><span className="t-label">Focus (optional)</span>
            <input className="input" value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="What should it watch for on this work?" /></label>
          <button className="btn btn-sm" onClick={add} disabled={busy || !sel}>{busy ? "Aligning…" : "+ Align"}</button>
        </div>
      </Section>
    </>
  );
}

// ---------- Connections ----------
function Connections({ agentId, connections, reload, setError }: { agentId: string; connections: Connection[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [mcp, setMcp] = useState({ label: "", url: "", purpose: "", targets: "" });
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
      // Pointing context: an MCP connection is only useful if the agent knows
      // WHERE to look (which reports/accounts/repos). Targets capture that.
      const targets = mcp.targets.split("\n").map((l) => l.trim()).filter(Boolean).map((ref) => ({ type: "ref", ref }));
      await supabase.from("connections").insert({
        org_id: orgId, agent_id: agentId, kind: "mcp", label: mcp.label.trim(), mcp_url: mcp.url.trim(),
        status: "manual", config: { purpose: mcp.purpose.trim() || null },
        guidance: mcp.purpose.trim() || null, targets,
      });
      setMcp({ label: "", url: "", purpose: "", targets: "" }); reload();
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
          <label className="field"><span className="t-label">Point it at specifics — where to look (one per line)</span>
            <textarea className="textarea" rows={3} value={mcp.targets} onChange={(e) => setMcp({ ...mcp, targets: e.target.value })} placeholder={"e.g. report: Win/Loss by Competitor\naccount: Acme Corp\nopportunity stage: Negotiation"} /></label>
          <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Connecting Salesforce isn’t enough — tell the agent which reports, accounts, and opportunities to consult. This is the difference between a connection and a useful one.</div>
          <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "+ Add MCP connection"}</button>
        </form>
      </Section>

      <Section label="Connected">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Connecting an area isn&apos;t enough — <strong>curate</strong> it: tell the agent what to watch, prioritize, or ignore, and point it at specifics. The agent reads this at runtime.</div>
        {connections.length === 0 ? <div className="t-sub t-muted">No connections yet.</div> : (
          <div className="stack-3">
            {connections.map((c) => <ConnRow key={c.id} c={c} onRemove={remove} reload={reload} setError={setError} />)}
          </div>
        )}
      </Section>
    </>
  );
}

// A connected area/tool, with an inline "curate" editor for guidance + targets —
// what to watch/prioritize/ignore and which specifics to consult.
function ConnRow({ c, onRemove, reload, setError }: { c: Connection; onRemove: (id: string) => void; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [guidance, setGuidance] = useState(c.guidance ?? "");
  const [targets, setTargets] = useState((c.targets ?? []).map((t) => t.ref).join("\n"));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError(null);
    const tg = targets.split("\n").map((l) => l.trim()).filter(Boolean).map((ref) => ({ type: "ref", ref }));
    const { error } = await supabase.from("connections").update({ guidance: guidance.trim() || null, targets: tg }).eq("id", c.id);
    if (error) setError(error.message); else { setEditing(false); reload(); }
    setBusy(false);
  }

  return (
    <div className="card card-pad">
      <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <Chip tone={c.kind === "internal" ? "accent" : "violet"}>{c.kind === "internal" ? "internal" : "MCP"}</Chip>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>
            <Chip tone={c.status === "connected" ? "green" : "default"}>{c.status === "connected" ? "live" : "declared"}</Chip>
          </div>
          {c.mcp_url && <div className="mono t-muted" style={{ fontSize: 11, marginTop: 4 }}>{c.mcp_url}</div>}
          {c.guidance && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 4 }}>🧭 {c.guidance}</div>}
          {(c.targets?.length ?? 0) > 0 && (
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 4 }}>🎯 Watches: {c.targets!.map((t) => t.ref).join(" · ")}</div>
          )}
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Curate"}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onRemove(c.id)}>Remove</button>
        </div>
      </div>
      {editing && (
        <div style={{ marginTop: 10 }}>
          <label className="field"><span className="t-label">What to watch / prioritize / ignore</span>
            <textarea className="textarea" rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. Focus on pricing & competitive signals; weight escalating themes; ignore low-confidence noise." /></label>
          <label className="field"><span className="t-label">Point at specifics (one per line)</span>
            <textarea className="textarea" rows={2} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={"theme: Pricing friction\ncompetitor: Crayon\ncapability area: orchestration"} /></label>
          <button className="btn btn-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save curation"}</button>
        </div>
      )}
    </div>
  );
}

// ---------- Workflows ----------
const WF_TRIGGERS: [string, string][] = [
  ["manual", "Manual (run on demand)"],
  ["scheduled", "Scheduled"],
  ["on_signal", "When a signal lands"],
  ["on_release", "On release"],
  ["on_capability_update", "On new capability"],
];

function Workflows({ agentId, workflows, skills, reload, setError }: { agentId: string; workflows: Workflow[]; skills: Skill[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; description: string; trigger: string; skill_ids: string[] }>({ name: "", description: "", trigger: "manual", skill_ids: [] });
  const [busy, setBusy] = useState(false);

  function toggleSkill(id: string) {
    setForm((f) => ({ ...f, skill_ids: f.skill_ids.includes(id) ? f.skill_ids.filter((x) => x !== id) : [...f.skill_ids, id] }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: agentId, name: form.name.trim(), description: form.description.trim() || null, trigger: form.trigger, skill_ids: form.skill_ids });
      if (error) throw error;
      setCreating(false); setForm({ name: "", description: "", trigger: "manual", skill_ids: [] }); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workflow."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("workflows").delete().eq("id", id); reload(); }

  const skillName = (id: string) => skills.find((s) => s.id === id)?.name;

  return (
    <Section label="Workflows" action={!creating ? <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>+ New workflow</button> : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Saved tasks this agent runs — an agent + the skills it applies + a trigger. (Manual run today; scheduled, release &amp; capability triggers execute once the runtime ships.)</div>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekly competitive refresh" /></label>
          <label className="field"><span className="t-label">Description</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it does" /></label>
          <label className="field"><span className="t-label">Trigger</span>
            <select className="select" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              {WF_TRIGGERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select></label>
          {skills.length > 0 ? (
            <div className="field">
              <span className="t-label">Skills it applies</span>
              <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 4 }}>
                {skills.map((s) => {
                  const on = form.skill_ids.includes(s.id);
                  return <button type="button" key={s.id} onClick={() => toggleSkill(s.id)} className={`btn btn-sm ${on ? "" : "btn-secondary"}`}>{on ? "✓ " : ""}{s.name}</button>;
                })}
              </div>
            </div>
          ) : <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>Attach skills on the Skills tab to apply them in workflows.</div>}
          <div className="row gap-2" style={{ marginTop: 8 }}><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {workflows.length === 0 && !creating ? <Empty title="No workflows yet" hint="Create a saved task for this agent." action={<button className="btn" onClick={() => setCreating(true)}>+ New workflow</button>} /> : (
        <div className="stack-3">
          {workflows.map((w) => (
            <div key={w.id} className="card card-pad row-between">
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap" }}><span style={{ fontSize: 14, fontWeight: 620 }}>{w.name}</span><Chip>{w.trigger}</Chip>{!w.is_active && <Chip tone="amber">paused</Chip>}</div>
                {w.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{w.description}</div>}
                {(w.skill_ids?.length ?? 0) > 0 && (
                  <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
                    {w.skill_ids!.map((id) => { const n = skillName(id); return n ? <Chip key={id} tone="default">{n}</Chip> : null; })}
                  </div>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => remove(w.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- Evolve from signals (recursive skill evolution) ----------
type Revision = { skill_id: string; name: string; category: string | null; current_instructions: string; proposed_instructions: string; rationale: string; drivers: string[] };
type NewSkill = { name: string; description: string; category: string; instructions: string; rationale: string; drivers: string[] };
type NewDraft = { name: string; category: string; instructions: string };

function EvolvePanel({ agentId, onApplied, onClose, setError }: { agentId: string; onApplied: () => void; onClose: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [revs, setRevs] = useState<Revision[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [news, setNews] = useState<(NewSkill & { uid: string })[]>([]);
  const [newDrafts, setNewDrafts] = useState<Record<string, NewDraft>>({});
  const [applyingNew, setApplyingNew] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setNote(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("evolve-skills", {
        body: { agent_id: agentId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const rs: Revision[] = data?.revisions ?? [];
      const ns: NewSkill[] = data?.new_skills ?? [];
      setRevs(rs);
      setDrafts(Object.fromEntries(rs.map((r) => [r.skill_id, r.proposed_instructions])));
      const withUid = ns.map((n, i) => ({ ...n, uid: `new-${i}` }));
      setNews(withUid);
      setNewDrafts(Object.fromEntries(withUid.map((n) => [n.uid, { name: n.name, category: n.category, instructions: n.instructions }])));
      if (rs.length === 0 && ns.length === 0) setNote(data?.message ?? "No skill changes warranted by current intelligence. Your playbooks are up to date.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not evolve skills."); }
    finally { setLoading(false); }
  }, [supabase, agentId, setError]);

  useEffect(() => { run(); }, [run]);

  async function accept(r: Revision) {
    setApplying(r.skill_id); setError(null);
    try {
      const { error } = await supabase.rpc("apply_skill_evolution", {
        p_skill: r.skill_id,
        p_instructions: drafts[r.skill_id] ?? r.proposed_instructions,
        p_drivers: r.drivers.map((d) => ({ kind: "intelligence", title: d })),
        p_note: r.rationale,
      });
      if (error) throw error;
      setRevs((prev) => prev.filter((x) => x.skill_id !== r.skill_id));
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply evolution."); }
    finally { setApplying(null); }
  }
  function dismiss(id: string) { setRevs((prev) => prev.filter((x) => x.skill_id !== id)); }

  async function acceptNew(n: NewSkill & { uid: string }) {
    const d = newDrafts[n.uid] ?? { name: n.name, category: n.category, instructions: n.instructions };
    if (!d.name.trim() || !d.instructions.trim()) { setError("New skill needs a name and instructions."); return; }
    setApplyingNew(n.uid); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const base = d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
      // Create with no instructions first, then evolve them in — so the skill's
      // first revision is provenance-tagged 'evolved' (born from these signals).
      let { data: created, error: insErr } = await supabase.from("skills")
        .insert({ org_id: orgId, key: base, name: d.name.trim(), description: n.description?.trim() || null, instructions: null, category: d.category, source: "evolved" })
        .select("id").single();
      if (insErr && (insErr as { code?: string }).code === "23505") {
        ({ data: created, error: insErr } = await supabase.from("skills")
          .insert({ org_id: orgId, key: `${base}_${Date.now().toString(36)}`, name: d.name.trim(), description: n.description?.trim() || null, instructions: null, category: d.category, source: "evolved" })
          .select("id").single());
      }
      if (insErr) throw insErr;
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: created!.id });
      const { error: rpcErr } = await supabase.rpc("apply_skill_evolution", {
        p_skill: created!.id, p_instructions: d.instructions, p_drivers: n.drivers.map((x) => ({ kind: "intelligence", title: x })), p_note: n.rationale,
      });
      if (rpcErr) throw rpcErr;
      setNews((prev) => prev.filter((x) => x.uid !== n.uid));
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create skill."); }
    finally { setApplyingNew(null); }
  }
  function dismissNew(uid: string) { setNews((prev) => prev.filter((x) => x.uid !== uid)); }

  return (
    <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", borderColor: "var(--ac)", background: "var(--ac-fill)" }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="row gap-2"><span style={{ fontWeight: 660 }}>Evolve skills from signals</span></div>
        <div className="row gap-2">
          <button className="btn btn-secondary btn-sm" onClick={run} disabled={loading}>{loading ? "Analyzing…" : "Re-run"}</button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {loading && <div className="t-sub t-muted">Reading this agent's intelligence and proposing playbook updates…</div>}
      {!loading && note && <div className="t-sub" style={{ fontSize: 13 }}>{note}</div>}

      <div className="stack-3">
        {revs.map((r) => (
          <div key={r.skill_id} className="card card-pad" style={{ background: "var(--panel)" }}>
            <div className="row gap-2" style={{ marginBottom: 6 }}>
              <Chip tone="accent">revise</Chip>
              <span style={{ fontSize: 14, fontWeight: 640 }}>{r.name}</span>
              {r.category && <Chip tone={r.category === "product" ? "accent" : r.category === "gtm" ? "violet" : "default"}>{r.category}</Chip>}
            </div>
            <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>Why:</strong> {r.rationale}</div>
            {r.drivers.length > 0 && (
              <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                {r.drivers.map((d, i) => <Chip key={i} tone="default">{d}</Chip>)}
              </div>
            )}
            <details style={{ marginBottom: 8 }}>
              <summary className="t-sub t-muted" style={{ fontSize: 12, cursor: "pointer" }}>Current instructions</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ts)", marginTop: 6, fontFamily: "inherit" }}>{r.current_instructions || "(none yet)"}</pre>
            </details>
            <label className="field"><span className="t-label">Proposed instructions (edit before accepting)</span>
              <textarea className="textarea" rows={8} value={drafts[r.skill_id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.skill_id]: e.target.value })} /></label>
            <div className="row gap-2">
              <button className="btn btn-success btn-sm" onClick={() => accept(r)} disabled={applying === r.skill_id}>{applying === r.skill_id ? "Applying…" : "Accept & evolve"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r.skill_id)} disabled={applying === r.skill_id}>Dismiss</button>
            </div>
          </div>
        ))}

        {news.map((n) => {
          const d = newDrafts[n.uid] ?? { name: n.name, category: n.category, instructions: n.instructions };
          return (
            <div key={n.uid} className="card card-pad" style={{ background: "var(--panel)", borderColor: "var(--gn)" }}>
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <Chip tone="green">new skill</Chip>
                <span className="t-sub t-muted" style={{ fontSize: 12 }}>a capability this agent doesn&apos;t have yet</span>
              </div>
              <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>Why:</strong> {n.rationale}</div>
              {n.drivers.length > 0 && (
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                  {n.drivers.map((x, i) => <Chip key={i} tone="default">{x}</Chip>)}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Name</span>
                  <input className="input" value={d.name} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, name: e.target.value } })} /></label>
                <label className="field"><span className="t-label">Category</span>
                  <select className="select" value={d.category} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, category: e.target.value } })}>
                    <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
                  </select></label>
              </div>
              <label className="field"><span className="t-label">Instructions / playbook (edit before accepting)</span>
                <textarea className="textarea" rows={8} value={d.instructions} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, instructions: e.target.value } })} /></label>
              <div className="row gap-2">
                <button className="btn btn-success btn-sm" onClick={() => acceptNew(n)} disabled={applyingNew === n.uid}>{applyingNew === n.uid ? "Creating…" : "Create & attach"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismissNew(n.uid)} disabled={applyingNew === n.uid}>Dismiss</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Skill revision history ----------
type Rev = { id: string; created_at: string; instructions: string | null; source: string; drivers: { kind?: string; title: string }[] | null; note: string | null };

function SkillHistory({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const supabase = createClient();
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("skill_revisions").select("id, created_at, instructions, source, drivers, note").eq("skill_id", skill.id).order("created_at", { ascending: false });
      setRevs(data ?? []); setLoading(false);
    })();
  }, [supabase, skill.id]);
  return (
    <Modal open onClose={onClose} title={`History · ${skill.name}`} width={620}>
      {loading ? <div className="t-sub t-muted">Loading…</div> : revs.length === 0 ? (
        <div className="t-sub t-muted">No revisions yet. This skill hasn't changed since it was created.</div>
      ) : (
        <div className="stack-3">
          {revs.map((r, i) => (
            <div key={r.id} className="card card-pad">
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <Chip tone={r.source === "evolved" ? "accent" : "default"}>{r.source === "evolved" ? "evolved from signals" : r.source}</Chip>
                {i === 0 && <Chip tone="green">current</Chip>}
                <span className="t-sub t-muted mono" style={{ fontSize: 11 }}>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              {r.note && <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 6 }}><strong>Why:</strong> {r.note}</div>}
              {(r.drivers?.length ?? 0) > 0 && (
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                  {r.drivers!.map((d, j) => <Chip key={j}>{d.title}</Chip>)}
                </div>
              )}
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ts)", fontFamily: "inherit", margin: 0 }}>{r.instructions || "(empty)"}</pre>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
