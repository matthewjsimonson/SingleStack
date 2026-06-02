"use client";

// Workstream board — the execution surface for Build (area=build) or GTM
// (area=gtm). It shows the WORKSTREAMS (the actual tasks) across all initiatives,
// not lane-locked initiative cards. Each task ladders back to its initiative
// (the cross-functional effort) and its lifecycle stage. This is where the work
// gets done; the initiative is the motion above it. Columns = task status.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Chip, Banner } from "@/components/ui";

type Ws = { id: string; title: string; stage: string; assignee_id: string | null; lifecycle_stage: string; initiative_id: string };
type Init = { id: string; title: string; lifecycle: string; scope: string };
type Person = { id: string; name: string };

const COLS = [["backlog", "To do"], ["active", "In progress"], ["done", "Done"]] as const;
const NEXT: Record<string, string> = { backlog: "active", active: "done" };
const PREV: Record<string, string> = { done: "active", active: "backlog" };

export default function WorkstreamBoard({ area, title, meta }: { area: "build" | "gtm"; title: string; meta: string }) {
  const supabase = createClient();
  const [ws, setWs] = useState<Ws[]>([]);
  const [inits, setInits] = useState<Record<string, Init>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: w }, { data: i }, { data: p }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, stage, assignee_id, lifecycle_stage, initiative_id").eq("area", area).order("created_at"),
      supabase.from("initiatives").select("id, title, lifecycle, scope"),
      supabase.from("people").select("id, name"),
    ]);
    setWs((w ?? []) as Ws[]);
    setInits(Object.fromEntries(((i ?? []) as Init[]).map((x) => [x.id, x])));
    setPeople(p ?? []); setLoading(false);
  }, [supabase, area]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  async function patch(id: string, fields: Record<string, unknown>) { setError(null); const { error } = await supabase.from("initiative_workstreams").update(fields).eq("id", id); if (error) setError(error.message); else load(); }

  return (
    <div>
      <PageHeader title={title} meta={meta} />
      <Banner>{error}</Banner>
      {loading ? <div className="t-sub t-muted">Loading…</div> : ws.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No {area === "build" ? "build" : "GTM"} work yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Work shows up here when an <a href="/?tab=initiatives" style={{ color: "var(--ac-text)", fontWeight: 600 }}>initiative</a> adds {area === "build" ? "Build" : "GTM"} tasks. This is the execution surface — the initiative is the motion above it.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-4)", alignItems: "start" }}>
          {COLS.map(([key, label]) => {
            const list = ws.filter((x) => x.stage === key);
            return (
              <div key={key}>
                <div className="t-label" style={{ marginBottom: "var(--sp-3)" }}>{label} · {list.length}</div>
                <div className="stack-3">
                  {list.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
                  {list.map((t) => {
                    const ini = inits[t.initiative_id];
                    return (
                      <div key={t.id} className="card card-pad" style={{ borderLeft: `3px solid var(--${area === "build" ? "ac" : "vl"})` }}>
                        <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: 6 }}>{t.title}</div>
                        {ini && <a href={`/initiatives/${ini.id}`} className="row gap-2" style={{ textDecoration: "none", marginBottom: 8 }}><Chip tone={area === "build" ? "accent" : "violet"}>{ini.title}</Chip><span className="t-mono-xs" style={{ color: "var(--tm)" }}>{ini.lifecycle}</span></a>}
                        <div className="row gap-2" style={{ alignItems: "center" }}>
                          <select className="select" value={t.assignee_id ?? ""} onChange={(e) => patch(t.id, { assignee_id: e.target.value || null })} style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}>
                            <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          {PREV[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(t.id, { stage: PREV[t.stage] })}>←</button>}
                          {NEXT[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(t.id, { stage: NEXT[t.stage] })}>→</button>}
                        </div>
                        {owner(t.assignee_id) && <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 4 }}>owner: {owner(t.assignee_id)}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
