"use client";

// Record detail — the working surface:
//   • view + inline-edit field values (type and save, no SQL)
//   • add new fields
//   • run any active agent (calls agent-propose with the user's JWT)
//   • review proposals and Accept (calls accept_proposal RPC → applies + ratifies)
// All client-side with the session-carrying browser client, so RLS scopes
// everything to the caller's org. Reloads data after each mutation.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";

type Field = { id: string; field_key: string; label: string; value: string | null; position: number };
type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; status: string; created_at: string;
};

export default function RecordView({ recordId }: { recordId: string }) {
  const supabase = createClient();
  const [record, setRecord] = useState<{ id: string; name: string } | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // inline field editing
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [newField, setNewField] = useState({ label: "", value: "" });

  const load = useCallback(async () => {
    const [{ data: rec }, { data: flds }, { data: ags }, { data: props }] = await Promise.all([
      supabase.from("product_records").select("id, name").eq("id", recordId).maybeSingle(),
      supabase.from("record_fields").select("id, field_key, label, value, position").eq("product_id", recordId).order("position"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("proposals").select("id, title, rationale, conf_label, conf_level, proposed_by, status, created_at").eq("product_id", recordId).order("created_at", { ascending: false }),
    ]);
    setRecord(rec);
    setFields(flds ?? []);
    setAgents(ags ?? []);
    setProposals(props ?? []);
    setLoading(false);
  }, [supabase, recordId]);

  useEffect(() => { load(); }, [load]);

  async function saveFieldValue(fieldId: string) {
    setError(null);
    const { error } = await supabase.from("record_fields").update({ value: draftValue }).eq("id", fieldId);
    if (error) setError(error.message);
    setEditingField(null);
    await load();
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newField.label.trim()) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const key = newField.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const { error } = await supabase.from("record_fields").insert({
        org_id: orgId, product_id: recordId, field_key: key || `field_${Date.now()}`,
        label: newField.label.trim(), value: newField.value.trim() || null, position: fields.length,
      });
      if (error) throw error;
      setAddingField(false);
      setNewField({ label: "", value: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add field.");
    }
  }

  async function runAgent(agentKey: string) {
    setRunningKey(agentKey);
    setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("agent-propose", {
        body: { agent_key: agentKey, product_id: recordId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent run failed.");
    } finally {
      setRunningKey(null);
    }
  }

  async function accept(proposalId: string) {
    setAcceptingId(proposalId);
    setError(null);
    try {
      const { error } = await supabase.rpc("accept_proposal", { p_proposal: proposalId, p_ratifier: "web" });
      if (error) throw error;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Accept failed.");
    } finally {
      setAcceptingId(null);
    }
  }

  if (loading) return <div className="muted" style={{ fontSize: 13.5 }}>Loading…</div>;
  if (!record) return <div className="card" style={{ padding: 24 }}>Record not found.</div>;

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  return (
    <div style={{ maxWidth: 920 }}>
      <a href="/" className="btn-ghost" style={{ display: "inline-block", marginBottom: 18 }}>← Records</a>
      <h1 className="serif" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>{record.name}</h1>
      <p className="muted mono" style={{ fontSize: 11, marginBottom: 22 }}>{record.id}</p>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 18, background: "var(--rdl)", color: "var(--rdt)" }}>{error}</div>
      )}

      {/* Run agents */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28, alignItems: "center" }}>
        {agents.length === 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            No active agents. <a href="/agents" style={{ color: "var(--at)", fontWeight: 600 }}>Create one →</a>
          </span>
        ) : (
          agents.map((a) => (
            <button key={a.id} className="btn btn-accent" disabled={runningKey !== null}
              onClick={() => runAgent(a.key)} title={a.role ?? undefined}>
              {runningKey === a.key ? `Running ${a.name}…` : `Run ${a.name} ▸`}
            </button>
          ))
        )}
      </div>

      {/* Fields */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--ts)" }}>FIELDS</h2>
        {!addingField && <button className="btn-ghost" onClick={() => setAddingField(true)}>+ Add field</button>}
      </div>

      {addingField && (
        <form onSubmit={addField} className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
            <input className="input" placeholder="Label (e.g. Positioning)" autoFocus
              value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
            <input className="input" placeholder="Value"
              value={newField.value} onChange={(e) => setNewField({ ...newField, value: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="submit">Add</button>
            <button type="button" className="btn-ghost" onClick={() => { setAddingField(false); setNewField({ label: "", value: "" }); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card" style={{ marginBottom: 32 }}>
        {fields.length === 0 && !addingField && <div style={{ padding: 18 }} className="muted">No fields yet. Add one above.</div>}
        {fields.map((f, i) => (
          <div key={f.id} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--cbr)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tm)" }}>{f.label}</span>
              {editingField !== f.id && (
                <button className="btn-ghost" style={{ padding: "3px 9px", fontSize: 12 }}
                  onClick={() => { setEditingField(f.id); setDraftValue(f.value ?? ""); }}>Edit</button>
              )}
            </div>
            {editingField === f.id ? (
              <div>
                <textarea className="input" rows={2} value={draftValue} autoFocus
                  onChange={(e) => setDraftValue(e.target.value)} style={{ resize: "vertical", marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => saveFieldValue(f.id)}>Save</button>
                  <button className="btn-ghost" style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => setEditingField(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14.5 }}>{f.value || <span className="muted">—</span>}</div>
            )}
          </div>
        ))}
      </div>

      {/* Pending proposals */}
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--ts)" }}>
        PROPOSALS {pending.length > 0 && <span className="chip chip-violet">{pending.length} pending</span>}
      </h2>
      <div style={{ display: "grid", gap: 12, marginBottom: 28 }}>
        {pending.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>No pending proposals. Run an agent above to generate one.</div>
        )}
        {pending.map((p) => (
          <div key={p.id} className="card" style={{ padding: 18, borderLeft: "3px solid var(--vlt)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600 }}>{p.title}</div>
              {p.conf_label && (
                <span className="chip chip-violet" style={{ flexShrink: 0 }}>
                  {p.conf_label}{p.conf_level != null ? ` · ${Math.round(p.conf_level * 100)}%` : ""}
                </span>
              )}
            </div>
            {p.rationale && <p className="secondary" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 14 }}>{p.rationale}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-green" disabled={acceptingId !== null} onClick={() => accept(p.id)}>
                {acceptingId === p.id ? "Accepting…" : "Accept"}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>by {p.proposed_by} · {new Date(p.created_at).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--ts)" }}>HISTORY</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {resolved.map((p) => (
              <div key={p.id} className="card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>{p.title}</span>
                <span className={`chip ${p.status === "accepted" ? "chip-green" : ""}`}>{p.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
