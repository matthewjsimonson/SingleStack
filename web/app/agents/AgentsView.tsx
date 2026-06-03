"use client";

// Agents management: list + create/edit (name, key, role, model, system prompt).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Empty } from "@/components/ui";
import PageBar from "@/components/PageBar";
import RosterReview from "@/components/RosterReview";

type Agent = { id: string; key: string; name: string; role: string | null; model: string | null; system_prompt: string | null; is_active: boolean };
type Align = { agent_id: string; initiative_id: string | null; workstream_id: string | null };
const BLANK = { key: "", name: "", role: "", model: "claude-opus-4-8", system_prompt: "", is_active: true };

export default function AgentsView() {
  const supabase = createClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [aligns, setAligns] = useState<Align[]>([]);
  const [inits, setInits] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: al }, { data: it }] = await Promise.all([
      supabase.from("agents").select("id, key, name, role, model, system_prompt, is_active").order("name"),
      supabase.from("agent_alignments").select("agent_id, initiative_id, workstream_id"),
      supabase.from("initiatives").select("id, title").order("created_at", { ascending: false }).limit(200),
    ]);
    setAgents(data ?? []); setAligns(al ?? []); setInits(it ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Coverage: which initiatives have at least one agent aligned, and per-agent counts.
  const countsByAgent: Record<string, { inits: number; tasks: number }> = {};
  for (const a of aligns) {
    const c = (countsByAgent[a.agent_id] ??= { inits: 0, tasks: 0 });
    if (a.workstream_id) c.tasks++; else c.inits++;
  }
  const coveredInits = new Set(aligns.map((a) => a.initiative_id).filter(Boolean) as string[]);
  const uncovered = inits.filter((i) => !coveredInits.has(i.id));

  function startNew() { setForm(BLANK); setEditing("new"); setError(null); }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (!form.key.trim() || !form.name.trim()) throw new Error("Key and name are required.");
      const payload = {
        key: form.key.trim(), name: form.name.trim(), role: form.role.trim() || null,
        model: form.model.trim() || null, system_prompt: form.system_prompt.trim() || null, is_active: form.is_active,
      };
      if (editing === "new") {
        const orgId = await getOrgId();
        if (!orgId) throw new Error("Could not resolve your organization.");
        const { error } = await supabase.from("agents").insert({ org_id: orgId, ...payload });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agents").update(payload).eq("id", editing!);
        if (error) throw error;
      }
      setEditing(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save agent."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <PageBar actions={editing === null ? <button className="btn btn-sm" onClick={startNew}>+ New agent</button> : undefined} />

      {editing === null && <div style={{ marginBottom: "var(--sp-6)" }}><RosterReview onChanged={load} /></div>}

      {/* Coverage — is the roster actually pointed at the work? */}
      {editing === null && inits.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Initiative coverage</div>
          <div className="t-sub" style={{ fontSize: 13 }}>
            <strong>{coveredInits.size}</strong> of <strong>{inits.length}</strong> initiative{inits.length === 1 ? "" : "s"} have an agent aligned.
          </div>
          {uncovered.length > 0 && (
            <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              No agent on: {uncovered.slice(0, 6).map((i) => i.title).join(", ")}{uncovered.length > 6 ? ` +${uncovered.length - 6} more` : ""}
            </div>
          )}
        </div>
      )}

      {editing !== null && (
        <form onSubmit={save} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span>
              <input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CPO agent" /></label>
            <label className="field"><span className="t-label">Key</span>
              <input className="input mono" value={form.key} disabled={editing !== "new"} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="cpo" /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Role</span>
              <input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Sharpen positioning" /></label>
            <label className="field"><span className="t-label">Model</span>
              <select className="select" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                <option value="claude-opus-4-8">claude-opus-4-8 · most capable</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6 · faster, cheaper</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5 · cheapest</option>
              </select></label>
          </div>
          <label className="field"><span className="t-label">System prompt</span>
            <textarea className="textarea" rows={5} value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder="You are a CPO agent that sharpens a product record's fields. Be specific and concise." /></label>
          <label className="row gap-2" style={{ marginBottom: "var(--sp-4)", fontSize: 13.5 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active (available to run on records)
          </label>
          <Banner>{error}</Banner>
          <div className="row gap-2">
            <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save agent"}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : agents.length === 0 && editing === null ? (
          <Empty title="No agents yet" hint="Create an agent to start generating proposals on your records."
            action={<button className="btn" onClick={startNew}>+ Create your first agent</button>} />
        ) : (
          <div className="stack-3">
            {agents.map((a) => (
              <a key={a.id} href={`/agents/${a.id}`} className="card card-link card-pad row-between" style={{ gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-2">
                    <span style={{ fontSize: 15, fontWeight: 620 }}>{a.name}</span>
                    <Chip>{a.key}</Chip>
                    {!a.is_active && <Chip tone="amber">inactive</Chip>}
                  </div>
                  <div className="t-sub" style={{ marginTop: 3 }}>
                    {a.role || <span className="t-muted">No role</span>}
                    <span className="t-mono-xs" style={{ marginLeft: 8 }}>{a.model}</span>
                    {(() => { const c = countsByAgent[a.id]; return c && (c.inits || c.tasks)
                      ? <span className="t-mono-xs" style={{ marginLeft: 8 }}>· aligned to {c.inits} init{c.inits === 1 ? "" : "s"}{c.tasks ? `, ${c.tasks} task${c.tasks === 1 ? "" : "s"}` : ""}</span>
                      : <span className="t-mono-xs" style={{ marginLeft: 8, color: "var(--tm)" }}>· no alignment</span>; })()}
                  </div>
                </div>
                <span className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600, fontSize: 13 }}>Configure →</span>
              </a>
            ))}
          </div>
        )}
    </div>
  );
}
