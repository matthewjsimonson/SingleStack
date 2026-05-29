"use client";

// Shared working surface for both record types: agents to run, fields to edit,
// and proposals to review/accept. Differs only by target FK (product/gtm).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, Confidence } from "@/components/ui";

export type Target = { kind: "product" | "gtm"; id: string };

type Field = { id: string; field_key: string; label: string; value: string | null; position: number };
type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; status: string; created_at: string;
};

const fkCol = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

export default function RecordWorkspace({ target }: { target: Target }) {
  const supabase = createClient();
  const fk = fkCol(target);

  const [fields, setFields] = useState<Field[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [newField, setNewField] = useState({ label: "", value: "" });

  const load = useCallback(async () => {
    const [{ data: flds }, { data: ags }, { data: props }] = await Promise.all([
      supabase.from("record_fields").select("id, field_key, label, value, position").eq(fk, target.id).order("position"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("proposals").select("id, title, rationale, conf_label, conf_level, proposed_by, status, created_at").eq(fk, target.id).order("created_at", { ascending: false }),
    ]);
    setFields(flds ?? []);
    setAgents(ags ?? []);
    setProposals(props ?? []);
    setLoading(false);
  }, [supabase, fk, target.id]);

  useEffect(() => { load(); }, [load]);

  async function saveFieldValue(id: string) {
    setError(null);
    const { error } = await supabase.from("record_fields").update({ value: draftValue }).eq("id", id);
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
        org_id: orgId, [fk]: target.id, field_key: key || `field_${Date.now()}`,
        label: newField.label.trim(), value: newField.value.trim() || null, position: fields.length,
      });
      if (error) throw error;
      setAddingField(false); setNewField({ label: "", value: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add field."); }
  }

  async function runAgent(key: string) {
    setRunningKey(key); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const body = target.kind === "product"
        ? { agent_key: key, product_id: target.id }
        : { agent_key: key, gtm_record_id: target.id };
      const { data, error } = await supabase.functions.invoke("agent-propose", {
        body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Agent run failed."); }
    finally { setRunningKey(null); }
  }

  async function accept(id: string) {
    setAcceptingId(id); setError(null);
    try {
      const { error } = await supabase.rpc("accept_proposal", { p_proposal: id, p_ratifier: "web" });
      if (error) throw error;
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Accept failed."); }
    finally { setAcceptingId(null); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Agents */}
      <Section label="Run an agent">
        {agents.length === 0 ? (
          <div className="t-sub t-muted">
            No active agents. <a href="/agents" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Create one →</a>
          </div>
        ) : (
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {agents.map((a) => (
              <button key={a.id} className="btn btn-accent" disabled={runningKey !== null}
                onClick={() => runAgent(a.key)} title={a.role ?? undefined}>
                {runningKey === a.key ? `Running ${a.name}…` : a.name}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Fields */}
      <Section label="Fields" action={!addingField ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingField(true)}>+ Add field</button> : undefined}>
        {addingField && (
          <form onSubmit={addField} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
              <input className="input" placeholder="Label" autoFocus value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
              <input className="input" placeholder="Value" value={newField.value} onChange={(e) => setNewField({ ...newField, value: e.target.value })} />
            </div>
            <div className="row gap-2">
              <button className="btn btn-sm" type="submit">Add</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAddingField(false); setNewField({ label: "", value: "" }); }}>Cancel</button>
            </div>
          </form>
        )}

        <div className="card">
          {fields.length === 0 && !addingField && <div className="card-pad t-sub t-muted">No fields yet.</div>}
          {fields.map((f, i) => (
            <div key={f.id} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <div className="row-between" style={{ marginBottom: 5 }}>
                <span className="t-label">{f.label}</span>
                {editingField !== f.id && (
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditingField(f.id); setDraftValue(f.value ?? ""); }}>Edit</button>
                )}
              </div>
              {editingField === f.id ? (
                <div>
                  <textarea className="textarea" rows={2} value={draftValue} autoFocus onChange={(e) => setDraftValue(e.target.value)} style={{ marginBottom: 8 }} />
                  <div className="row gap-2">
                    <button className="btn btn-sm" onClick={() => saveFieldValue(f.id)}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingField(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="t-body" style={{ lineHeight: 1.55 }}>{f.value || <span className="t-muted">—</span>}</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Proposals */}
      <Section label={<span className="row gap-2" style={{ gap: 8 }}>Proposals {pending.length > 0 && <Chip tone="violet">{pending.length} pending</Chip>}</span>}>
        {pending.length === 0 && <div className="t-sub t-muted">No pending proposals. Run an agent to generate one.</div>}
        <div className="stack-3">
          {pending.map((p) => (
            <div key={p.id} className="card card-pad" style={{ borderLeft: "2px solid var(--vl)" }}>
              <div className="row-between" style={{ gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 15, fontWeight: 620 }}>{p.title}</div>
                <Confidence label={p.conf_label} level={p.conf_level} />
              </div>
              {p.rationale && <p className="t-sub" style={{ lineHeight: 1.55, marginBottom: 14 }}>{p.rationale}</p>}
              <div className="row gap-3">
                <button className="btn btn-success" disabled={acceptingId !== null} onClick={() => accept(p.id)}>
                  {acceptingId === p.id ? "Accepting…" : "Accept"}
                </button>
                <span className="t-mono-xs">{p.proposed_by} · {new Date(p.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {resolved.length > 0 && (
        <Section label="History">
          <div className="stack-3">
            {resolved.map((p) => (
              <div key={p.id} className="card" style={{ padding: "12px 16px" }}>
                <div className="row-between">
                  <span className="t-body">{p.title}</span>
                  <Chip tone={p.status === "accepted" ? "green" : "default"}>{p.status}</Chip>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
