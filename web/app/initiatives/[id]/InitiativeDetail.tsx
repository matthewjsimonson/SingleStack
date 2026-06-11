"use client";

// Build Item cockpit. A top segment picks the side present on the item:
//   Build         → the build (product) workflow: Scoped → Ready for agent →
//                   In build → Shipped, each step's own work, carrying forward.
//   Go-to-market  → the GTM workflow (GtmWorkflow): Brief → In production →
//                   Launched. Only when the item has GTM scope.
//   Advisors      → the officers' analyses.
// Status is DERIVED (deriveBuildStage / deriveGtmStage) — the SAME values that
// place the card on the Ship and Enablement boards, so nothing can disagree.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, BackLink, Spinner, SubTabs, Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import BuildScope from "@/components/BuildScope";
import TechnicalScope from "@/components/TechnicalScope";
import GtmWorkflow from "@/components/GtmWorkflow";
import { BUILD_TEMPLATE } from "@/lib/templates";
import { BUILD_STAGES, STAGE_LABEL, GTM_STAGE_LABEL, buildReadiness, deriveBuildStage, deriveGtmStage, type BuildStage } from "@/lib/buildStage";
import { buildAgentBrief, BUILD_KIND_LABEL } from "@/lib/agentBrief";

type Initiative = { id: string; title: string; description: string | null; scope: string; kind: string | null; assignee_id: string | null; build_state: string | null; is_unevidenced: boolean; release_id: string | null; gtm_record_id: string | null };
type Task = { id: string; area: string; title: string; stage: string; assignee_id: string | null };
type Person = { id: string; name: string };
type Field = { field_key: string; value: string | null };
type Link = { kind: string; ref_table: string | null; path: string | null; label: string | null; note: string | null };
type Release = { id: string; name: string; version: string | null };

const SCOPE_KEYS = BUILD_TEMPLATE.flatMap((s) => s.fields.map((f) => f.key));
const TASK_NEXT: Record<string, string> = { backlog: "active", active: "done" };
const STAGE_TONE: Record<BuildStage, "amber" | "accent" | "green"> = { scoped: "amber", ready_for_agent: "accent", in_build: "accent", shipped: "green" };

