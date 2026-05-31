"use client";

// The Intelligence Map — a living, force-directed view of the whole graph you
// operate from. Nodes: signals · themes · bridges · decisions · build items.
// Edges carry stance (supports solid / contradicts red-dashed), bridges, and
// decision/build provenance. Size = honest confidence, opacity = lifecycle,
// pulse = momentum. Commanders (powered by the anti-mediocrity views) post
// callouts pinned to nodes pointing at threats and opportunities. Click a node
// to drill in; click a callout to act. SVG + a tiny custom force sim — every
// visual property encodes a real variable, nothing decorative.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Banner, Spinner } from "@/components/ui";
import { simulate, radiusOf, type GNode, type GEdge } from "@/lib/forceGraph";

const W = 1000, H = 620;

const KIND_COLOR: Record<string, string> = {
  signal: "var(--tm)", theme: "var(--ac)", bridge: "var(--vl)", decision: "var(--am-text)", build: "var(--gn)",
};
function nodeFill(n: GNode): string {
  if (n.kind === "theme") return n.lens === "gtm" ? "var(--vl)" : "var(--ac)";
  return KIND_COLOR[n.kind] ?? "var(--tm)";
}
function nodeOpacity(n: GNode): number {
  if (n.state === "fading") return 0.45;
  if (n.state === "dormant") return 0.28;
  if (n.state === "escalating") return 1;
  return 0.85;
}

type Commander = { node_id: string; kind: "reconsider" | "revisit" | "escalating" | "strong_bridge"; label: string; href: string };

