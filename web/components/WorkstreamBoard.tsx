"use client";

// Module task board — where work actually gets DONE: Build (area=build) or GTM
// (area=gtm). Tasks are the primary thing; a task MAY reference an initiative
// (optional) so that completing it rolls status UP to the initiative board.
// North star: finishing the last task of an initiative's current lifecycle stage
// auto-advances that initiative — you never leave the module to update tracking.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner } from "@/components/ui";

type Task = { id: string; title: string; stage: string; assignee_id: string | null; lifecycle_stage: string; initiative_id: string | null; change_type: string | null; content_type: string | null; release_id: string | null };
type Init = { id: string; title: string; lifecycle: string };
type Person = { id: string; name: string };
type Release = { id: string; name: string; version: string | null };

const COLS = [["backlog", "To do"], ["active", "In progress"], ["done", "Done"]] as const;
const NEXT: Record<string, string> = { backlog: "active", active: "done" };
const PREV: Record<string, string> = { done: "active", active: "backlog" };
const LIFE_ORDER = ["signal", "plan", "build", "launch", "live"];
// Build tasks ship as one of these — feeds the Roadmap release changelog.
const CHANGE_TYPES: [string, string][] = [["feature", "New feature"], ["feature_update", "Feature update"], ["module_update", "Module update"], ["enhancement", "Enhancement"], ["bug_fix", "Bug fix"]];
const CONTENT_LABEL: Record<string, string> = { social: "Social", video: "Video", blog: "Blog", thought_leadership: "Thought leadership", case_study: "Case study", white_paper: "White paper", testimonial: "Testimonial" };

