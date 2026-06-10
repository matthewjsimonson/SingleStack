"use client";

// Module-level workflows. Surfaced inside a module on the product record:
// the agent × skills × trigger configuration scoped to THIS module. Keeps
// workflows first-class at the module level (not just the agent level).
// Self-contained so it doesn't touch the modules/features logic around it.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip } from "@/components/ui";

type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string; category: string | null };
type Workflow = { id: string; name: string; trigger: string; is_active: boolean; agent_id: string | null; skill_ids: string[] | null };

const TRIGGERS: { key: string; label: string }[] = [
  { key: "manual", label: "Manual (run on demand)" },
  { key: "scheduled", label: "Scheduled" },
  { key: "on_signal", label: "When a signal lands" },
  { key: "on_pql", label: "When an account becomes a PQL" },
  { key: "on_release", label: "On release" },
  { key: "on_capability_update", label: "On new capability" },
];

export default function ModuleWorkflows({ moduleId, productId }: { moduleId: string; productId: string }) {
  const supabase = createClient();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; agent_id: string; trigger: string; skill_ids: string[] }>({ name: "", agent_id: "", trigger: "manual", skill_ids: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: wf }, { data: ag }, { data: sk }] = await Promise.all([
      supabase.from("workflows").select("id, name, trigger, is_active, agent_id, skill_ids").eq("module_id", moduleId).order("created_at"),
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("skills").select("id, name, category").order("name"),
    ]);
    setWorkflows((wf ?? []) as Workflow[]); setAgents(ag ?? []); setSkills(sk ?? []); setLoading(false);
  }, [supabase, moduleId]);
  useEffect(() => { load(); }, [load]);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "—";
  function toggleSkill(id: string) {
    setForm((f) => ({ ...f, skill_ids: f.skill_ids.includes(id) ? f.skill_ids.filter((x) => x !== id) : [...f.skill_ids, id] }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim() || !form.agent_id) { setError("Name and an agent are required."); return; }
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("workflows").insert({
        org_id: orgId, agent_id: form.agent_id, name: form.name.trim(), trigger: form.trigger,
        module_id: moduleId, target_type: "product", target_id: productId, skill_ids: form.skill_ids,
      });
      if (error) throw error;
      setCreating(false); setForm({ name: "", agent_id: "", trigger: "manual", skill_ids: [] }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create workflow."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("workflows").delete().eq("id", id); await load(); }

  if (loading) return null;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="t-label">Workflows · {workflows.length}</span>
        {!creating && <button className="btn btn-sm" onClick={() => { setCreating(true); setError(null); }}>+ Add workflow</button>}
      </div>
      <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>An agent + its skills + a trigger, scoped to this module. (Scheduled / event triggers run once the runtime ships; manual is declared now.)</div>

      {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: 10, background: "var(--panel-2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Workflow</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Refresh module positioning" /></label>
            <label className="field"><span className="t-label">Trigger</span>
              <select className="select" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
                {TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select></label>
          </div>
          <label className="field"><span className="t-label">Run as agent</span>
            <select className="select" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
              <option value="">Select an agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          {skills.length > 0 && (
            <div className="field">
              <span className="t-label">Skills it applies</span>
              <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 4 }}>
                {skills.map((s) => {
                  const on = form.skill_ids.includes(s.id);
                  return <button type="button" key={s.id} onClick={() => toggleSkill(s.id)} className={`btn btn-sm ${on ? "" : "btn-secondary"}`}>{on ? "✓ " : ""}{s.name}</button>;
                })}
              </div>
            </div>
          )}
          <div className="row gap-2" style={{ marginTop: 8 }}><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add workflow"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {workflows.length === 0 && !creating ? (
        <div className="t-sub t-muted" style={{ fontSize: 12, padding: "2px 0" }}>No workflows on this module yet.</div>
      ) : (
        <div className="stack-3">
          {workflows.map((w) => (
            <div key={w.id} className="card card-pad row-between" style={{ padding: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 620 }}>{w.name}</span>
                  <Chip>{w.trigger}</Chip>
                  {!w.is_active && <Chip tone="amber">paused</Chip>}
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {agentName(w.agent_id)}{(w.skill_ids?.length ?? 0) > 0 ? ` · ${w.skill_ids!.length} skill${w.skill_ids!.length === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => remove(w.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
