"use client";

// Build Item cockpit — TABBED by workflow step, not one long scroll. The build
// workflow starts at PLAN (Signal lives upstream in Product Strategy); if it's
// here, it's approved. Each tab is a DISTINCT step with its own job:
//   Plan    → define the Product Scope (what/why) — the spec
//   Build   → Technical Scope (context bundle, agent brief, readiness) + tasks
//   Launch  → take it to market (GTM tasks) — only when there's GTM scope
//   Live    → measure the outcome (Proof)
//   Advisors→ officer analyses, compact (one column)
// Status is DERIVED from real progress (scope %, readiness, build_state) — never
// asserted. An item with no scope reads "Not started", not "Build".
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, BackLink, Spinner, SubTabs } from "@/components/ui";
import PlaysPanel, { type PlayDef } from "@/components/PlaysPanel";
import BuildScope from "@/components/BuildScope";
import TechnicalScope from "@/components/TechnicalScope";
import { BUILD_TEMPLATE } from "@/lib/templates";

const INITIATIVE_PLAYS: PlayDef[] = [
  { key: "initiative_review", label: "Initiative review", officer: "CPO", tone: "accent" },
  { key: "delivery_risk", label: "Delivery risk", officer: "Chief Eng", tone: "accent" },
  { key: "gtm_readiness", label: "GTM readiness", officer: "CRO", tone: "violet" },
];

type Initiative = { id: string; title: string; description: string | null; scope: string; kind: string | null; assignee_id: string | null; build_state: string | null; is_unevidenced: boolean; release_id: string | null };
type Task = { id: string; area: string; title: string; stage: string; assignee_id: string | null };
type Person = { id: string; name: string };
type Field = { field_key: string; value: string | null };
type Link = { kind: string };

const KIND_LABEL: Record<string, string> = { bugfix: "Fix", enhancement: "Enhancement", feature: "New Feature", module: "New Module", product: "Product" };
const SCOPE_KEYS = BUILD_TEMPLATE.flatMap((s) => s.fields.map((f) => f.key));
const TASK_NEXT: Record<string, string> = { backlog: "active", active: "done" };

