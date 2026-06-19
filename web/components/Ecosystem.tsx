"use client";

// The Ecosystem (Phase G) — a VISUAL map of the product-led-growth motion, with a
// right-rail that names the ACTUAL coverage of a clicked area. Two record cores
// (Build/Product the engine, GTM the flywheel) with their areas as nodes orbiting
// each core, colored by coverage (green covered, amber partial, red GAP). Click a
// node → the rail shows the area's tasks and, per layer, the real entities covering
// it (agent · cornerstone · child skills · workflows) and what's missing. The map is
// the canvas; the rail is the detail — no scrolling the page to read coverage.
// Honest by design: workflows are matched loosely today (not yet area-aligned), so
// they're shown by name with that caveat rather than hidden behind a green dot.
// SVG colours go through `style` (CSS var() does not resolve in SVG attrs).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PRODUCT_AREAS, GTM_AREAS, CHECK_LABEL, computeCoverage, classifyCoverage,
  type Area, type AreaStatus, type Harmony,
} from "@/lib/ecosystem";
import { playbooksFor, type StandardPlaybook } from "@/lib/playbooks";
import { Modal } from "@/components/ui";
import { getOrgId } from "@/lib/org";
import SkillCreateChat from "@/components/SkillCreateChat";
import WorkflowCreateChat from "@/components/WorkflowCreateChat";

type Lens = "all" | "product" | "gtm";
type Agent = { id: string; name: string };
type Skill = { id: string; name: string | null; kind: string | null; areas: string[] | null };
type Conn = { agent_id: string | null; area: string | null };
type AgSkill = { agent_id: string; skill_id: string };
type Workflow = { id: string; name: string; agent_id: string | null; target_type: string | null; is_active: boolean | null; area_id: string | null; standard_key: string | null };
type Raw = { agents: Agent[]; connections: Conn[]; agentSkills: AgSkill[]; skills: Skill[]; workflows: Workflow[]; areas: { id: string; key: string }[] };

const harmonyTone = (h: Harmony) =>
  h === "healthy" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Healthy" }
  : h === "watch" ? { fill: "color-mix(in srgb, var(--am-text) 16%, transparent)", text: "var(--am-text)", label: "Watch" }
  : { fill: "color-mix(in srgb, var(--rd-text) 14%, transparent)", text: "var(--rd-text)", label: "At risk" };
const nodeTone = (s: AreaStatus) =>
  s === "covered" ? { fill: "var(--gn-fill)", stroke: "var(--gn-text)", sw: 1.5 }
  : s === "partial" ? { fill: "color-mix(in srgb, var(--am-text) 20%, transparent)", stroke: "var(--am-text)", sw: 1.5 }
  : { fill: "color-mix(in srgb, var(--rd-text) 16%, transparent)", stroke: "var(--rd-text)", sw: 2.75 };
const chipTone = (s: AreaStatus) =>
  s === "covered" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Covered" }
  : s === "partial" ? { fill: "color-mix(in srgb, var(--am-text) 15%, transparent)", text: "var(--am-text)", label: "Partial" }
  : { fill: "color-mix(in srgb, var(--rd-text) 13%, transparent)", text: "var(--rd-text)", label: "Gap" };
const shortLabel = (l: string) => { const s = l.split(/ [&/]/)[0].trim(); return s.length > 15 ? s.slice(0, 14) + "…" : s; };

// --- layout -----------------------------------------------------------------
const VB = { w: 960, h: 600 };
type Cluster = { key: "product" | "gtm"; cx: number; cy: number; r: number; a0: number; a1: number; full: boolean; areas: Area[]; coreLabel: string; coreRole: string; engine?: boolean };
function clustersFor(lens: Lens): Cluster[] {
  if (lens === "product") return [{ key: "product", cx: 480, cy: 300, r: 205, a0: 0, a1: 360, full: true, areas: PRODUCT_AREAS, coreLabel: "Product", coreRole: "the build engine", engine: true }];
  if (lens === "gtm") return [{ key: "gtm", cx: 480, cy: 300, r: 225, a0: 0, a1: 360, full: true, areas: GTM_AREAS, coreLabel: "GTM", coreRole: "the flywheel" }];
  return [
    { key: "product", cx: 300, cy: 300, r: 185, a0: 90, a1: 270, full: false, areas: PRODUCT_AREAS, coreLabel: "Product", coreRole: "the build engine", engine: true },
    { key: "gtm", cx: 660, cy: 300, r: 200, a0: -90, a1: 90, full: false, areas: GTM_AREAS, coreLabel: "GTM", coreRole: "the flywheel" },
  ];
}
function nodePositions(c: Cluster) {
  const n = c.areas.length;
  return c.areas.map((area, i) => {
    const deg = c.full ? (c.a0 + (i * 360) / n) : (n === 1 ? (c.a0 + c.a1) / 2 : c.a0 + (i * (c.a1 - c.a0)) / (n - 1));
    const rad = (deg * Math.PI) / 180;
    return { area, x: c.cx + c.r * Math.cos(rad), y: c.cy - c.r * Math.sin(rad) };
  });
}

