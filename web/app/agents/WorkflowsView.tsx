"use client";

// Workflows — author agentic TASKS: multi-step processes that run in a specific
// order. Each STEP is one officer applying one of its play skills, drawing on
// internal and/or external signals; its output feeds the next step. Authoring only
// for now — running a workflow (and launching it from the chat pop-out) comes next.
// Steps persist on workflows.steps (jsonb); workflows span agents, so they live here
// at the roster level rather than on a single agent.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { ensureTeam } from "@/lib/ensureTeam";
import { Section, Chip, Banner, Empty, AgentBadge } from "@/components/ui";
import WorkflowRunDrawer from "@/components/WorkflowRunDrawer";

type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string; category: string | null };
type Signals = "none" | "internal" | "external" | "both";
type Step = { id: string; agent_id: string; skill_id: string | null; signals: Signals; instruction: string };
type WF = { id: string; name: string; description: string | null; steps: Step[] | null; is_active: boolean };

const SIGNAL_LABEL: Record<Signals, string> = { none: "No signals", internal: "Internal signals", external: "External signals", both: "Internal + external" };
const uid = () => (crypto?.randomUUID?.() ?? `s_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export default function WorkflowsView() {
  const supabase = createClient();
  const [workflows, setWorkflows] = useState<WF[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [playSkills, setPlaySkills] = useState<Record<string, Skill[]>>({}); // agent_id → its play skills
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [meta, setMeta] = useState({ name: "", description: "" }); // editing the active workflow's name/desc
  // step composer
  const [addingStep, setAddingStep] = useState(false);
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ agent_id: string; skill_id: string; signals: Signals; instruction: string }>({ agent_id: "", skill_id: "", signals: "both", instruction: "" });
  const [running, setRunning] = useState(false); // run drawer open

  const load = useCallback(async () => {
    await ensureTeam(supabase);
    const [{ data: wf }, { data: ag }, { data: sk }, { data: as }] = await Promise.all([
      supabase.from("workflows").select("id, name, description, steps, is_active").order("created_at"),
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("skills").select("id, name, category"),
      supabase.from("agent_skills").select("agent_id, skill_id, is_cornerstone"),
    ]);
    setWorkflows((wf ?? []) as WF[]);
    setAgents((ag ?? []) as Agent[]);
    const skillById = new Map((sk ?? []).map((s) => [s.id, s as Skill]));
    const byAgent: Record<string, Skill[]> = {};
    for (const r of as ?? []) if (!r.is_cornerstone) { const s = skillById.get(r.skill_id); if (s) (byAgent[r.agent_id] ??= []).push(s); }
    setPlaySkills(byAgent);
    setActive((cur) => (cur && (wf ?? []).some((w) => w.id === cur) ? cur : null));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const activeWf = workflows.find((w) => w.id === active) ?? null;
  const agentById = (id: string) => agents.find((a) => a.id === id);
  const skillById = (agentId: string, skillId: string | null) => (skillId ? (playSkills[agentId] ?? []).find((s) => s.id === skillId) ?? null : null);

  function openWorkflow(w: WF) { setActive(w.id); setMeta({ name: w.name, description: w.description ?? "" }); setAddingStep(false); setEditingStep(null); }

  async function createWorkflow() {
    if (!newName.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Couldn't resolve your organization."); return; }
    const { data, error } = await supabase.from("workflows").insert({ org_id: orgId, name: newName.trim(), trigger: "manual", steps: [] }).select("id, name, description, steps, is_active").single();
    if (error) { setError(error.message); return; }
    setNewName("");
    await load();
    if (data) openWorkflow(data as WF);
  }
  async function saveMeta() {
    if (!activeWf) return;
    await supabase.from("workflows").update({ name: meta.name.trim() || activeWf.name, description: meta.description.trim() || null }).eq("id", activeWf.id);
    await load();
  }
  async function deleteWorkflow(id: string) {
    setError(null);
    await supabase.from("workflows").delete().eq("id", id);
    setActive(null); await load();
  }
  // Persist a new ordered steps array onto the active workflow.
  async function persistSteps(steps: Step[]) {
    if (!activeWf) return;
    setWorkflows((prev) => prev.map((w) => (w.id === activeWf.id ? { ...w, steps } : w))); // optimistic
    const { error } = await supabase.from("workflows").update({ steps }).eq("id", activeWf.id);
    if (error) { setError(error.message); await load(); }
  }
  const steps = (activeWf?.steps ?? []);

  function startAdd() { setAddingStep(true); setEditingStep(null); setDraft({ agent_id: agents[0]?.id ?? "", skill_id: "", signals: "both", instruction: "" }); }
  function startEdit(s: Step) { setEditingStep(s.id); setAddingStep(false); setDraft({ agent_id: s.agent_id, skill_id: s.skill_id ?? "", signals: s.signals, instruction: s.instruction }); }
  async function commitStep() {
    if (!draft.agent_id) { setError("Pick an officer for this step."); return; }
    setError(null);
    if (editingStep) {
      await persistSteps(steps.map((s) => (s.id === editingStep ? { ...s, agent_id: draft.agent_id, skill_id: draft.skill_id || null, signals: draft.signals, instruction: draft.instruction.trim() } : s)));
      setEditingStep(null);
    } else {
      await persistSteps([...steps, { id: uid(), agent_id: draft.agent_id, skill_id: draft.skill_id || null, signals: draft.signals, instruction: draft.instruction.trim() }]);
      setAddingStep(false);
    }
  }
  async function removeStep(id: string) { await persistSteps(steps.filter((s) => s.id !== id)); }
  async function moveStep(id: string, dir: -1 | 1) {
    const i = steps.findIndex((s) => s.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; await persistSteps(next);
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  // ---- gallery (no workflow selected) ----
  if (!activeWf) {
    return (
      <Section label="Workflows" action={
        <div className="row gap-2">
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New workflow name" onKeyDown={(e) => { if (e.key === "Enter") createWorkflow(); }} style={{ width: 200 }} />
          <button className="btn btn-sm" onClick={createWorkflow} disabled={!newName.trim()}>+ Create</button>
        </div>
      }>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Agentic tasks: multi-step processes that run in order. Each step is one officer applying a <strong>play skill</strong>, drawing on <strong>internal &amp; external signals</strong> — its output feeds the next step. Author them here; running &amp; launching from a chat comes next.
        </div>
        <Banner>{error}</Banner>
        {workflows.length === 0 ? (
          <Empty title="No workflows yet" hint="Create one above — then add the officers and play skills it runs, in order." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-3)" }}>
            {workflows.map((w) => {
              const ws = w.steps ?? [];
              const officers = [...new Set(ws.map((s) => agentById(s.agent_id)?.name).filter(Boolean))] as string[];
              return (
                <button key={w.id} className="card card-pad pop" onClick={() => openWorkflow(w)} style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, minHeight: 110 }}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 660 }}>{w.name}</span>
                    <Chip tone="violet">{ws.length} step{ws.length === 1 ? "" : "s"}</Chip>
                  </div>
                  {w.description && <span className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{w.description}</span>}
                  <span className="t-mono-xs t-muted" style={{ marginTop: "auto" }}>{officers.length ? officers.join(" → ") : "No steps yet"}</span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
    );
  }

  // ---- editor (a workflow selected) ----
  const composer = (
    <div className="card card-pad stack-2" style={{ background: "var(--panel-2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
        <label className="field"><span className="t-label">Officer</span>
          <select className="select" value={draft.agent_id} onChange={(e) => setDraft({ ...draft, agent_id: e.target.value, skill_id: "" })}>
            <option value="">— pick an officer —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        <label className="field"><span className="t-label">Play skill</span>
          <select className="select" value={draft.skill_id} onChange={(e) => setDraft({ ...draft, skill_id: e.target.value })} disabled={!draft.agent_id}>
            <option value="">— none (just the officer) —</option>
            {(playSkills[draft.agent_id] ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
      </div>
      {draft.agent_id && (playSkills[draft.agent_id] ?? []).length === 0 && (
        <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>This officer has no play skills yet — author one on its <a href={`/agents/${draft.agent_id}`} style={{ color: "var(--ac-text)", fontWeight: 600 }}>Skills page</a>.</div>
      )}
      <label className="field"><span className="t-label">Signals this step draws on</span>
        <select className="select" value={draft.signals} onChange={(e) => setDraft({ ...draft, signals: e.target.value as Signals })}>
          {(Object.keys(SIGNAL_LABEL) as Signals[]).map((k) => <option key={k} value={k}>{SIGNAL_LABEL[k]}</option>)}
        </select></label>
      <label className="field"><span className="t-label">Instruction for this step <span className="t-muted">(optional)</span></span>
        <textarea className="textarea" rows={3} value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} placeholder="What this officer should do at this step, and what to hand to the next." /></label>
      <div className="row gap-2"><button className="btn btn-sm" onClick={commitStep}>{editingStep ? "Save step" : "Add step"}</button><button className="btn btn-secondary btn-sm" onClick={() => { setAddingStep(false); setEditingStep(null); }}>Cancel</button></div>
    </div>
  );

  return (
    <div>
      <button onClick={() => setActive(null)} className="t-sub" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, marginBottom: "var(--sp-4)", background: "none", border: "none", cursor: "pointer", color: "var(--ac-text)", padding: 0 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> All workflows
      </button>
      <Banner>{error}</Banner>

      <Section label={<input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} onBlur={saveMeta} style={{ fontWeight: 660, fontSize: 15, maxWidth: 360 }} />}
        action={
          <div className="row gap-2">
            <button className="btn btn-sm" onClick={() => setRunning(true)} disabled={steps.length === 0} style={{ background: "var(--ac)", color: "#fff" }} title={steps.length === 0 ? "Add a step first" : "Run this workflow"}>▸ Run</button>
            <button className="btn btn-secondary btn-sm" onClick={() => deleteWorkflow(activeWf.id)} style={{ color: "var(--rd-text)" }}>Delete</button>
          </div>
        }>
        <label className="field" style={{ marginBottom: "var(--sp-4)" }}><span className="t-label">Description</span>
          <input className="input" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} onBlur={saveMeta} placeholder="What this workflow accomplishes" /></label>

        <div className="t-label" style={{ marginBottom: 8 }}>Steps <span className="t-muted" style={{ fontWeight: 400 }}>— run top to bottom; each feeds the next</span></div>

        {steps.length === 0 && !addingStep && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No steps yet. Add the first one below.</div>}

        <div className="stack-3" style={{ marginBottom: 12 }}>
          {steps.map((s, i) => {
            const ag = agentById(s.agent_id); const sk = skillById(s.agent_id, s.skill_id);
            const isEditing = editingStep === s.id;
            return (
              <div key={s.id}>
                <div className="card card-pad">
                  <div className="row-between" style={{ gap: 10, alignItems: "flex-start" }}>
                    <div className="row gap-2" style={{ alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
                      <span className="t-mono-xs t-muted">{i + 1}</span>
                      {ag ? <AgentBadge name={ag.name} /> : <Chip tone="amber">missing officer</Chip>}
                      {sk ? <Chip tone="violet">{sk.name}</Chip> : <span className="t-sub t-muted" style={{ fontSize: 12 }}>no play skill</span>}
                      <Chip>{SIGNAL_LABEL[s.signals]}</Chip>
                    </div>
                    <div className="row gap-2" style={{ flexShrink: 0 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => moveStep(s.id, -1)} disabled={i === 0} title="Move up">↑</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => moveStep(s.id, 1)} disabled={i === steps.length - 1} title="Move down">↓</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => (isEditing ? setEditingStep(null) : startEdit(s))}>{isEditing ? "Close" : "Edit"}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => removeStep(s.id)} style={{ color: "var(--rd-text)" }}>Remove</button>
                    </div>
                  </div>
                  {s.instruction && !isEditing && <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 8, whiteSpace: "pre-wrap" }}>{s.instruction}</div>}
                </div>
                {isEditing && <div style={{ marginTop: 8 }}>{composer}</div>}
              </div>
            );
          })}
        </div>

        {addingStep ? composer : <button className="btn btn-secondary btn-sm" onClick={startAdd}>+ Add step</button>}
      </Section>

      <WorkflowRunDrawer open={running} onClose={() => setRunning(false)} workflow={activeWf ? { id: activeWf.id, name: activeWf.name } : null} onRan={load} />
    </div>
  );
}
