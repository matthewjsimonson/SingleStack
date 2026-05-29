"use client";

// The interactive record view: fields, "Run agent" (calls the agent-propose
// Edge Function with the user's JWT), and proposals with Accept (calls the
// accept_proposal RPC). All actions run as the logged-in user, so RLS scopes
// everything to their org. After an action we refresh server data.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Field = { id: string; field_key: string; label: string; value: string | null; position: number };
type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string;
  title: string;
  rationale: string | null;
  conf_label: string | null;
  conf_level: number | null;
  proposed_by: string;
  status: string;
  created_at: string;
};

export default function RecordView({
  record,
  fields,
  agents,
  proposals,
}: {
  record: { id: string; name: string };
  fields: Field[];
  agents: Agent[];
  proposals: Proposal[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAgent(agentKey: string) {
    setRunningKey(agentKey);
    setError(null);
    try {
      // Call the Edge Function with the user's access token → RLS-scoped run.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error } = await supabase.functions.invoke("agent-propose", {
        body: { agent_key: agentKey, product_id: record.id },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      router.refresh(); // pull in the new proposal
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
      const { error } = await supabase.rpc("accept_proposal", {
        p_proposal: proposalId,
        p_ratifier: "web",
      });
      if (error) throw error;
      router.refresh(); // field values + proposal status update
    } catch (e) {
      setError(e instanceof Error ? e.message : "Accept failed.");
    } finally {
      setAcceptingId(null);
    }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  return (
    <div style={{ maxWidth: 920 }}>
      <a href="/" className="btn-ghost" style={{ display: "inline-block", marginBottom: 18 }}>
        ← Records
      </a>

      <h1 className="serif" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
        {record.name}
      </h1>
      <p className="muted mono" style={{ fontSize: 11, marginBottom: 24 }}>{record.id}</p>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 18, background: "var(--rdl)", color: "var(--rdt)" }}>
          {error}
        </div>
      )}

      {/* Run agents */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
        {agents.length === 0 && (
          <span className="muted" style={{ fontSize: 13 }}>No active agents.</span>
        )}
        {agents.map((a) => (
          <button
            key={a.id}
            className="btn btn-accent"
            disabled={runningKey !== null}
            onClick={() => runAgent(a.key)}
            title={a.role ?? undefined}
          >
            {runningKey === a.key ? `Running ${a.name}…` : `Run ${a.name} ▸`}
          </button>
        ))}
      </div>

      {/* Fields */}
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--ts)" }}>FIELDS</h2>
      <div className="card" style={{ marginBottom: 32 }}>
        {fields.length === 0 && (
          <div style={{ padding: 18 }} className="muted">No fields yet.</div>
        )}
        {fields.map((f, i) => (
          <div
            key={f.id}
            style={{
              padding: "14px 18px",
              borderTop: i === 0 ? "none" : "1px solid var(--cbr)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tm)", marginBottom: 4 }}>
              {f.label}
            </div>
            <div style={{ fontSize: 14.5 }}>{f.value || <span className="muted">—</span>}</div>
          </div>
        ))}
      </div>

      {/* Pending proposals */}
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--ts)" }}>
        PROPOSALS {pending.length > 0 && <span className="chip chip-violet">{pending.length} pending</span>}
      </h2>
      <div style={{ display: "grid", gap: 12, marginBottom: 28 }}>
        {pending.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            No pending proposals. Run an agent above to generate one.
          </div>
        )}
        {pending.map((p) => (
          <div key={p.id} className="card" style={{ padding: 18, borderLeft: "3px solid var(--vlt)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600 }}>{p.title}</div>
              {p.conf_label && (
                <span className="chip chip-violet" style={{ flexShrink: 0 }}>
                  {p.conf_label}
                  {p.conf_level != null ? ` · ${Math.round(p.conf_level * 100)}%` : ""}
                </span>
              )}
            </div>
            {p.rationale && (
              <p className="secondary" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 14 }}>
                {p.rationale}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="btn btn-green"
                disabled={acceptingId !== null}
                onClick={() => accept(p.id)}
              >
                {acceptingId === p.id ? "Accepting…" : "Accept"}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                by {p.proposed_by} · {new Date(p.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Resolved proposals */}
      {resolved.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--ts)" }}>HISTORY</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {resolved.map((p) => (
              <div
                key={p.id}
                className="card"
                style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
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