export default function InitiativeDetail({ id }: { id: string }) {
  const supabase = createClient();
  const params = useSearchParams();
  const from = params.get("from");
  const back = from === "ship" ? { href: "/ship", label: "Ship" } : from === "enablement" ? { href: "/enablement", label: "Go-to-market" } : { href: "/?tab=initiatives", label: "Initiatives" };

  const [ini, setIni] = useState<Initiative | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<string>("build");
  const [tab, setTab] = useState<string>("scoped");
  const pinned = useRef(false);
  const [newTask, setNewTask] = useState("");
  const [brief, setBrief] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [{ data: i }, { data: w }, { data: p }, { data: fl }, { data: lk }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, scope, kind, assignee_id, build_state, is_unevidenced, release_id, gtm_record_id").eq("id", id).maybeSingle(),
      supabase.from("initiative_workstreams").select("id, area, title, stage, assignee_id").eq("initiative_id", id),
      supabase.from("people").select("id, name").eq("is_active", true).order("name"),
      supabase.from("initiative_fields").select("field_key, value").eq("initiative_id", id),
      supabase.from("build_context_links").select("kind, ref_table, path, label, note").eq("initiative_id", id),
    ]);
    setIni(i as Initiative | null); setTasks((w ?? []) as Task[]); setPeople(p ?? []); setFields((fl ?? []) as Field[]); setLinks((lk ?? []) as Link[]);
    const relId = (i as Initiative | null)?.release_id;
    if (relId) { const { data: r } = await supabase.from("releases").select("id, name, version").eq("id", relId).maybeSingle(); setRelease(r as Release | null); } else setRelease(null);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Opening Build Item…" />;
  if (!ini) return <Banner>Build Item not found.</Banner>;

  const ownerName = (pid: string | null) => people.find((p) => p.id === pid)?.name ?? null;
  const fv = new Map(fields.map((f) => [f.field_key, (f.value ?? "").trim()]));
  const buildTasks = tasks.filter((t) => t.area === "build");
  const gtmTasks = tasks.filter((t) => t.area === "gtm");
  const { ready } = buildReadiness(fv, links);
  const stage = deriveBuildStage({ buildState: ini.build_state, ready, buildTasks });
  const gtmStage = deriveGtmStage(gtmTasks);
  const scopePct = Math.round((SCOPE_KEYS.filter((k) => fv.get(k)).length / SCOPE_KEYS.length) * 100);
  const relLabel = release ? (release.version ? `${release.version} · ${release.name}` : release.name) : null;
  const hasBuild = ini.scope === "product" || ini.scope === "both";
  const hasGtm = ini.scope === "gtm" || ini.scope === "both";

  // Pick the side + build tab once, from where you arrived.
  if (!pinned.current) {
    pinned.current = true;
    setSide(from === "enablement" && hasGtm ? "gtm" : hasBuild ? "build" : "gtm");
    setTab(stage);
  }

  const segments = [
    ...(hasBuild ? [{ key: "build", label: "Build" }] : []),
    ...(hasGtm ? [{ key: "gtm", label: "Go-to-market" }] : []),
  ];
  const stageRank = (k: string) => BUILD_STAGES.findIndex((s) => s.key === k);
  const curRank = stageRank(stage);

  async function patchTask(t: Task, st: string) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update({ stage: st }).eq("id", t.id);
    if (error) { setError(error.message); return; }
    await load();
  }
  async function addTask() {
    if (!newTask.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: id, area: "build", lifecycle_stage: "build", title: newTask.trim(), stage: "backlog" });
    if (error) { setError(error.message); return; }
    setNewTask(""); await load();
  }
  async function markShipped() {
    setError(null);
    const { error } = await supabase.from("initiatives").update({ build_state: "shipped" }).eq("id", id);
    if (error) { setError(error.message); return; }
    await load();
  }

  const briefText = buildAgentBrief({ title: ini.title, kind: ini.kind, releaseLabel: relLabel, fields: fv, links });

  return (
    <div>
      <BackLink href={back.href} label={back.label} />
      <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
        {ini.kind && <Chip>{BUILD_KIND_LABEL[ini.kind] ?? ini.kind}</Chip>}
        {hasBuild && <Chip tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Chip>}
        {hasGtm && <Chip tone="violet">GTM · {GTM_STAGE_LABEL[gtmStage]}</Chip>}
        {ownerName(ini.assignee_id) ? <Chip tone="green">{ownerName(ini.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
        {relLabel && <Chip>{relLabel}</Chip>}
        {ini.is_unevidenced && <span title="Scope entered manually with no linked Signal evidence."><Chip tone="amber">⚠ no evidence</Chip></span>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 4 }}>{ini.title}</h1>
      {ini.description && <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-4)", maxWidth: 720 }}>{ini.description}</div>}

      {/* Side: which workflow you're working — Build, GTM, or the officers. */}
      {segments.length > 1 && (
        <div className="row gap-2" style={{ marginBottom: "var(--sp-4)" }}>
          {segments.map((s) => (
            <button key={s.key} className={`btn btn-sm ${side === s.key ? "" : "btn-secondary"}`} onClick={() => setSide(s.key)}>{s.label}</button>
          ))}
        </div>
      )}
      <Banner>{error}</Banner>

      {side === "build" && hasBuild && (
        <>
          {/* build stage rail — where this Build Item actually is */}
          <div className="row" style={{ gap: 0, flexWrap: "wrap", marginBottom: "var(--sp-5)" }}>
            {BUILD_STAGES.map((s, idx) => {
              const state = idx < curRank ? "done" : idx === curRank ? "cur" : "todo";
              return (
                <div key={s.key} className="row" style={{ alignItems: "center", gap: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: state === "cur" ? "var(--ac)" : state === "done" ? "var(--gn)" : "var(--fill-2)", color: state === "todo" ? "var(--tm)" : "#fff" }}>{state === "done" ? "✓" : idx + 1}</span>
                    <span className="t-mono-xs" style={{ marginTop: 4, fontWeight: state === "cur" ? 700 : 400, color: state === "cur" ? "var(--tp)" : "var(--tm)" }}>{s.label}</span>
                  </div>
                  {idx < BUILD_STAGES.length - 1 && <span style={{ width: 22, height: 2, background: idx < curRank ? "var(--gn)" : "var(--border)" }} />}
                </div>
              );
            })}
          </div>

          <SubTabs tabs={BUILD_STAGES.map((s) => ({ key: s.key, label: s.label }))} active={tab} onChange={setTab} />

          {tab === "scoped" && (<>
            <StepIntro title="Scope — define what we're building" body="Capture the Why / What / How / Proof. This is the spec everything downstream carries forward." />
            <BuildScope initiativeId={ini.id} />
          </>)}
          {tab === "ready_for_agent" && (<>
            <StepIntro title="Ready for agent — make it buildable" body={`Assemble the Technical Scope: the context bundle and prompt a coding agent needs. Scope is ${scopePct}% captured — it carries in from the previous step.`} />
            <TechnicalScope initiativeId={ini.id} />
          </>)}
          {tab === "in_build" && (<>
            <StepIntro title="In build — execute" body="Break the work into tasks and hand the agent its brief. The scope and context bundle carry forward into the brief." />
            <div className="row gap-2" style={{ marginBottom: "var(--sp-4)" }}>
              <button className="btn" disabled={!ready} title={ready ? "Assemble the coding-agent handoff" : "Finish the Technical Scope first"} onClick={() => { setBrief(true); setCopied(false); }}>Agent brief</button>
              {stage === "in_build" && <button className="btn btn-secondary" onClick={markShipped}>Mark shipped →</button>}
            </div>
            <TaskList tasks={buildTasks} ownerName={ownerName} onAdvance={patchTask} value={newTask} setValue={setNewTask} onAdd={addTask} />
          </>)}
          {tab === "shipped" && (<>
            <StepIntro title="Shipped — the outcome" body="The release this shipped in, and the proof it worked." />
            <div className="card" style={{ overflow: "hidden" }}>
              <DRow label="Release" value={relLabel ?? null} empty="Not tagged to a release yet." />
              <DRow label="Success metric" value={fv.get("success_metric") ?? null} empty="Define it in Scope → Proof." />
              <DRow label="Validation plan" value={fv.get("validation") ?? null} empty="Define it in Scope → Proof." />
            </div>
            {stage !== "shipped" && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Not shipped yet — finish the build in the “In build” step.</div>}
          </>)}
        </>
      )}

      {side === "gtm" && hasGtm && <GtmWorkflow initiativeId={ini.id} gtmRecordId={ini.gtm_record_id} />}

      <Modal open={brief} onClose={() => setBrief(false)} title={`Agent brief — ${ini.title}`} width={680}>
        <div className="row-between" style={{ marginBottom: 12, alignItems: "center" }}>
          <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>The executable handoff: scope, acceptance criteria, and the context bundle.</span>
          <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(briefText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.55, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, maxHeight: "55vh", overflowY: "auto", fontFamily: "var(--mono, monospace)" }}>{briefText}</pre>
      </Modal>
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

function DRow({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)" }}>
      <div className="t-h2" style={{ fontSize: 13, fontWeight: 620, marginBottom: 4 }}>{label}</div>
      {value ? <Markdown className="t-body" style={{ lineHeight: 1.6 }} text={value} /> : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{empty}</div>}
    </div>
  );
}

function TaskList({ tasks, ownerName, onAdvance, value, setValue, onAdd }: {
  tasks: Task[]; ownerName: (id: string | null) => string | null;
  onAdvance: (t: Task, stage: string) => void; value: string; setValue: (v: string) => void; onAdd: () => void;
}) {
  return (
    <section className="section">
      <div className="section-head"><span className="row gap-2"><span className="t-h2" style={{ fontSize: 14.5 }}>Build tasks</span><span className="chip">{tasks.length}</span></span></div>
      <div className="card" style={{ overflow: "hidden" }}>
        {tasks.length === 0 && <div style={{ padding: "14px 18px" }} className="t-sub t-muted">No tasks yet. Break the build into steps below.</div>}
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
          <input className="input" placeholder="Add a build task…" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onAdd}>Add</button>
        </div>
      </div>
    </section>
  );
}
