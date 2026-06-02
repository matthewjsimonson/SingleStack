"use client";

// Initiative detail — the card's own page: stage-aware and scope-aware. An
// initiative is Product, GTM, or both, and moves through the PLG lifecycle
// (Signal → Plan → Build → Launch → Live). Each stage dictates DIFFERENT work
// per side; you complete the current stage's tasks to advance (gated). This is
// NOT the Ship build workspace — it's the cross-functional motion's cockpit.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, BackLink, Spinner } from "@/components/ui";

type Initiative = { id: string; title: string; description: string | null; scope: string; lifecycle: string; kind: string | null; assignee_id: string | null; objective_id: string | null };
type Task = { id: string; area: string; lifecycle_stage: string; title: string; stage: string; assignee_id: string | null };
type Person = { id: string; name: string };

// The lifecycle, with the work each stage means per side.
const LIFE: { key: string; label: string; product: string; gtm: string }[] = [
  { key: "signal", label: "Signal", product: "Watch · validate · gather", gtm: "Watch · validate · gather" },
  { key: "plan", label: "Plan", product: "Spec & prototype", gtm: "Messaging & GTM strategy" },
  { key: "build", label: "Build", product: "Prototype, build & test", gtm: "Set up campaigns & content" },
  { key: "launch", label: "Launch", product: "Ship the feature / fix", gtm: "Launch the campaign" },
  { key: "live", label: "Live", product: "Track, analyze & report", gtm: "Track, analyze & report" },
];
const ORDER = LIFE.map((s) => s.key);
const SCOPE_LABEL: Record<string, string> = { product: "Product", gtm: "GTM", both: "Product + GTM" };

