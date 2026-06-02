"use client";

// Workstreams — the cross-functional execution of one initiative: a Build column
// and a GTM column. Each item has an owner (a person) and a stage you advance.
// This is what makes an initiative span Build + GTM instead of being lane-locked.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip } from "@/components/ui";

type Ws = { id: string; area: string; title: string; assignee_id: string | null; stage: string };
type Person = { id: string; name: string };
const AREAS: [string, string, "accent" | "violet"][] = [["build", "Build", "accent"], ["gtm", "GTM", "violet"]];
const NEXT: Record<string, string> = { backlog: "active", active: "done" };
const PREV: Record<string, string> = { done: "active", active: "backlog" };

export default function Workstreams({ initiativeId }: { initiativeId: string }) {
  const supabase = createClient();
  const [items, setItems] = useState<Ws[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: ws }, { data: pl }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, area, title, assignee_id, stage").eq("initiative_id", initiativeId).order("position").order("created_at"),
      supabase.from("people").select("id, name").eq("is_active", true).order("name"),
    ]);
    setItems((ws ?? []) as Ws[]); setPeople(pl ?? []);
  }, [supabase, initiativeId]);
  useEffect(() => { load(); }, [load]);

  async function add(area: string) {
    if (!title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: initiativeId, area, title: title.trim() });
      if (error) throw error;
      setAdding(null); setTitle(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add."); }
    finally { setBusy(false); }
  }
  async function patch(id: string, fields: Record<string, unknown>) { setError(null); await supabase.from("initiative_workstreams").update(fields).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("initiative_workstreams").delete().eq("id", id); await load(); }
  const ownerName = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

  return (
    <Section label="Workstreams — Build × GTM">
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>This initiative&rsquo;s execution across both sides. Each workstream has an owner and a stage.</div>
      {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
        {AREAS.map(([area, label, tone]) => {
          const list = items.filter((i) => i.area === area);
          return (
            <div key={area} className="card" style={{ overflow: "hidden", borderTop: `2px solid var(--${tone === "accent" ? "ac" : "vl"})` }}>
              <div className="row-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span className="row gap-2"><Chip tone={tone}>{label}</Chip><span className="t-sub t-muted" style={{ fontSize: 12 }}>{list.length}</span></span>
                <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(adding === area ? null : area); setTitle(""); }}>{adding === area ? "Cancel" : "+ Add"}</button>
              </div>
              <div style={{ padding: 12 }} className="stack-3">
                {adding === area && (
                  <form onSubmit={(e) => { e.preventDefault(); add(area); }} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={area === "build" ? "e.g. Ship orchestration v1" : "e.g. Battlecard + launch post"} style={{ marginBottom: 8 }} />
                    <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
                  </form>
                )}
                {list.length === 0 && adding !== area ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No {label.toLowerCase()} workstreams yet.</div> : list.map((w) => (
                  <div key={w.id} className="card card-pad" style={{ padding: 12 }}>
                    <div className="row-between" style={{ gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 620 }}>{w.title}</span>
                      <Chip tone={w.stage === "done" ? "green" : w.stage === "active" ? "accent" : "default"}>{w.stage}</Chip>
                    </div>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <select className="select" value={w.assignee_id ?? ""} onChange={(e) => patch(w.id, { assignee_id: e.target.value || null })} style={{ flex: 1, minWidth: 120, fontSize: 12.5, padding: "5px 8px" }}>
                        <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {PREV[w.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(w.id, { stage: PREV[w.stage] })}>←</button>}
                      {NEXT[w.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(w.id, { stage: NEXT[w.stage] })}>{w.stage === "backlog" ? "Start →" : "Done →"}</button>}
                      <button className="t-muted" onClick={() => remove(w.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                    </div>
                    {ownerName(w.assignee_id) && <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 4 }}>owner: {ownerName(w.assignee_id)}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
