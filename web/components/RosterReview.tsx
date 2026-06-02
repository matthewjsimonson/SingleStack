"use client";

// Chief of Staff — roster review. Runs orchestrate-roster (which proposes skill
// evolution across the whole roster, WITH RESTRAINT) and lets the operator
// ratify each change. Holds (what the Chief of Staff deliberately left alone)
// are shown too — the anti-over-rotation record. Nothing applies without a human.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip } from "@/components/ui";

type Driver = { kind?: string; title: string };
type Payload = { instructions?: string; name?: string; description?: string; category?: string };
type Rec = {
  id: string; kind: "revise_skill" | "new_skill" | "hold"; agent_id: string | null; agent_key: string | null;
  skill_id: string | null; title: string; rationale: string | null; drivers: Driver[] | null; payload: Payload | null; created_at: string;
};

export default function RosterReview({ onChanged }: { onChanged?: () => void }) {
  const supabase = createClient();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("roster_recommendations")
      .select("id, kind, agent_id, agent_key, skill_id, title, rationale, drivers, payload, created_at")
      .eq("status", "pending").order("created_at", { ascending: false });
    const rs = (data ?? []) as Rec[];
    setRecs(rs);
    setDrafts(Object.fromEntries(rs.filter((r) => r.kind !== "hold").map((r) => [r.id, r.payload?.instructions ?? ""])));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function run() {
    setRunning(true); setError(null); setNote(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("orchestrate-roster", {
        body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.message) setNote(data.message);
      else setNote(`Review complete — ${data?.changes ?? 0} change${data?.changes === 1 ? "" : "s"} proposed, ${data?.holds ?? 0} held.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not run review."); }
    finally { setRunning(false); }
  }

  async function accept(r: Rec) {
    setBusy(r.id); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const drivers = (r.drivers ?? []).map((d) => ({ kind: "intelligence", title: d.title }));
      if (r.kind === "revise_skill") {
        if (!r.skill_id) throw new Error("Recommendation has no target skill.");
        const { error } = await supabase.rpc("apply_skill_evolution", { p_skill: r.skill_id, p_instructions: drafts[r.id] ?? r.payload?.instructions ?? "", p_drivers: drivers, p_note: r.rationale });
        if (error) throw error;
      } else if (r.kind === "new_skill") {
        if (!r.agent_id) throw new Error("Recommendation has no target agent.");
        const name = (r.payload?.name ?? r.title).trim();
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
        let { data: created, error: insErr } = await supabase.from("skills")
          .insert({ org_id: orgId, key: base, name, description: r.payload?.description ?? null, instructions: null, category: r.payload?.category ?? "general", source: "evolved" })
          .select("id").single();
        if (insErr && (insErr as { code?: string }).code === "23505") {
          ({ data: created, error: insErr } = await supabase.from("skills")
            .insert({ org_id: orgId, key: `${base}_${Date.now().toString(36)}`, name, description: r.payload?.description ?? null, instructions: null, category: r.payload?.category ?? "general", source: "evolved" })
            .select("id").single());
        }
        if (insErr) throw insErr;
        await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: r.agent_id, skill_id: created!.id });
        const { error: rpcErr } = await supabase.rpc("apply_skill_evolution", { p_skill: created!.id, p_instructions: drafts[r.id] ?? r.payload?.instructions ?? "", p_drivers: drivers, p_note: r.rationale });
        if (rpcErr) throw rpcErr;
      }
      await supabase.from("roster_recommendations").update({ status: "accepted", decided_at: new Date().toISOString() }).eq("id", r.id);
      setRecs((prev) => prev.filter((x) => x.id !== r.id));
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply recommendation."); }
    finally { setBusy(null); }
  }

  async function dismiss(r: Rec) {
    setBusy(r.id); setError(null);
    await supabase.from("roster_recommendations").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", r.id);
    setRecs((prev) => prev.filter((x) => x.id !== r.id));
    setBusy(null);
  }

  const changes = recs.filter((r) => r.kind !== "hold");
  const holds = recs.filter((r) => r.kind === "hold");

  return (
    <Section label="Chief of Staff — roster review"
      action={<button className="btn btn-sm" onClick={run} disabled={running} style={{ background: "#D97706", color: "#fff" }}>{running ? "Reviewing…" : "✦ Run agent review"}</button>}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Reviews every agent&apos;s skills against durable intelligence &amp; new capabilities and proposes updates — <strong>with restraint</strong>. It changes little on purpose and records what it deliberately leaves alone. You ratify each change.
      </div>

      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}
      {note && !error && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      {loading ? <div className="t-sub t-muted">Loading…</div> : recs.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 13 }}>No pending recommendations. Run a review to have the Chief of Staff check the roster.</div>
      ) : (
        <div className="stack-3">
          {changes.map((r) => (
            <div key={r.id} className="card card-pad">
              <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                <Chip tone={r.kind === "new_skill" ? "green" : "accent"}>{r.kind === "new_skill" ? "new skill" : "revise"}</Chip>
                {r.agent_key && <Chip>{r.agent_key}</Chip>}
                <span style={{ fontSize: 14, fontWeight: 640 }}>{r.title}</span>
              </div>
              {r.rationale && <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>Why:</strong> {r.rationale}</div>}
              {(r.drivers?.length ?? 0) > 0 && (
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>{r.drivers!.map((d, i) => <Chip key={i}>{d.title}</Chip>)}</div>
              )}
              <label className="field"><span className="t-label">Proposed instructions (edit before accepting)</span>
                <textarea className="textarea" rows={7} value={drafts[r.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} /></label>
              <div className="row gap-2">
                <button className="btn btn-success btn-sm" onClick={() => accept(r)} disabled={busy === r.id}>{busy === r.id ? "Applying…" : "Accept"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r)} disabled={busy === r.id}>Dismiss</button>
              </div>
            </div>
          ))}

          {holds.length > 0 && (
            <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Considered, holding ({holds.length}) — restraint</div>
              <div className="stack-3">
                {holds.map((r) => (
                  <div key={r.id} className="row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>{r.agent_key && <Chip>{r.agent_key}</Chip>}<span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span></div>
                      {r.rationale && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{r.rationale}</div>}
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r)} disabled={busy === r.id}>Clear</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