export default function InitiativeDetail({ id }: { id: string }) {
  const supabase = createClient();
  const [ini, setIni] = useState<Initiative | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // area being added to
  const [title, setTitle] = useState("");

  const load = useCallback(async () => {
    const [{ data: i }, { data: w }, { data: p }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, scope, lifecycle, kind, assignee_id, objective_id").eq("id", id).maybeSingle(),
      supabase.from("initiative_workstreams").select("id, area, lifecycle_stage, title, stage, assignee_id").eq("initiative_id", id),
      supabase.from("people").select("id, name").eq("is_active", true).order("name"),
    ]);
    setIni(i as Initiative | null); setTasks((w ?? []) as Task[]); setPeople(p ?? []); setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Opening initiative…" />;
  if (!ini) return <Banner>Initiative not found.</Banner>;

  const stageIdx = Math.max(0, ORDER.indexOf(ini.lifecycle));
  const cur = LIFE[stageIdx];
  const sides: string[] = ini.scope === "product" ? ["build"] : ini.scope === "gtm" ? ["gtm"] : ["build", "gtm"];
  const ownerName = (pid: string | null) => people.find((p) => p.id === pid)?.name ?? null;
  const stageTasks = (area: string) => tasks.filter((t) => t.area === area && t.lifecycle_stage === ini.lifecycle);
  const curTasks = sides.flatMap((s) => stageTasks(s));
  const blocking = curTasks.filter((t) => t.stage !== "done").length;

  async function addTask(area: string) {
    if (!title.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: id, area, lifecycle_stage: ini!.lifecycle, title: title.trim() });
    if (error) setError(error.message); else { setAdding(null); setTitle(""); load(); }
  }
  async function patchTask(tid: string, fields: Record<string, unknown>) { setError(null); await supabase.from("initiative_workstreams").update(fields).eq("id", tid); load(); }
  async function delTask(tid: string) { setError(null); await supabase.from("initiative_workstreams").delete().eq("id", tid); load(); }
  async function moveStage(dir: number) {
    const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, stageIdx + dir))];
    setError(null); await supabase.from("initiatives").update({ lifecycle: next }).eq("id", id); load();
  }

  return (
    <div>
      <BackLink href="/?tab=initiatives" label="Initiatives" />
      <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        <Chip tone={ini.scope === "gtm" ? "violet" : "accent"}>{SCOPE_LABEL[ini.scope] ?? ini.scope}</Chip>
        {ini.kind && <Chip>{ini.kind}</Chip>}
        {ownerName(ini.assignee_id) ? <Chip tone="green">👤 {ownerName(ini.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 4 }}>{ini.title}</h1>
      {ini.description && <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-5)", maxWidth: 720 }}>{ini.description}</div>}
      <Banner>{error}</Banner>

      {/* lifecycle rail */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
        <div className="row" style={{ gap: 0, flexWrap: "wrap" }}>
          {LIFE.map((s, idx) => {
            const state = idx < stageIdx ? "done" : idx === stageIdx ? "cur" : "todo";
            return (
              <div key={s.key} className="row gap-2" style={{ alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px" }}>
                  <span style={{ width: 26, height: 26, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                    background: state === "cur" ? "var(--ac)" : state === "done" ? "var(--gn)" : "var(--fill-2)", color: state === "todo" ? "var(--tm)" : "#fff" }}>{state === "done" ? "✓" : idx + 1}</span>
                  <span className="t-mono-xs" style={{ marginTop: 4, fontWeight: state === "cur" ? 700 : 400, color: state === "cur" ? "var(--tp)" : "var(--tm)" }}>{s.label}</span>
                </div>
                {idx < LIFE.length - 1 && <span style={{ width: 22, height: 2, background: idx < stageIdx ? "var(--gn)" : "var(--border)" }} />}
              </div>
            );
          })}
        </div>
        <div className="row-between" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>{blocking > 0 ? `${blocking} task${blocking === 1 ? "" : "s"} left in “${cur.label}” before you can advance.` : `“${cur.label}” is clear — ready to advance.`}</span>
          <div className="row gap-2">
            {stageIdx > 0 && <button className="btn btn-secondary btn-sm" onClick={() => moveStage(-1)}>← {LIFE[stageIdx - 1].label}</button>}
            {stageIdx < ORDER.length - 1 && <button className="btn btn-sm" disabled={blocking > 0} title={blocking > 0 ? "Complete this stage's tasks first" : ""} onClick={() => moveStage(1)}>Advance to {LIFE[stageIdx + 1].label} →</button>}
          </div>
        </div>
      </div>

      {/* current stage's work, per side (scope-aware) */}
      <div style={{ display: "grid", gridTemplateColumns: sides.length === 2 ? "1fr 1fr" : "1fr", gap: "var(--sp-4)" }}>
        {sides.map((area) => {
          const list = stageTasks(area);
          const label = area === "build" ? cur.product : cur.gtm;
          const tone = area === "build" ? "accent" : "violet";
          return (
            <div key={area} className="card" style={{ overflow: "hidden", borderTop: `2px solid var(--${tone === "accent" ? "ac" : "vl"})` }}>
              <div className="row-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span className="row gap-2"><Chip tone={tone}>{area === "build" ? "Product" : "GTM"}</Chip><span style={{ fontSize: 13, fontWeight: 640 }}>{label}</span></span>
                <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(adding === area ? null : area); setTitle(""); }}>{adding === area ? "Cancel" : "+ Task"}</button>
              </div>
              <div style={{ padding: 12 }} className="stack-3">
                {adding === area && (
                  <form onSubmit={(e) => { e.preventDefault(); addTask(area); }} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${cur.label} task…`} style={{ marginBottom: 8 }} />
                    <button className="btn btn-sm" type="submit">Add</button>
                  </form>
                )}
                {list.length === 0 && adding !== area ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No {cur.label.toLowerCase()} tasks yet for this side.</div> : list.map((t) => (
                  <div key={t.id} className="card card-pad" style={{ padding: 10 }}>
                    <div className="row gap-2" style={{ alignItems: "flex-start" }}>
                      <input type="checkbox" checked={t.stage === "done"} onChange={(e) => patchTask(t.id, { stage: e.target.checked ? "done" : "active" })} style={{ marginTop: 3 }} />
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, textDecoration: t.stage === "done" ? "line-through" : "none", color: t.stage === "done" ? "var(--tm)" : "var(--tp)" }}>{t.title}</span>
                      <button className="t-muted" onClick={() => delTask(t.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <select className="select" value={t.assignee_id ?? ""} onChange={(e) => patchTask(t.id, { assignee_id: e.target.value || null })} style={{ fontSize: 12, padding: "4px 8px" }}>
                        <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