export default function IntelMap() {
  const supabase = createClient();
  const router = useRouter();
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [commanders, setCommanders] = useState<Commander[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ id: string | null; px: number; py: number; moved: boolean }>({ id: null, px: 0, py: 0, moved: false });
  const pan = useRef<{ active: boolean; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: themes }, { data: tsig }, { data: signals }, { data: bridges }, { data: decisions }, { data: builds }, { data: misses }, { data: stale }] = await Promise.all([
      supabase.from("signal_themes").select("id, category, title, state, momentum"),
      supabase.from("theme_signals").select("theme_id, signal_id, stance"),
      supabase.from("signals").select("id, title, category"),
      supabase.from("bridge_strength").select("bridge_id, title, state, product_theme_id, gtm_theme_id, bridge_conf"),
      supabase.from("decisions").select("id, title, theme_id, status"),
      supabase.from("initiatives").select("id, title, decision_id").eq("lane", "ship"),
      supabase.from("theme_misses").select("theme_id, title"),
      supabase.from("decision_staleness").select("decision_id, title"),
    ]);

    // Honest confidence per theme (used for size). Read from the strength view.
    const { data: strength } = await supabase.from("theme_evidence_strength").select("theme_id, honest_conf");
    const confByTheme: Record<string, number> = {};
    for (const s of strength ?? []) confByTheme[s.theme_id] = s.honest_conf ?? 0;

    // Only signals attached to a theme appear (keeps the map meaningful, not noisy).
    const attachedSignalIds = new Set((tsig ?? []).map((t) => t.signal_id));

    const ns: GNode[] = [];
    const seed = (i: number) => ({ x: W / 2 + Math.cos(i) * 200 + (Math.random() - 0.5) * 40, y: H / 2 + Math.sin(i) * 160 + (Math.random() - 0.5) * 40, vx: 0, vy: 0 });
    let i = 0;
    for (const t of themes ?? []) ns.push({ id: t.id, kind: "theme", label: t.title, lens: t.category as "product" | "gtm", conf: confByTheme[t.id] ?? 0, momentum: t.momentum, state: t.state, href: `/signals/themes/${t.id}`, flag: null, fx: null, fy: null, ...seed(i++) });
    for (const s of signals ?? []) if (attachedSignalIds.has(s.id)) ns.push({ id: s.id, kind: "signal", label: s.title, lens: (s.category as "product" | "gtm") ?? null, conf: 0.3, state: "active", flag: null, fx: null, fy: null, ...seed(i++) });
    for (const b of bridges ?? []) if (b.state !== "dismissed") ns.push({ id: b.bridge_id, kind: "bridge", label: b.title, conf: b.bridge_conf, state: b.state === "proposed" ? "emerging" : "active", href: `/signals`, flag: null, fx: null, fy: null, ...seed(i++) });
    for (const d of decisions ?? []) ns.push({ id: d.id, kind: "decision", label: d.title, conf: 0.6, state: "active", href: `/decisions/${d.id}`, flag: null, fx: null, fy: null, ...seed(i++) });
    for (const it of builds ?? []) ns.push({ id: it.id, kind: "build", label: it.title, conf: 0.5, state: "active", href: `/ship/${it.id}`, flag: null, fx: null, fy: null, ...seed(i++) });

    const nodeIds = new Set(ns.map((n) => n.id));
    const es: GEdge[] = [];
    for (const t of tsig ?? []) if (nodeIds.has(t.theme_id) && nodeIds.has(t.signal_id)) es.push({ source: t.theme_id, target: t.signal_id, kind: t.stance === "contradicts" ? "contradicts" : "supports" });
    for (const b of bridges ?? []) if (b.state !== "dismissed" && nodeIds.has(b.bridge_id)) {
      if (nodeIds.has(b.product_theme_id)) es.push({ source: b.bridge_id, target: b.product_theme_id, kind: "bridge" });
      if (nodeIds.has(b.gtm_theme_id)) es.push({ source: b.bridge_id, target: b.gtm_theme_id, kind: "bridge" });
    }
    for (const d of decisions ?? []) if (d.theme_id && nodeIds.has(d.id) && nodeIds.has(d.theme_id)) es.push({ source: d.id, target: d.theme_id, kind: "decision" });
    for (const it of builds ?? []) if (it.decision_id && nodeIds.has(it.id) && nodeIds.has(it.decision_id)) es.push({ source: it.id, target: it.decision_id, kind: "build" });

    // Commanders — callouts from the anti-mediocrity engine, pinned to nodes.
    const cmd: Commander[] = [];
    const flagOn: Record<string, string> = {};
    for (const m of misses ?? []) { cmd.push({ node_id: m.theme_id, kind: "reconsider", label: "Worth reconsidering — evidence returned", href: `/signals/themes/${m.theme_id}` }); flagOn[m.theme_id] = "reconsider"; }
    for (const s of stale ?? []) { cmd.push({ node_id: s.decision_id, kind: "revisit", label: "Worth revisiting — ground shifted", href: `/decisions/${s.decision_id}` }); flagOn[s.decision_id] = "revisit"; }
    for (const t of themes ?? []) if (t.state === "escalating") { cmd.push({ node_id: t.id, kind: "escalating", label: "Escalating front", href: `/signals/themes/${t.id}` }); flagOn[t.id] = flagOn[t.id] ?? "escalating"; }
    for (const b of bridges ?? []) if (b.state === "active" && (b.bridge_conf ?? 0) >= 0.7) { cmd.push({ node_id: b.bridge_id, kind: "strong_bridge", label: "Strong bridge — two fronts connected", href: `/signals` }); flagOn[b.bridge_id] = "strong_bridge"; }
    for (const n of ns) n.flag = flagOn[n.id] ?? null;

    simulate(ns, es, W, H);
    setNodes(ns); setEdges(es); setCommanders(cmd); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // --- pan / zoom / drag handlers (SVG coordinate space) ---
  function toGraph(clientX: number, clientY: number) {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * W;
    const sy = (clientY - r.top) / r.height * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, k: Math.max(0.4, Math.min(3, v.k * factor)) }));
  }
  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    drag.current = { id, px: e.clientX, py: e.clientY, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag.current.id) {
      const p = toGraph(e.clientX, e.clientY);
      const n = byId.get(drag.current.id);
      if (n) { n.fx = p.x; n.fy = p.y; n.x = p.x; n.y = p.y; drag.current.moved = true; setNodes((ns) => [...ns]); }
    } else if (pan.current?.active) {
      const dx = (e.clientX - pan.current.px), dy = (e.clientY - pan.current.py);
      pan.current.px = e.clientX; pan.current.py = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  }
  function onPointerUp() {
    if (drag.current.id && !drag.current.moved) {
      const n = byId.get(drag.current.id);
      if (n?.href) router.push(n.href);
    }
    if (drag.current.id) { const n = byId.get(drag.current.id); if (n) { n.fx = null; n.fy = null; } }
    drag.current = { id: null, px: 0, py: 0, moved: false };
    pan.current = null;
  }

  if (loading) return <Spinner label="Assembling the map…" />;

  return (
    <div>
      <Banner>{error}</Banner>

      {nodes.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>The map is empty</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Log signals and synthesize themes — the battlefield assembles itself as intelligence comes in.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: "var(--sp-5)", alignItems: "start" }}>
          {/* THE MAP */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel-2)" }}>
            <svg
              ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "70vh", display: "block", cursor: pan.current?.active ? "grabbing" : "grab", touchAction: "none" }}
              onWheel={onWheel}
              onPointerDown={(e) => { pan.current = { active: true, px: e.clientX, py: e.clientY }; }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {/* edges */}
                {edges.map((e, idx) => {
                  const a = byId.get(e.source), b = byId.get(e.target);
                  if (!a || !b) return null;
                  const contra = e.kind === "contradicts";
                  const stroke = contra ? "var(--rd-text)" : e.kind === "bridge" ? "var(--vl)" : "var(--border-strong)";
                  return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={stroke} strokeWidth={e.kind === "bridge" ? 2 : 1}
                    strokeDasharray={contra ? "4 3" : undefined} opacity={contra ? 0.8 : 0.4} />;
                })}
                {/* nodes */}
                {nodes.map((n) => {
                  const r = radiusOf(n);
                  const isHover = hover === n.id;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}
                       onPointerDown={(e) => onNodeDown(e, n.id)}
                       onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
                       style={{ cursor: "pointer" }}>
                      {n.momentum === "accelerating" && n.state !== "fading" && (
                        <circle r={r + 4} fill="none" stroke={nodeFill(n)} strokeWidth={1} opacity={0.35}>
                          <animate attributeName="r" values={`${r};${r + 8};${r}`} dur="2.2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.35;0;0.35" dur="2.2s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle r={r} fill={nodeFill(n)} opacity={nodeOpacity(n)}
                        stroke={n.flag ? "var(--am-text)" : isHover ? "var(--tp)" : "none"} strokeWidth={n.flag ? 2.5 : isHover ? 1.5 : 0} />
                      {n.flag && <circle r={3} cx={r * 0.7} cy={-r * 0.7} fill="var(--am-text)" />}
                      {(isHover || n.kind === "bridge" || n.kind === "theme") && (
                        <text x={r + 4} y={4} fontSize={isHover ? 12 : 10} fill="var(--tp)" style={{ pointerEvents: "none", fontWeight: isHover ? 600 : 500 }}>
                          {n.label.length > 38 ? n.label.slice(0, 38) + "…" : n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* COMMANDERS rail */}
          <div style={{ display: "grid", gap: "var(--sp-3)", position: "sticky", top: "var(--sp-4)" }}>
            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>Commanders</div>
              <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Where to look right now — flagged on the map.</div>
            </div>
            {commanders.length === 0 ? (
              <p className="t-muted" style={{ fontSize: 12.5 }}>No alerts. The front is quiet.</p>
            ) : commanders.map((c, i) => (
              <button key={i} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", borderLeft: "2px solid var(--am-text)", padding: "10px 12px" }}
                onClick={() => router.push(c.href)} onPointerEnter={() => setHover(c.node_id)} onPointerLeave={() => setHover(null)}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</div>
                <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{byId.get(c.node_id)?.label ?? ""}</div>
              </button>
            ))}

            <div style={{ marginTop: "var(--sp-3)" }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Legend</div>
              <div className="t-sub t-muted" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
                <div><span style={{ color: "var(--ac)" }}>●</span> product theme &nbsp; <span style={{ color: "var(--vl)" }}>●</span> gtm theme</div>
                <div><span style={{ color: "var(--vl)" }}>●</span> bridge &nbsp; <span style={{ color: "var(--am-text)" }}>●</span> decision &nbsp; <span style={{ color: "var(--gn)" }}>●</span> build</div>
                <div>size = confidence · pulse = accelerating · faint = fading</div>
                <div><span style={{ color: "var(--rd-text)" }}>– –</span> contradicting evidence</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