export default function Ecosystem() {
  const supabase = createClient();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [counts, setCounts] = useState({ products: 0, gtm: 0, agents: 0 });
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Lens>("all");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [showTodo, setShowTodo] = useState(false);
  const [creating, setCreating] = useState<null | "skill" | "workflow" | "agent">(null);
  const [creatingStandard, setCreatingStandard] = useState<StandardPlaybook | null>(null);

  const load = useCallback(async () => {
    const [{ data: ag }, { data: conns }, { data: agSk }, { data: sk }, { data: wf }, { data: ar }, { count: pc }, { count: gc }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
      supabase.from("agent_skills").select("agent_id, skill_id"),
      supabase.from("skills").select("id, name, kind, areas"),
      supabase.from("workflows").select("id, name, agent_id, target_type, is_active, area_id, standard_key"),
      supabase.from("areas").select("id, key"),
      supabase.from("product_records").select("id", { count: "exact", head: true }),
      supabase.from("gtm_records").select("id", { count: "exact", head: true }),
    ]);
    const agents = (ag ?? []) as Agent[];
    setRaw({ agents, connections: (conns ?? []) as Conn[], agentSkills: (agSk ?? []) as AgSkill[], skills: (sk ?? []) as Skill[], workflows: (wf ?? []) as Workflow[], areas: (ar ?? []) as { id: string; key: string }[] });
    setCounts({ products: pc ?? 0, gtm: gc ?? 0, agents: agents.length });
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const coverage = useMemo(() => raw ? computeCoverage({ agents: raw.agents, connections: raw.connections, agentSkills: raw.agentSkills, skills: raw.skills, workflows: raw.workflows }) : null, [raw]);
  const health = useMemo(() => coverage ? classifyCoverage(coverage) : null, [coverage]);
  const covByKey = useMemo(() => new Map((coverage?.areas ?? []).map((a) => [a.area.key, a] as const)), [coverage]);
  const areaIdByKey = useMemo(() => new Map((raw?.areas ?? []).map((a) => [a.key, a.id] as const)), [raw]);
  const clusters = useMemo(() => clustersFor(lens), [lens]);
  const laidOut = useMemo(() => clusters.map((c) => ({ c, nodes: nodePositions(c) })), [clusters]);

  // Lookups for the named coverage detail.
  const lk = useMemo(() => {
    const agentName = new Map((raw?.agents ?? []).map((a) => [a.id, a.name] as const));
    const skillById = new Map((raw?.skills ?? []).map((s) => [s.id, s] as const));
    const skillsByAgent = new Map<string, string[]>();
    for (const as of raw?.agentSkills ?? []) { const arr = skillsByAgent.get(as.agent_id) ?? []; arr.push(as.skill_id); skillsByAgent.set(as.agent_id, arr); }
    const connAreasByAgent = new Map<string, Set<string>>();
    for (const c of raw?.connections ?? []) { if (c.agent_id && c.area) { const s = connAreasByAgent.get(c.agent_id) ?? new Set(); s.add(c.area); connAreasByAgent.set(c.agent_id, s); } }
    return { agentName, skillById, skillsByAgent, connAreasByAgent };
  }, [raw]);

  const detailFor = useCallback((area: Area) => {
    const want = new Set(area.connAreas);
    const agentIds = (raw?.agents ?? []).filter((a) => { const s = lk.connAreasByAgent.get(a.id); return !!s && [...s].some((x) => want.has(x)); }).map((a) => a.id);
    const agentSet = new Set(agentIds);
    const skillsOf = agentIds.flatMap((id) => (lk.skillsByAgent.get(id) ?? [])).map((sid) => lk.skillById.get(sid)).filter((s): s is Skill => !!s);
    const uniq = (xs: string[]) => [...new Set(xs)];
    const cornerstones = uniq(skillsOf.filter((s) => s.kind === "cornerstone").map((s) => s.name ?? "Cornerstone"));
    const childSkills = uniq(skillsOf.filter((s) => s.kind !== "cornerstone" && (s.areas ?? []).some((x) => want.has(x))).map((s) => s.name ?? "Skill"));
    const workflows = uniq((raw?.workflows ?? []).filter((w) => w.is_active !== false && w.agent_id && agentSet.has(w.agent_id) && (w.target_type == null || w.target_type === "none" || w.target_type === area.circle)).map((w) => w.name));
    return { agents: agentIds.map((id) => lk.agentName.get(id) ?? "Agent"), cornerstones, childSkills, workflows };
  }, [raw, lk]);

  if (loading || !coverage || !health) return <div className="t-sub t-muted">Loading the ecosystem…</div>;

  const noRecords = counts.products === 0 && counts.gtm === 0;
  const noAgents = counts.agents === 0;
  const ht = harmonyTone(health.harmony.status);
  const sel = selKey ? covByKey.get(selKey) ?? null : null;
  const drawerOpen = selKey !== null || showTodo;
  const lensKeys = new Set(laidOut.flatMap((l) => l.nodes.map((n) => n.area.key)));
  const todo = [...health.rankedGaps, ...health.rankedPartials].filter((c) => lensKeys.has(c.area.key));
  const cyclePath = (above: boolean) => { const y = 300, dy = above ? -54 : 54; return `M 332 ${y} C 430 ${y + dy}, 530 ${y + dy}, 628 ${y}`; };

  // ---- the right rail: a named coverage layer ----
  const connectAgent = async (agentId: string) => {
    if (!sel) return;
    const orgId = await getOrgId();
    if (!orgId) return;
    await supabase.from("connections").insert({ org_id: orgId, agent_id: agentId, kind: "internal", label: sel.area.label, area: sel.area.connAreas[0], status: "connected" });
    await load(); setCreating(null);
  };

  const renderRail = () => {
    if (sel) {
      const d = detailFor(sel.area); const t = chipTone(sel.status);
      return (
        <div>
          <div className="row gap-2" style={{ alignItems: "center", marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => { setSelKey(null); setShowTodo(true); }} style={{ fontSize: 11 }}>← All gaps</button>
            <span className="chip" style={{ fontSize: 9.5, fontWeight: 700, background: t.fill, color: t.text, marginLeft: "auto" }}>{t.label}</span>
          </div>
          <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
            <span style={{ fontWeight: 720, fontSize: 15 }}>{sel.area.label}</span>
            {sel.area.engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
          </div>
          <div className="t-mono-xs t-muted" style={{ fontSize: 10, marginBottom: 6 }}>{sel.area.circle === "product" ? "Build / Product" : "Go-to-market"}{sel.area.record ? ` · maintains ${sel.area.record}` : ""}{sel.area.flywheel ? ` · ${sel.area.flywheel}` : ""}</div>
          <div className="t-sub t-muted" style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 10 }}>{sel.area.blurb}</div>

          {/* Agent on the area */}
          <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--line-2, var(--border))" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: d.agents.length ? "var(--gn-text)" : "transparent", border: d.agents.length ? "none" : "1.5px solid var(--rd-text)" }} />
            <span style={{ fontSize: 12, fontWeight: 660 }}>Agent</span>
            <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>{d.agents.length ? d.agents.join(", ") : "none on this area yet"}</span>
            {!d.agents.length && <button onClick={() => setCreating("agent")} className="btn btn-sm btn-secondary" style={{ fontSize: 10.5, marginLeft: "auto" }}>+ Put an agent</button>}
          </div>

          {/* Standard playbook — the prescriptive checklist (a suggestion; tailorable) */}
          <div className="t-mono-xs t-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, margin: "8px 0 4px" }}>Standard playbook</div>
          <div className="stack-2">
            {playbooksFor(sel.area.key).map((pb) => {
              const areaDbId = areaIdByKey.get(sel.area.key);
              const wf = (raw?.workflows ?? []).find((w) => w.is_active !== false && !!areaDbId && w.area_id === areaDbId && w.standard_key === pb.key);
              const present = !!wf;
              const haveSkill = (name: string) => d.childSkills.some((s) => s.toLowerCase().includes(name.toLowerCase().split(" ")[0]));
              return (
                <div key={pb.key} className="card card-pad" style={{ borderLeft: `3px solid ${present ? "var(--gn-text)" : "var(--rd-text)"}` }}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 660 }}>{pb.name}</div>
                      <div className="t-sub t-muted" style={{ fontSize: 11, lineHeight: 1.35, marginTop: 1 }}>{pb.purpose}</div>
                    </div>
                    {present
                      ? <span className="chip" style={{ flexShrink: 0, fontSize: 9, background: "var(--gn-fill)", color: "var(--gn-text)", fontWeight: 700 }}>✓ set up</span>
                      : <button onClick={() => { setCreatingStandard(pb); setCreating("workflow"); }} className="btn btn-sm" style={{ flexShrink: 0, fontSize: 10.5 }}>Set up</button>}
                  </div>
                  {present && wf && <div className="t-mono-xs t-muted" style={{ fontSize: 10, marginTop: 4 }}>↳ {wf.name}</div>}
                  <div className="row gap-1" style={{ flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {pb.skills.map((sk) => (
                      <span key={sk} className="chip" style={{ fontSize: 10, background: "var(--well, var(--surface-2))", color: haveSkill(sk) ? "var(--tp)" : "var(--tm)" }}>{haveSkill(sk) ? "" : "○ "}{sk}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom workflows mapped to this area */}
          {(() => {
            const areaDbId = areaIdByKey.get(sel.area.key);
            const customWfs = (raw?.workflows ?? []).filter((w) => w.is_active !== false && !!areaDbId && w.area_id === areaDbId && !w.standard_key);
            return customWfs.length > 0 ? (
              <>
                <div className="t-mono-xs t-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0 4px" }}>Custom (mapped here)</div>
                <div className="stack-2">{customWfs.map((w) => <div key={w.id} className="card card-pad" style={{ fontSize: 12 }}>{w.name}</div>)}</div>
              </>
            ) : null;
          })()}

          <div className="row gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => { setCreatingStandard(null); setCreating("workflow"); }} className="btn btn-sm btn-secondary" style={{ fontSize: 10.5 }}>+ Map a custom workflow</button>
            <button onClick={() => setCreating("skill")} className="btn btn-sm btn-secondary" style={{ fontSize: 10.5 }}>+ Add a skill</button>
          </div>
        </div>
      );
    }
    // default: the unattended list
    return (
      <div>
        <div className="row-between" style={{ alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>What&apos;s unattended</span>
          <span className="t-mono-xs t-muted" style={{ fontSize: 10.5 }}>{health.counts.gap} gap · {health.counts.partial} partial</span>
        </div>
        {todo.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12 }}>Nothing unattended in this view. Click any node to inspect its coverage.</div>
        ) : (
          <div className="stack-2">
            {todo.map((cov) => {
              const t = chipTone(cov.status);
              return (
                <button key={cov.area.key} onClick={() => setSelKey(cov.area.key)} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", borderLeft: `3px solid ${t.text}`, width: "100%" }}>
                  <div className="row gap-2" style={{ alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
                    <span className="chip" style={{ fontSize: 9, background: t.fill, color: t.text, fontWeight: 700 }}>{t.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 640 }}>{cov.area.label}</span>
                    {cov.area.engine && <span className="chip" style={{ fontSize: 8.5, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
                  </div>
                  <div className="t-sub t-muted" style={{ fontSize: 11, lineHeight: 1.35 }}>Missing: {cov.missing.map((m) => CHECK_LABEL[m].toLowerCase()).join(" · ")}.</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3, 12px)" }}>
      {/* Status is always answerable. */}
      <div className="card card-pad" style={{ background: ht.fill, borderColor: ht.text }}>
        <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: ht.text, flexShrink: 0 }} />
            <span style={{ fontWeight: 720, color: ht.text }}>{ht.label}</span>
            <span style={{ fontSize: 13, color: "var(--tp)", minWidth: 0 }}>{health.harmony.headline}</span>
          </div>
          <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
            {(["all", "product", "gtm"] as Lens[]).map((l) => (
              <button key={l} onClick={() => { setLens(l); setSelKey(null); }} className="btn btn-sm"
                style={{ background: lens === l ? "var(--ac-fill)" : "transparent", color: lens === l ? "var(--ac-text)" : "var(--tp)", borderColor: lens === l ? "var(--ac-text)" : "var(--border)", fontWeight: lens === l ? 700 : 540, fontSize: 11 }}>
                {l === "all" ? "Full motion" : l === "product" ? "Product" : "GTM"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(noRecords || noAgents) && (
        <div className="card card-pad" style={{ borderColor: "var(--ac-text)" }}>
          <span className="t-sub" style={{ fontSize: 12.5 }}>Stand up the ecosystem: {noRecords && <a href="/products">set your Product &amp; GTM records</a>}{noRecords && noAgents ? ", then " : ""}{noAgents && <a href="/agents?tab=agents">staff the areas with agents</a>}. Coverage fills in as agents, skills, and aligned workflows go in.</span>
        </div>
      )}

      {/* Toolbar: legend + the unattended trigger (pops the drawer). */}
      <div className="row-between" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", fontSize: 10.5 }}>
          {([["Covered", "var(--gn-text)"], ["Partial", "var(--am-text)"], ["Gap", "var(--rd-text)"]] as const).map(([lab, col]) => (
            <span key={lab} className="row gap-1" style={{ alignItems: "center", gap: 4, color: "var(--tm)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: col, flexShrink: 0 }} />{lab}
            </span>
          ))}
        </div>
        <button onClick={() => { setSelKey(null); setShowTodo(true); }} className="btn btn-sm"
          style={{ fontSize: 11, fontWeight: 600, borderColor: health.counts.gap ? "var(--rd-text)" : "var(--border)", color: health.counts.gap ? "var(--rd-text)" : "var(--tp)" }}>
          {health.counts.gap + health.counts.partial} unattended →
        </button>
      </div>

      {/* The map (canvas). Click a node to pop out its coverage. */}
      <div className="card" style={{ padding: 8, overflow: "hidden" }}>
          <svg viewBox={`0 0 ${VB.w} ${VB.h}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Ecosystem coverage map">
            <defs>
              <marker id="eco-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" style={{ fill: "var(--ac-text)" }} /></marker>
            </defs>
            {lens === "all" && (
              <g>
                <path d={cyclePath(true)} markerEnd="url(#eco-arrow)" style={{ fill: "none", stroke: "var(--ac-text)", strokeWidth: 1.5, opacity: 0.55 }} />
                <path d={cyclePath(false)} markerStart="url(#eco-arrow)" style={{ fill: "none", stroke: "var(--tm)", strokeWidth: 1.5, opacity: 0.45 }} />
                <text x={480} y={232} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: "var(--ac-text)" }}>builds fuel growth</text>
                <text x={480} y={378} textAnchor="middle" fontSize={10.5} style={{ fill: "var(--tm)" }}>usage &amp; PQL signals</text>
              </g>
            )}
            {laidOut.map(({ c, nodes }) => (
              <g key={c.key}>
                {nodes.map((n) => { const cov = covByKey.get(n.area.key); const isGap = (cov?.status ?? "gap") === "gap"; const t = nodeTone(cov?.status ?? "gap"); return <line key={`l-${n.area.key}`} x1={c.cx} y1={c.cy} x2={n.x} y2={n.y} strokeWidth={isGap ? 1.4 : 1} style={{ stroke: t.stroke, opacity: isGap ? 0.5 : 0.28 }} />; })}
                <circle cx={c.cx} cy={c.cy} r={42} strokeWidth={c.engine ? 2 : 1.5} onClick={() => { setLens(c.key); setSelKey(null); }} style={{ cursor: "pointer", fill: c.engine ? "var(--ac-fill)" : "var(--well, #f3f3f5)", stroke: c.engine ? "var(--ac-text)" : "var(--border)" }} />
                <text x={c.cx} y={c.cy - 2} textAnchor="middle" fontSize={14} fontWeight={760} style={{ pointerEvents: "none", fill: c.engine ? "var(--ac-text)" : "var(--tp)" }}>{c.coreLabel}</text>
                <text x={c.cx} y={c.cy + 13} textAnchor="middle" fontSize={9} style={{ pointerEvents: "none", fill: "var(--tm)" }}>{c.coreRole}</text>
                {nodes.map((n) => {
                  const cov = covByKey.get(n.area.key); const status = cov?.status ?? "gap"; const t = nodeTone(status);
                  const isSel = selKey === n.area.key; const isGap = status === "gap"; const R = n.area.engine ? 30 : 25;
                  return (
                    <g key={n.area.key} onClick={() => setSelKey(isSel ? null : n.area.key)} style={{ cursor: "pointer" }}>
                      {isSel && <circle cx={n.x} cy={n.y} r={R + 5} strokeWidth={1.5} style={{ fill: "none", stroke: "var(--ac-text)" }} />}
                      <circle cx={n.x} cy={n.y} r={R} strokeWidth={t.sw} style={{ fill: t.fill, stroke: t.stroke }} />
                      {isGap && <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={17} fontWeight={800} style={{ pointerEvents: "none", fill: "var(--rd-text)" }}>!</text>}
                      {n.area.engine && !isGap && <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={9} fontWeight={700} style={{ pointerEvents: "none", fill: "var(--ac-text)" }}>engine</text>}
                      <text x={n.x} y={n.y + R + 13} textAnchor="middle" fontSize={10} fontWeight={isGap ? 700 : 540} style={{ pointerEvents: "none", fill: "var(--tp)" }}>{shortLabel(n.area.label)}</text>
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        </div>

      {/* The pop-out drawer — hidden while a create flow is open (those overlay above). */}
      {!creating && (
        <>
          <div onClick={() => { setSelKey(null); setShowTodo(false); }} aria-hidden={!drawerOpen}
            style={{ position: "fixed", inset: 0, background: "rgba(11,11,12,0.32)", opacity: drawerOpen ? 1 : 0, pointerEvents: drawerOpen ? "auto" : "none", transition: "opacity var(--dur-base, 200ms) ease", zIndex: 60 }} />
          <aside aria-hidden={!drawerOpen}
            style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: "min(384px, 92vw)", background: "var(--surface-0, #fff)", borderLeft: "1px solid var(--border)", boxShadow: "-10px 0 28px rgba(11,11,12,0.12)", transform: drawerOpen ? "translateX(0)" : "translateX(100%)", transition: "transform var(--dur-slow, 280ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1))", zIndex: 61, overflowY: "auto", padding: 16 }}>
            {drawerOpen && (
              <>
                <div className="row-between" style={{ alignItems: "center", marginBottom: 10 }}>
                  <span className="t-mono-xs t-muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Coverage</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => { setSelKey(null); setShowTodo(false); }} aria-label="Close" style={{ fontSize: 11 }}>✕ Close</button>
                </div>
                {renderRail()}
              </>
            )}
          </aside>
        </>
      )}

      {/* In-context creation — complete it here, refresh, move on. */}
      {creating === "skill" && <SkillCreateChat onCreated={() => { load(); setCreating(null); }} onClose={() => setCreating(null)} />}
      {creating === "workflow" && sel && <WorkflowCreateChat area={sel.area} areaId={areaIdByKey.get(sel.area.key)} standard={creatingStandard} onCreated={() => { load(); setCreating(null); setCreatingStandard(null); }} onClose={() => { setCreating(null); setCreatingStandard(null); }} />}
      {creating === "agent" && sel && (
        <Modal open onClose={() => setCreating(null)} title={`Put an agent on ${sel.area.label}`} width={420}>
          <div className="stack-2">
            {(raw?.agents ?? []).length > 0 ? (raw?.agents ?? []).map((a) => (
              <button key={a.id} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", width: "100%" }} onClick={() => connectAgent(a.id)}>
                <span style={{ fontWeight: 640, fontSize: 13 }}>{a.name}</span>
                <span className="t-sub t-muted" style={{ fontSize: 11.5, display: "block" }}>Connect to {sel.area.label}</span>
              </button>
            )) : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No agents yet — <a href="/agents?tab=agents">create one</a> first, then connect it here.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