export default function InitiativeDetail({ id }: { id: string }) {
  const supabase = createClient();
  const params = useSearchParams();
  const fromShip = params.get("from") === "ship";

  const [ini, setIni] = useState<Initiative | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("plan");
  const tabPinned = useRef(false); // don't override the user's tab choice on reload
  const [newTask, setNewTask] = useState("");

  const load = useCallback(async () => {
    const [{ data: i }, { data: w }, { data: p }, { data: fl }, { data: lk }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, scope, kind, assignee_id, build_state, is_unevidenced, release_id").eq("id", id).maybeSingle(),
      supabase.from("initiative_workstreams").select("id, area, title, stage, assignee_id").eq("initiative_id", id),
      supabase.from("people").select("id, name").eq("is_active", true).order("name"),
      supabase.from("initiative_fields").select("field_key, value").eq("initiative_id", id),
      supabase.from("build_context_links").select("kind").eq("initiative_id", id),
    ]);
    setIni(i as Initiative | null); setTasks((w ?? []) as Task[]); setPeople(p ?? []); setFields((fl ?? []) as Field[]); setLinks((lk ?? []) as Link[]);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Opening Build Item…" />;
  if (!ini) return <Banner>Build Item not found.</Banner>;

  const ownerName = (pid: string | null) => people.find((p) => p.id === pid)?.name ?? null;
  const fv = new Map(fields.map((f) => [f.field_key, (f.value ?? "").trim()]));
  const scopePct = Math.round((SCOPE_KEYS.filter((k) => fv.get(k)).length / SCOPE_KEYS.length) * 100);
  const ready = links.length > 0 && links.some((l) => l.kind === "skill_ref") && !!fv.get("acceptance_criteria") && !!fv.get("test_approach");
  const hasGtm = ini.scope === "gtm" || ini.scope === "both";

  // Honest status, derived from real progress — never asserted.
  const status = ((): { label: string; tone: "default" | "accent" | "violet" | "green" | "amber"; tab: string } => {
    switch (ini.build_state) {
      case "shipped": return { label: "Shipped", tone: "green", tab: "live" };
      case "in_build": return { label: "In build", tone: "accent", tab: "build" };
      case "ready_for_agent": return { label: "Ready for agent", tone: "green", tab: "build" };
    }
    if (scopePct === 0) return { label: "Not started", tone: "amber", tab: "plan" };
    if (scopePct < 100) return { label: `Planning · scope ${scopePct}%`, tone: "amber", tab: "plan" };
    return { label: "Scoped — ready to build", tone: "accent", tab: "build" };
  })();

  // Default the active tab to the honest current step, once.
  if (!tabPinned.current) { tabPinned.current = true; setTab(status.tab); }

  const tabs = [
    { key: "plan", label: "Plan" },
    { key: "build", label: "Build" },
    ...(hasGtm ? [{ key: "launch", label: "Launch" }] : []),
    { key: "live", label: "Live" },
    { key: "advisors", label: "Advisors" },
  ];

  async function patchTask(t: Task, stage: string) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update({ stage }).eq("id", t.id);
    if (error) { setError(error.message); return; }
    await load();
  }
  async function addTask(area: "build" | "gtm") {
    if (!newTask.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: id, area, lifecycle_stage: "build", title: newTask.trim(), stage: "backlog" });
    if (error) { setError(error.message); return; }
    setNewTask(""); await load();
  }

  return (
    <div>
      <BackLink href={fromShip ? "/ship" : "/?tab=initiatives"} label={fromShip ? "Ship" : "Initiatives"} />
      <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
        {ini.kind && <Chip>{KIND_LABEL[ini.kind] ?? ini.kind}</Chip>}
        <Chip tone={status.tone}>{status.label}</Chip>
        {ownerName(ini.assignee_id) ? <Chip tone="green">{ownerName(ini.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
        {ini.is_unevidenced && <span title="Scope entered manually with no linked Signal evidence."><Chip tone="amber">⚠ no evidence</Chip></span>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 4 }}>{ini.title}</h1>
      {ini.description && <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-5)", maxWidth: 720 }}>{ini.description}</div>}
      <Banner>{error}</Banner>

      <SubTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "plan" && (
        <StepIntro title="Plan — define what you're building"
          body="Capture the Why / What / How / Proof. A complete scope is what makes this buildable; fill it in to move to Build." />
      )}
      {tab === "plan" && <BuildScope initiativeId={ini.id} />}

      {tab === "build" && (
        <StepIntro title="Build — get it agent-ready, then build it"
          body="Assemble the Technical Scope — the context bundle and prompt a coding agent needs. When the readiness checks pass, hand off the build brief from Ship." />
      )}
      {tab === "build" && (
        <>
          <TechnicalScope initiativeId={ini.id} />
          <TaskList area="build" title="Build tasks" tasks={tasks.filter((t) => t.area === "build")} ownerName={ownerName}
            onAdvance={patchTask} value={newTask} setValue={setNewTask} onAdd={() => addTask("build")} />
        </>
      )}

      {tab === "launch" && (
        <>
          <StepIntro title="Launch — take it to market"
            body="The GTM work that ships alongside the build: messaging, content, enablement." />
          <TaskList area="gtm" title="GTM tasks" tasks={tasks.filter((t) => t.area === "gtm")} ownerName={ownerName}
            onAdvance={patchTask} value={newTask} setValue={setNewTask} onAdd={() => addTask("gtm")} />
        </>
      )}

      {tab === "live" && (
        <>
          <StepIntro title="Live — measure the outcome"
            body="The proof this worked. Pulled from the Proof section of your scope." />
          <div className="card" style={{ overflow: "hidden" }}>
            {[["success_metric", "Success metric"], ["validation", "Validation plan"]].map(([k, label], i) => (
              <div key={k} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div className="t-h2" style={{ fontSize: 13, fontWeight: 620, marginBottom: 4 }}>{label}</div>
                {fv.get(k) ? <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{fv.get(k)}</div>
                  : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Not defined yet — add it in the Plan step (Proof).</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "advisors" && (
        <>
          <StepIntro title="Advisors — the officers' read on this Build Item"
            body="Each officer runs their own analysis — same evidence, different lens. Review, edit, ratify." />
          <PlaysPanel targetType="initiative" targetId={ini.id} targetName={ini.title} plays={INITIATIVE_PLAYS} heading="Officer analyses" columns={1} />
        </>
      )}
    </div>
  );
}

function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: "var(--sp-4)" }}>
      <div className="t-h2" style={{ fontSize: 15, fontWeight: 660, marginBottom: 2 }}>{title}</div>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>{body}</div>
    </div>
  );
}

function TaskList({ area, title, tasks, ownerName, onAdvance, value, setValue, onAdd }: {
  area: "build" | "gtm"; title: string; tasks: Task[]; ownerName: (id: string | null) => string | null;
  onAdvance: (t: Task, stage: string) => void; value: string; setValue: (v: string) => void; onAdd: () => void;
}) {
  const tone = area === "build" ? "accent" : "violet";
  return (
    <section className="section" style={{ marginTop: "var(--sp-5)" }}>
      <div className="section-head"><span className="row gap-2"><span className="t-h2" style={{ fontSize: 14.5 }}>{title}</span><span className="chip">{tasks.length}</span></span></div>
      <div className="card" style={{ overflow: "hidden" }}>
        {tasks.length === 0 && <div style={{ padding: "14px 18px" }} className="t-sub t-muted">No tasks yet. Break the work into steps below.</div>}
        {tasks.map((t, i) => (
          <div key={t.id} className="row-between" style={{ padding: "10px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", alignItems: "center", gap: 8 }}>
            <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
              <span style={{ width: 16, height: 16, borderRadius: 999, flexShrink: 0, background: t.stage === "done" ? "var(--gn)" : t.stage === "active" ? "var(--ac)" : "var(--fill-2)", border: t.stage === "backlog" ? "1.5px solid var(--border-strong)" : "none" }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: t.stage === "done" ? "line-through" : "none", color: t.stage === "done" ? "var(--tm)" : "var(--tp)" }}>{t.title}</span>
              {ownerName(t.assignee_id) && <span className="t-mono-xs t-muted">· {ownerName(t.assignee_id)}</span>}
            </div>
            <div className="row gap-2" style={{ flexShrink: 0 }}>
              <Chip tone={(t.stage === "done" ? "green" : t.stage === "active" ? "amber" : "default") as "green" | "amber" | "default"}>{t.stage === "backlog" ? "To do" : t.stage === "active" ? "In progress" : "Done"}</Chip>
              {TASK_NEXT[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => onAdvance(t, TASK_NEXT[t.stage])}>{t.stage === "backlog" ? "Start" : "Done"} →</button>}
              {t.stage === "done" && <button className="btn btn-secondary btn-sm" onClick={() => onAdvance(t, "active")}>Reopen</button>}
            </div>
          </div>
        ))}
        <div className="row gap-2" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
          <input className="input" placeholder={area === "build" ? "Add a build task…" : "Add a GTM task…"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} style={{ flex: 1, borderColor: `var(--${tone === "accent" ? "ac" : "vl"})` }} />
          <button className="btn btn-sm" onClick={onAdd}>Add</button>
        </div>
      </div>
    </section>
  );
}
