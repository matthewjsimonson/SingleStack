"use client";

// The Ecosystem (Phase G) — a VISUAL map of the product-led-growth motion. Two
// record cores — Build/Product (the PM engine) and GTM (the PMM flywheel) — with
// their areas as nodes orbiting each core, colored by coverage (green covered,
// amber partial, red GAP). The loop between the cores is the PLG motion: builds
// fuel growth; usage/PQL signals feed back. Gaps are meant to be SEEN; click any
// node to see what's missing and the controls to close it. Filter to either circle.
// Reads the verified model (web/lib/ecosystem.ts) over RLS-fenced data.
// Note: SVG colours go through `style` (CSS var() does not resolve in SVG attrs).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section } from "@/components/ui";
import {
  PRODUCT_AREAS, GTM_AREAS, CHECKS, CHECK_LABEL, computeCoverage, classifyCoverage,
  type Area, type Check, type AreaStatus, type Harmony,
} from "@/lib/ecosystem";

type Input = Parameters<typeof computeCoverage>[0];
type Lens = "all" | "product" | "gtm";

const harmonyTone = (h: Harmony) =>
  h === "healthy" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Healthy" }
  : h === "watch" ? { fill: "color-mix(in srgb, var(--am) 16%, transparent)", text: "var(--am)", label: "Watch" }
  : { fill: "color-mix(in srgb, var(--rd) 14%, transparent)", text: "var(--rd)", label: "At risk" };

// Node colour by coverage — gaps get a heavier stroke so they pop.
const nodeTone = (s: AreaStatus) =>
  s === "covered" ? { fill: "var(--gn-fill)", stroke: "var(--gn-text)", sw: 1.5 }
  : s === "partial" ? { fill: "color-mix(in srgb, var(--am) 20%, transparent)", stroke: "var(--am)", sw: 1.5 }
  : { fill: "color-mix(in srgb, var(--rd) 16%, transparent)", stroke: "var(--rd)", sw: 2.75 };
const chipTone = (s: AreaStatus) =>
  s === "covered" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Covered" }
  : s === "partial" ? { fill: "color-mix(in srgb, var(--am) 15%, transparent)", text: "var(--am)", label: "Partial" }
  : { fill: "color-mix(in srgb, var(--rd) 13%, transparent)", text: "var(--rd)", label: "Gap" };

const fixFor = (area: Area, c: Check): { href: string; label: string } =>
  c === "agent" ? { href: "/agents?tab=agents", label: `Put an agent on ${area.label}` }
  : c === "cornerstone" ? { href: "/agents?tab=agents", label: "Give it a cornerstone" }
  : c === "skills" ? { href: "/agents?tab=skills", label: "Add a child skill" }
  : { href: "/agents?tab=workflows", label: "Create a workflow" };

const shortLabel = (l: string) => { const s = l.split(/ [&/]/)[0].trim(); return s.length > 15 ? s.slice(0, 14) + "…" : s; };

// --- layout -----------------------------------------------------------------
const VB = { w: 960, h: 600 };
type Cluster = { key: "product" | "gtm"; cx: number; cy: number; r: number; a0: number; a1: number; full: boolean; areas: Area[]; coreLabel: string; coreRole: string; engine?: boolean };

