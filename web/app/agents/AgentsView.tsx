"use client";

// Agents management: list, create, and edit the org's agents (name, key, role,
// model, system prompt, active). This is the surface that was missing — agents
// are just rows, and this lets you author them without SQL. Fetches client-side
// (session-carrying) and stamps org_id on insert (RLS enforces it).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Agent = {
  id: string;
  key: string;
  name: string;
  role: string | null;
  model: string | null;
  system_prompt: string | null;
  is_active: boolean;
};

const BLANK = {
  key: "",
  name: "",
  role: "",
  model: "claude-opus-4-8",
  system_prompt: "",
  is_active: true,
};

export default function AgentsView() {
  const supabase = createClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("agents")
      .select("id, key, name, role, model, system_prompt, is_active")
      .order("name");
    setAgents(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setForm(BLANK);
    setEditing("new");
    setError(null);
  }

  function startEdit(a: Agent) {
    setForm({
      key: a.key,
      name: a.name,
      role: a.role ?? "",
      model: a.model ?? "claude-opus-4-8",
      system_prompt: a.system_prompt ?? "",
      is_active: a.is_active,
    });
    setEditing(a.id);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!form.key.trim() || !form.name.trim()) throw new Error("Key and name are required.");
      const payload = {
        key: form.key.trim(),
        name: form.name.trim(),
        role: form.role.trim() || null,
        model: form.model.trim() || null,
        system_prompt: form.system_prompt.trim() || null,
        is_active: form.is_active,
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
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save agent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 className="serif" style={{ fontSize: 24, fontWeight: 600 }}>Agents</h1>
        {editing === null && <button className="btn" onClick={startNew}>+ New agent</button>}
      </div>
      <p className="secondary" style={{ fontSize: 13.5, marginBottom: 20 }}>
        Agents read a record and propose changes. Each has a system prompt and a model.
      </p>

      {editing !== null && (
        <form onSubmit={save} className="card" style={{ padding: 20, marginBottom: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Name">
              <input className="input" value={form.name} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CPO agent" />
            </Field>
            <Field label="Key (stable id)">
              <input className="input mono" value={form.key}
                disabled={editing !== "new"}
                onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="cpo" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Role">
              <input className="input" value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Sharpen positioning" />
            </Field>
            <Field label="Model">
              <select className="input" value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}>
                <option value="claude-opus-4-8">claude-opus-4-8 (most capable)</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6 (cheaper, fast)</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5 (cheapest)</option>
              </select>
            </Field>
          </div>
          <Field label="System prompt">
            <textarea className="input" rows={5} value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder="You are a CPO agent that sharpens a product record's fields. Be specific and concise."
              style={{ resize: "vertical", fontFamily: "inherit" }} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: 13.5 }}>
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active (available to run on records)
          </label>
          {error && (
            <div style={{ background: "var(--rdl)", color: "var(--rdt)", borderRadius: 7, padding: "8px 11px", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save agent"}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="muted" style={{ fontSize: 13.5 }}>Loading…</div>
      ) : agents.length === 0 && editing === null ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p className="secondary" style={{ fontSize: 14, marginBottom: 14 }}>No agents yet.</p>
          <button className="btn" onClick={startNew}>+ Create your first agent</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {agents.map((a) => (
            <div key={a.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span>
                  <span className="chip mono">{a.key}</span>
                  {!a.is_active && <span className="chip chip-amber">inactive</span>}
                </div>
                <div className="secondary" style={{ fontSize: 13, marginTop: 3 }}>
                  {a.role || <span className="muted">No role</span>}
                  <span className="muted mono" style={{ marginLeft: 8, fontSize: 11 }}>{a.model}</span>
                </div>
              </div>
              <button className="btn-ghost" onClick={() => startEdit(a)} style={{ flexShrink: 0 }}>Edit</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ts)", display: "block", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
