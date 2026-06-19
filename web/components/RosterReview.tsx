"use client";

// Chief of Staff — roster review. Runs orchestrate-roster (which proposes skill
// evolution across the whole roster, WITH RESTRAINT). Completed reviews wait in a
// SIDE DRAWER: open "Reviews waiting", and each pending recommendation is collapsed
// in a list — click one to expand and ratify it. Holds (what the Chief of Staff
// deliberately left alone) are listed too. Nothing applies without a human.
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
  const [open, setOpen] = useState(false);          // the reviews side drawer
  const [expanded, setExpanded] = useState<string | null>(null); // which review is expanded in the drawer

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
      if ((data?.changes ?? 0) > 0) setOpen(true); // pop the drawer so the results are right there
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
    <>
      <Section label="Chief of Staff — roster review"
        action={
          <div className="row gap-2">
            {changes.length > 0 && (
              <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ background: "var(--vl-fill)", color: "var(--vl-text)", border: "1px solid var(--vl)", fontWeight: 600 }}>
                Reviews waiting · {changes.length}
              </button>
            )}
            <button className="btn btn-sm" onClick={run} disabled={running} style={{ background: "var(--am-text)", color: "#fff" }}>{running ? "Reviewing…" : "Run agent review"}</button>
          </div>
        }>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
          Tunes each agent&apos;s <strong>skills</strong> — cornerstone (always-on) &amp; play (task-specific) — against internal &amp; external signals, to make the agents and their workflows the best they can be for your users. <strong>With restraint:</strong> it changes little on purpose and records what it leaves alone. These are <strong>skill updates for your agents</strong> — separate from <em>proposals</em>, which update your Product/GTM records. Completed reviews wait in the side panel; you ratify each.
        </div>

        {error && <div className="banner banner-error" style={{ marginTop: 12 }}>{error}</div>}
        {note && !error && <div className="banner" style={{ marginTop: 12 }}>{note}</div>}

        {!loading && changes.length > 0 && (
          <div className="t-sub" style={{ fontSize: 13, marginTop: 12 }}>
            <strong>{changes.length}</strong> recommendation{changes.length === 1 ? "" : "s"} waiting{holds.length ? ` · ${holds.length} held` : ""}.{" "}
            <button onClick={() => setOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--ac-text)", fontWeight: 600, cursor: "pointer" }}>Open reviews →</button>
          </div>
        )}
      </Section>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
            <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 660 }}>Roster reviews</div>
                <div className="t-sub t-muted" style={{ fontSize: 12 }}>Agent skill updates · {changes.length} waiting{holds.length ? ` · ${holds.length} held` : ""}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Close</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

              {changes.length === 0 ? (
                <div className="t-sub t-muted" style={{ fontSize: 13 }}>All caught up — no recommendations waiting. Run a review to have the Chief of Staff check the roster.</div>
              ) : (
                <div className="stack-2">
                  {changes.map((r) => {
                    const isOpen = expanded === r.id;
                    return (
                      <div key={r.id} className="card" style={{ overflow: "hidden" }}>
                        {/* collapsed header — click to expand */}
                        <div onClick={() => setExpanded(isOpen ? null : r.id)} className="row-between" style={{ gap: 10, padding: "11px 13px", cursor: "pointer", alignItems: "center" }}>
                          <div className="row gap-2" style={{ minWidth: 0, alignItems: "center", flexWrap: "wrap" }}>
                            <Chip tone={r.kind === "new_skill" ? "green" : "accent"}>{r.kind === "new_skill" ? "new skill" : "revise"}</Chip>
                            {r.agent_key && <Chip>{r.agent_key}</Chip>}
                            <span style={{ fontSize: 13.5, fontWeight: 640 }}>{r.title}</span>
                          </div>
                          <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{isOpen ? "▲" : "▾"}</span>
                        </div>

                        {isOpen && (
                          <div style={{ padding: "0 13px 13px", borderTop: "1px solid var(--border)" }}>
                            {r.rationale && <div className="t-sub" style={{ fontSize: 12.5, margin: "10px 0 8px" }}><strong>Why:</strong> {r.rationale}</div>}
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
                        )}
                      </div>
                    );
                  })}

                  {holds.length > 0 && (
                    <div className="card card-pad" style={{ background: "var(--panel-2)", marginTop: 6 }}>
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
            </div>
          </aside>
        </>
      )}
    </>
  );
}
