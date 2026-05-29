"use client";

// Shared working surface for both record types: run agents, structured field
// content (delegated to SectionedFields), and proposals to review/accept.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner, Confidence } from "@/components/ui";
import SectionedFields from "@/components/SectionedFields";

export type Target = { kind: "product" | "gtm"; id: string };

type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; status: string; created_at: string;
};

const fkCol = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

export default function RecordWorkspace({ target }: { target: Target }) {
  const supabase = createClient();
  const fk = fkCol(target);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldsNonce, setFieldsNonce] = useState(0); // bump to refresh SectionedFields after accept

  const load = useCallback(async () => {
    const [{ data: ags }, { data: props }] = await Promise.all([
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("proposals").select("id, title, rationale, conf_label, conf_level, proposed_by, status, created_at").eq(fk, target.id).order("created_at", { ascending: false }),
    ]);
    setAgents(ags ?? []);
    setProposals(props ?? []);
    setLoading(false);
  }, [supabase, fk, target.id]);

  useEffect(() => { load(); }, [load]);

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
      setFieldsNonce((n) => n + 1); // field values changed — refresh the content panels
    } catch (e) { setError(e instanceof Error ? e.message : "Accept failed."); }
    finally { setAcceptingId(null); }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Agents */}
      <Section label="Run an agent">
        {loading ? <div className="t-sub t-muted">Loading…</div>
          : agents.length === 0 ? (
            <div className="t-sub t-muted">No active agents. <a href="/agents" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Create one →</a></div>
          ) : (
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {agents.map((a) => (
                <button key={a.id} className="btn btn-accent" disabled={runningKey !== null} onClick={() => runAgent(a.key)} title={a.role ?? undefined}>
                  {runningKey === a.key ? `Running ${a.name}…` : a.name}
                </button>
              ))}
            </div>
          )}
      </Section>

      {/* Structured content */}
      <SectionedFields key={fieldsNonce} target={target} />

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