function clustersFor(lens: Lens): Cluster[] {
  if (lens === "product")
    return [{ key: "product", cx: 480, cy: 300, r: 205, a0: 0, a1: 360, full: true, areas: PRODUCT_AREAS, coreLabel: "Product", coreRole: "the build engine", engine: true }];
  if (lens === "gtm")
    return [{ key: "gtm", cx: 480, cy: 300, r: 225, a0: 0, a1: 360, full: true, areas: GTM_AREAS, coreLabel: "GTM", coreRole: "the flywheel" }];
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
  const [data, setData] = useState<Input | null>(null);
  const [counts, setCounts] = useState({ products: 0, gtm: 0, agents: 0 });
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Lens>("all");
  const [selKey, setSelKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: ag }, { data: conns }, { data: agSk }, { data: sk }, { data: wf }, { count: pc }, { count: gc }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
      supabase.from("agent_skills").select("agent_id, skill_id"),
      supabase.from("skills").select("id, kind, areas"),
      supabase.from("workflows").select("agent_id, target_type, is_active"),
      supabase.from("product_records").select("id", { count: "exact", head: true }),
      supabase.from("gtm_records").select("id", { count: "exact", head: true }),
    ]);
    const agents = (ag ?? []) as { id: string; name: string }[];
    setData({
      agents,
      connections: (conns ?? []) as Input["connections"],
      agentSkills: (agSk ?? []) as Input["agentSkills"],
      skills: (sk ?? []) as Input["skills"],
      workflows: (wf ?? []) as Input["workflows"],
    });
    setCounts({ products: pc ?? 0, gtm: gc ?? 0, agents: agents.length });
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const coverage = useMemo(() => (data ? computeCoverage(data) : null), [data]);
  const health = useMemo(() => (coverage ? classifyCoverage(coverage) : null), [coverage]);
  const covByKey = useMemo(() => new Map((coverage?.areas ?? []).map((a) => [a.area.key, a] as const)), [coverage]);
  const clusters = useMemo(() => clustersFor(lens), [lens]);
  const laidOut = useMemo(() => clusters.map((c) => ({ c, nodes: nodePositions(c) })), [clusters]);

  if (loading || !coverage || !health) return <div className="t-sub t-muted">Loading the ecosystem…</div>;

  const noRecords = counts.products === 0 && counts.gtm === 0;
  const noAgents = counts.agents === 0;
  const ht = harmonyTone(health.harmony.status);
  const sel = selKey ? covByKey.get(selKey) ?? null : null;
  const lensKeys = new Set(laidOut.flatMap((l) => l.nodes.map((n) => n.area.key)));
  const todo = [...health.rankedGaps, ...health.rankedPartials].filter((c) => lensKeys.has(c.area.key));
  const cyclePath = (above: boolean) => { const y = 300, dy = above ? -54 : 54; return `M 332 ${y} C 430 ${y + dy}, 530 ${y + dy}, 628 ${y}`; };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      {/* Status is always answerable. */}
      <div className="card card-pad" style={{ background: ht.fill, borderColor: ht.text }}>
        <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: ht.text, flexShrink: 0 }} />
            <span style={{ fontWeight: 720, color: ht.text }}>{ht.label}</span>
            <span style={{ fontSize: 13.5, color: "var(--tp)", minWidth: 0 }}>{health.harmony.headline}</span>
          </div>
          <span className="t-mono-xs t-muted" style={{ flexShrink: 0, fontSize: 11.5 }}>
            {health.counts.covered} covered · {health.counts.partial} partial · {health.counts.gap} gap
          </span>
        </div>
      </div>

      {/* Filter + legend. */}
      <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span className="t-mono-xs t-muted" style={{ fontSize: 10.5, marginRight: 2 }}>View</span>
          {(["all", "product", "gtm"] as Lens[]).map((l) => (
            <button key={l} onClick={() => { setLens(l); setSelKey(null); }} className="btn btn-sm"
              style={{ background: lens === l ? "var(--ac-fill)" : "transparent", color: lens === l ? "var(--ac-text)" : "var(--tp)", borderColor: lens === l ? "var(--ac-text)" : "var(--border)", fontWeight: lens === l ? 700 : 540 }}>
              {l === "all" ? "The full motion" : l === "product" ? "Product" : "GTM"}
            </button>
          ))}
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", fontSize: 10.5 }}>
          {([["Covered", "var(--gn-text)"], ["Partial", "var(--am)"], ["Gap", "var(--rd)"]] as const).map(([lab, col]) => (
            <span key={lab} className="row gap-1" style={{ alignItems: "center", gap: 4, color: "var(--tm)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: col, flexShrink: 0 }} />{lab}
            </span>
          ))}
        </div>
      </div>

      {/* THE MAP. */}
      <div className="card" style={{ padding: 8, overflow: "hidden" }}>
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Ecosystem coverage map">
          <defs>
            <marker id="eco-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" style={{ fill: "var(--ac-text)" }} />
            </marker>
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
              {nodes.map((n) => {
                const cov = covByKey.get(n.area.key); const isGap = (cov?.status ?? "gap") === "gap"; const t = nodeTone(cov?.status ?? "gap");
                return <line key={`l-${n.area.key}`} x1={c.cx} y1={c.cy} x2={n.x} y2={n.y} strokeWidth={isGap ? 1.4 : 1} style={{ stroke: t.stroke, opacity: isGap ? 0.5 : 0.28 }} />;
              })}

              <circle cx={c.cx} cy={c.cy} r={42} strokeWidth={c.engine ? 2 : 1.5} onClick={() => { setLens(c.key); setSelKey(null); }}
                style={{ cursor: "pointer", fill: c.engine ? "var(--ac-fill)" : "var(--well, #f3f3f5)", stroke: c.engine ? "var(--ac-text)" : "var(--border)" }} />
              <text x={c.cx} y={c.cy - 2} textAnchor="middle" fontSize={14} fontWeight={760} style={{ pointerEvents: "none", fill: c.engine ? "var(--ac-text)" : "var(--tp)" }}>{c.coreLabel}</text>
              <text x={c.cx} y={c.cy + 13} textAnchor="middle" fontSize={9} style={{ pointerEvents: "none", fill: "var(--tm)" }}>{c.coreRole}</text>

              {nodes.map((n) => {
                const cov = covByKey.get(n.area.key); const status = cov?.status ?? "gap"; const t = nodeTone(status);
                const isSel = selKey === n.area.key; const isGap = status === "gap"; const R = n.area.engine ? 30 : 25;
                return (
                  <g key={n.area.key} onClick={() => setSelKey(isSel ? null : n.area.key)} style={{ cursor: "pointer" }}>
                    {isSel && <circle cx={n.x} cy={n.y} r={R + 5} strokeWidth={1.5} style={{ fill: "none", stroke: "var(--ac-text)" }} />}
                    <circle cx={n.x} cy={n.y} r={R} strokeWidth={t.sw} style={{ fill: t.fill, stroke: t.stroke }} />
                    {isGap && <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={17} fontWeight={800} style={{ pointerEvents: "none", fill: "var(--rd)" }}>!</text>}
                    {n.area.engine && !isGap && <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={9} fontWeight={700} style={{ pointerEvents: "none", fill: "var(--ac-text)" }}>engine</text>}
                    <text x={n.x} y={n.y + R + 13} textAnchor="middle" fontSize={10} fontWeight={isGap ? 700 : 540} style={{ pointerEvents: "none", fill: "var(--tp)" }}>{shortLabel(n.area.label)}</text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Detail of the selected node — what's missing + the controls to close it. */}
      {sel ? (
        <div className="card card-pad" style={{ borderColor: chipTone(sel.status).text }}>
          <div className="row-between" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
              <span className="chip" style={{ fontSize: 9.5, fontWeight: 700, background: chipTone(sel.status).fill, color: chipTone(sel.status).text }}>{chipTone(sel.status).label}</span>
              <span style={{ fontWeight: 680, fontSize: 14 }}>{sel.area.label}</span>
              {sel.area.engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
              <span className="t-mono-xs t-muted" style={{ fontSize: 10 }}>{sel.area.circle === "product" ? "Build / Product" : "Go-to-market"}{sel.area.record ? ` · ${sel.area.record}` : ""}</span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelKey(null)} style={{ flexShrink: 0 }}>Close</button>
          </div>
          <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{sel.area.blurb}</div>
          <div className="row gap-2" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {CHECKS.map((c) => {
              const on = sel.checks[c];
              return (
                <span key={c} className="row gap-1" style={{ alignItems: "center", gap: 5, fontSize: 11.5, color: on ? "var(--tp)" : "var(--tm)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: on ? "var(--gn-text)" : "transparent", border: on ? "none" : "1.5px solid var(--rd)" }} />
                  {CHECK_LABEL[c]}
                </span>
              );
            })}
          </div>
          {sel.missing.length > 0 ? (
            <div>
              <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 7 }}>Close the gap:</div>
              <div className="row gap-2" style={{ flexWrap: "wrap", gap: 6 }}>
                {sel.missing.map((c, i) => { const f = fixFor(sel.area, c); return <a key={c} href={f.href} className={`btn btn-sm ${i === 0 ? "" : "btn-secondary"}`} style={{ fontSize: 11.5 }}>+ {f.label}</a>; })}
              </div>
            </div>
          ) : <div className="t-sub" style={{ fontSize: 12, color: "var(--gn-text)" }}>Fully covered — agent, cornerstone, child skills, and a workflow are all in place.</div>}
        </div>
      ) : (
        <div className="t-sub t-muted" style={{ fontSize: 12, textAlign: "center", padding: "2px 0" }}>
          Click any node to see its coverage and close its gaps. Red nodes (!) have no agent yet.
        </div>
      )}

      {(noRecords || noAgents) && (
        <Section label="Stand up your ecosystem">
          <div className="stack-2">
            <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: noRecords ? 1 : 0.6 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 720, background: noRecords ? "var(--ac-fill)" : "var(--gn-fill)", color: noRecords ? "var(--ac-text)" : "var(--gn-text)" }}>{noRecords ? "1" : "✓"}</span>
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 660, fontSize: 13.5 }}>Set your Product &amp; GTM records</div><div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>The truth at the center of each core. The ecosystem can&apos;t cover work it has no record for.</div></div>
              {noRecords && <a className="btn btn-sm" href="/products" style={{ flexShrink: 0 }}>Set up records</a>}
            </div>
            <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: noAgents ? 1 : 0.6 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 720, background: noAgents ? "var(--ac-fill)" : "var(--gn-fill)", color: noAgents ? "var(--ac-text)" : "var(--gn-text)" }}>{noAgents ? "2" : "✓"}</span>
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 660, fontSize: 13.5 }}>Staff the areas with agents</div><div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>Executive agents with cornerstones + child skills, connected to the areas they own.</div></div>
              {noAgents && <a className="btn btn-sm" href="/agents?tab=agents" style={{ flexShrink: 0 }}>Add agents</a>}
            </div>
          </div>
        </Section>
      )}

      {todo.length > 0 && (
        <Section label={lens === "all" ? "What's unattended" : `What's unattended · ${lens === "product" ? "Product" : "GTM"}`}>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Closest to the flywheel first — the Build engine leads. Click one to highlight it on the map.</div>
          <div className="stack-2">
            {todo.slice(0, 5).map((cov) => {
              const t = chipTone(cov.status); const c0 = cov.missing[0]; const f = c0 ? fixFor(cov.area, c0) : null;
              return (
                <div key={cov.area.key} className="card card-pad" style={{ borderLeft: `3px solid ${t.text}`, cursor: "pointer" }} onClick={() => setSelKey(cov.area.key)}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap-2" style={{ alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
                        <span className="chip" style={{ fontSize: 9.5, background: t.fill, color: t.text, fontWeight: 700 }}>{t.label}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 640 }}>{cov.area.label}</span>
                        {cov.area.engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
                      </div>
                      <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>Missing: {cov.missing.map((m) => CHECK_LABEL[m].toLowerCase()).join(" · ")}.</div>
                    </div>
                    {f && <a className="btn btn-secondary btn-sm" href={f.href} style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>+ {f.label}</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
