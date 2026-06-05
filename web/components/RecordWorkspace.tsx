"use client";

// Shared working surface for both record types: run agents, structured field
// content (delegated to SectionedFields), and proposals to review/accept.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner } from "@/components/ui";
import SectionedFields from "@/components/SectionedFields";
import RecordAdvisors from "@/components/RecordAdvisors";

export type Target = { kind: "product" | "gtm"; id: string };

type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; status: string; created_at: string;
};

const fkCol = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

export default function RecordWorkspace({ target, recordName }: { target: Target; recordName?: string }) {
  const supabase = createClient();
  const fk = fkCol(target);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Drawer actions (accept / reject / hide) call this: refresh proposal counts and,
  // since an accept changes field values, re-mount the content panels.
  const refresh = useCallback(() => { load(); setFieldsNonce((n) => n + 1); }, [load]);

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");
  const pendingByName = pending.reduce<Record<string, number>>((acc, p) => { acc[p.proposed_by] = (acc[p.proposed_by] ?? 0) + 1; return acc; }, {});

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Advisors — the agents that live on this record, aligned to its area */}
      {loading ? <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-6)" }}>Loading…</div>
        : <RecordAdvisors target={target} recordName={recordName} agents={agents} pendingByName={pendingByName} onRan={refresh} />}

      {/* Structured content */}
      <SectionedFields key={fieldsNonce} target={target} />

      {/* Pending proposals live in the Advisors' side drawer (the "N waiting" pill).
          Only resolved proposals are logged here, as history. */}
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