export default function WorkstreamBoard({ area, title, meta }: { area: "build" | "gtm"; title: string; meta: string }) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inits, setInits] = useState<Init[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rolled, setRolled] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", initiativeId: "" });

  const load = useCallback(async () => {
    const [{ data: w }, { data: i }, { data: p }, { data: rel }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, stage, assignee_id, lifecycle_stage, initiative_id, change_type, content_type, release_id").eq("area", area).order("created_at"),
      supabase.from("initiatives").select("id, title, lifecycle").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("people").select("id, name"),
      area === "build" ? supabase.from("releases").select("id, name, version").order("created_at") : Promise.resolve({ data: [] as Release[] }),
    ]);
    setTasks((w ?? []) as Task[]); setInits((i ?? []) as Init[]); setPeople(p ?? []); setReleases((rel ?? []) as Release[]); setLoading(false);
  }, [supabase, area]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const iniOf = (id: string | null) => inits.find((x) => x.id === id) ?? null;

  // Rollup: completing the last task of an initiative's CURRENT lifecycle stage
  // (across both areas) advances that initiative — status flows up to tracking.
  async function rollup(initiativeId: string) {
    const ini = inits.find((x) => x.id === initiativeId);
    if (!ini) { await load(); return; }
    const { data: stageTasks } = await supabase.from("initiative_workstreams").select("stage").eq("initiative_id", initiativeId).eq("lifecycle_stage", ini.lifecycle);
    const all = stageTasks ?? [];
    if (all.length > 0 && all.every((t) => t.stage === "done")) {
      const next = LIFE_ORDER[Math.min(LIFE_ORDER.length - 1, LIFE_ORDER.indexOf(ini.lifecycle) + 1)];
      if (next !== ini.lifecycle) { await supabase.from("initiatives").update({ lifecycle: next }).eq("id", initiativeId); setRolled(`✓ “${ini.title}” advanced to ${next} — its ${ini.lifecycle} work is done.`); setTimeout(() => setRolled(null), 5000); }
    }
    await load();
  }

  async function patch(t: Task, fields: Record<string, unknown>) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update(fields).eq("id", t.id);
    if (error) { setError(error.message); return; }
    if (fields.stage === "done" && t.initiative_id) await rollup(t.initiative_id); else await load();
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const ls = form.initiativeId ? (iniOf(form.initiativeId)?.lifecycle ?? "plan") : "plan";
    const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, area, title: form.title.trim(), initiative_id: form.initiativeId || null, lifecycle_stage: ls, change_type: area === "build" ? "feature" : null });
    if (error) setError(error.message); else { setAdding(false); setForm({ title: "", initiativeId: "" }); load(); }
  }

  return (
    <div>
      <PageHeader title={title} meta={meta} actions={!adding ? <button className="btn" onClick={() => setAdding(true)}>+ Task</button> : undefined} />
      <Banner>{error}</Banner>
      {rolled && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--gn-fill)", color: "var(--gn-text)" }}>{rolled}</div>}

      {adding && (
        <form onSubmit={addTask} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">{area === "build" ? "Build task" : "GTM task"}</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={area === "build" ? "e.g. Implement orchestration API" : "e.g. Draft launch blog post"} /></label>
            <label className="field"><span className="t-label">For initiative (optional)</span>
              <select className="select" value={form.initiativeId} onChange={(e) => setForm({ ...form, initiativeId: e.target.value })}><option value="">— standalone —</option>{inits.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
          </div>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Add task</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : tasks.length === 0 && !adding ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No {area === "build" ? "build" : "GTM"} tasks yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Add a task to start working. Link it to an initiative and completing it advances that initiative on the <a href="/?tab=initiatives" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Initiatives</a> board.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-4)", alignItems: "start" }}>
          {COLS.map(([key, label]) => {
            const list = tasks.filter((x) => x.stage === key);
            return (
              <div key={key}>
                <div className="t-label" style={{ marginBottom: "var(--sp-3)" }}>{label} · {list.length}</div>
                <div className="stack-3">
                  {list.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
                  {list.map((t) => {
                    const ini = iniOf(t.initiative_id);
                    return (
                      <div key={t.id} className="card card-pad" style={{ borderLeft: `3px solid var(--${area === "build" ? "ac" : "vl"})` }}>
                        {ini ? (
                          <a href={`/initiatives/${ini.id}?from=enablement`} title="Open Build Item — scope, technical bundle, readiness" style={{ display: "block", fontSize: 13.5, fontWeight: 620, marginBottom: 6, color: "var(--tp)", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>{t.title}</a>
                        ) : (
                          <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: 6 }}>{t.title}</div>
                        )}
                        {area === "gtm" && t.content_type && <div style={{ marginBottom: 6 }}><Chip tone="violet">{CONTENT_LABEL[t.content_type] ?? t.content_type}</Chip></div>}
                        <div className="row gap-2" style={{ alignItems: "center" }}>
                          <select className="select" value={t.assignee_id ?? ""} onChange={(e) => patch(t, { assignee_id: e.target.value || null })} style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}>
                            <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          {PREV[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(t, { stage: PREV[t.stage] })}>←</button>}
                          {NEXT[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(t, { stage: NEXT[t.stage] })}>{t.stage === "backlog" ? "Start →" : "Done →"}</button>}
                        </div>
                        {/* build tasks ship as a change_type into a release — feeds the Roadmap changelog */}
                        {area === "build" && (
                          <div className="row gap-2" style={{ marginTop: 6 }}>
                            <select className="select" value={t.change_type ?? "feature"} onChange={(e) => patch(t, { change_type: e.target.value })} style={{ flex: 1, fontSize: 11.5, padding: "4px 8px" }}>
                              {CHANGE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <select className="select" value={t.release_id ?? ""} onChange={(e) => patch(t, { release_id: e.target.value || null })} style={{ flex: 1, fontSize: 11.5, padding: "4px 8px" }}>
                              <option value="">No release</option>{releases.map((r) => <option key={r.id} value={r.id}>{r.version ? `${r.version} · ${r.name}` : r.name}</option>)}
                            </select>
                          </div>
                        )}
                        {ini && <a href={`/initiatives/${ini.id}?from=enablement`} className="t-sub" style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: "var(--tm)", textDecoration: "none" }}>↑ {ini.title}</a>}
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
