"use client";

// SignalNetwork — the signals profile rendered to the reference design: a dark
// canvas with a glowing particle NUCLEUS at the center (the company's core),
// one labeled HUB per vector, and organic BRANCHES growing outward from each
// hub — node chaining off node, where distance from the center means further
// from the company's core (closer = higher weight, more defining).
//
// Legibility rules (deliberate; the old renderer got this wrong):
//   • vector names are ALWAYS visible — big, at the periphery, reference-style;
//     never hover-only;
//   • zoomed into a vector, every node label is visible — you always know
//     what you're looking at;
//   • in the overview, node labels appear on hover (density would swallow
//     them otherwise), but the structure itself is always named.
//
// The renderer is generic over its vector set (VECTOR_STYLE below) so the same
// component can later draw the agent ecosystem: departments as vectors, agents
// as nodes — general near the hub, task-specific further out.

import { useMemo, useState, type CSSProperties } from "react";
import type { Vector } from "@/components/SignalProfile";

export type NetField = {
  field_key: string; label: string; value: string;
  vector?: Vector; weight?: number; origin?: string;
  parent_key?: string | null;
};

// Per-vector visual identity. Colors are tokens from globals.css (this is the
// one deliberately dark surface); icons are tiny inline strokes, no icon lib.
const VECTOR_STYLE: Record<Exclude<Vector, "core">, { label: string; color: string; icon: string }> = {
  competitive: { label: "Competitive", color: "var(--net-competitive)", icon: "M8 2v3M8 11v3M2 8h3M11 8h3M8 5.5A2.5 2.5 0 1 1 8 10.5 2.5 2.5 0 0 1 8 5.5" },
  industry: { label: "Industry", color: "var(--net-industry)", icon: "M3 14V7l3-2v9M6 14V5l4-3v12M10 14V6l3 2v6M2 14h12" },
  persona: { label: "Persona", color: "var(--net-persona)", icon: "M8 3.5A2.4 2.4 0 1 1 8 8.3 2.4 2.4 0 0 1 8 3.5M3.5 13.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" },
  technology: { label: "Technology", color: "var(--net-technology)", icon: "M5 5h6v6H5zM8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.5 1.5M12 4l-1.5 1.5M4 12l1.5-1.5M12 12l-1.5-1.5" },
};

const W = 880, H = 780;
const CX = W / 2, CY = H / 2;
const R_HUB = 196;          // hub distance from center
const R_LABEL = 366;        // vector-name distance (past the branch tips)
const SECTOR = 66;          // degrees of arm spread
const STEP = [58, 50, 44];  // outward distance per chain depth
const rad = (d: number) => (d * Math.PI) / 180;
const P = (deg: number, dist: number, cx = CX, cy = CY): [number, number] =>
  [cx + Math.cos(rad(deg)) * dist, cy + Math.sin(rad(deg)) * dist];

// Deterministic per-key jitter (hydration-safe; no Math.random at render).
const hash01 = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
};

// Seeded PRNG for the nucleus particle field (same field every render).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Placed = { f: NetField; x: number; y: number; r: number; depth: number; angle: number };
type Link = { x1: number; y1: number; x2: number; y2: number };

// Build one arm's forest: parent_key chains when present; legacy flat data
// (no parents yet) derives chains from weight so old profiles read as branches.
function buildArm(nodes: NetField[], armAngle: number): { placed: Placed[]; links: Link[] } {
  const byKey = new Map(nodes.map((f) => [f.field_key, f]));
  const validParent = (f: NetField) => (f.parent_key && f.parent_key !== f.field_key && byKey.has(f.parent_key) ? f.parent_key : null);
  const hasTree = nodes.some((f) => validParent(f));
  const childrenOf = new Map<string, NetField[]>();
  let roots: NetField[] = [];

  if (hasTree) {
    for (const f of nodes) {
      const p = validParent(f);
      if (p) childrenOf.set(p, [...(childrenOf.get(p) ?? []), f]);
      else roots.push(f);
    }
  } else {
    // Derive: weight 3 roots the branch, 2 chains off it, 1 sits at the tip.
    const tier = (w: number) => nodes.filter((f) => Math.min(3, Math.max(1, f.weight ?? 2)) === w);
    let [t3, t2, t1] = [tier(3), tier(2), tier(1)];
    if (!t3.length) { [t3, t2, t1] = [t2, t1, []]; }
    if (!t3.length) { [t3, t2, t1] = [t2.length ? t2 : t1, [], []]; }
    roots = t3;
    t2.forEach((f, i) => { const p = t3[i % Math.max(1, t3.length)]; if (p) childrenOf.set(p.field_key, [...(childrenOf.get(p.field_key) ?? []), f]); });
    const mids = t2.length ? t2 : t3;
    t1.forEach((f, i) => { const p = mids[i % Math.max(1, mids.length)]; if (p) childrenOf.set(p.field_key, [...(childrenOf.get(p.field_key) ?? []), f]); });
  }

  roots.sort((a, b) => (b.weight ?? 2) - (a.weight ?? 2));
  const placed: Placed[] = [];
  const links: Link[] = [];
  const [hx, hy] = P(armAngle, R_HUB);
  const seen = new Set<string>(); // cycle guard (parent loops in hand-edited data)

  function place(f: NetField, angle: number, dist: number, depth: number, px: number, py: number) {
    if (seen.has(f.field_key)) return;
    seen.add(f.field_key);
    const a = angle + (hash01(f.field_key) - 0.5) * 14;
    const [x, y] = P(a, dist);
    const w = Math.min(3, Math.max(1, f.weight ?? 2));
    placed.push({ f, x, y, r: 3.4 + w * 1.5, depth, angle: a });
    links.push({ x1: px, y1: py, x2: x, y2: y });
    const kids = (childrenOf.get(f.field_key) ?? []).slice().sort((k1, k2) => (k2.weight ?? 2) - (k1.weight ?? 2));
    const kidFan = kids.length <= 1 ? 0 : Math.min(34, 17 * (kids.length - 1));
    kids.forEach((kid, i) => {
      const ka = a + (kids.length === 1 ? 0 : (i / (kids.length - 1) - 0.5) * kidFan);
      place(kid, ka, dist + STEP[Math.min(depth, STEP.length - 1)], depth + 1, x, y);
    });
  }

  const fan = roots.length <= 1 ? 0 : Math.min(SECTOR, 24 * (roots.length - 1));
  roots.forEach((root, i) => {
    const rootAngle = armAngle + (roots.length === 1 ? 0 : (i / (roots.length - 1) - 0.5) * fan);
    place(root, rootAngle, R_HUB + STEP[0], 1, hx, hy);
  });

  return { placed, links };
}

export default function SignalNetwork({ fields, openVector, onOpenVector, onOpenNode, onCurate, selectedKey }: {
  fields: NetField[];
  openVector: Vector | null;
  onOpenVector: (v: Vector | null) => void;
  onOpenNode: (fieldKey: string) => void;
  onCurate: () => void;
  selectedKey?: string | null;
}) {
  const [hoverArm, setHoverArm] = useState<Vector | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const vectors = Object.keys(VECTOR_STYLE) as Exclude<Vector, "core">[];
  const arms = useMemo(() => vectors.map((v, i) => {
    const angle = -45 + (360 / vectors.length) * i;
    const nodes = fields.filter((f) => (f.vector ?? "core") === v && f.label.trim());
    return { v, angle, ...buildArm(nodes, angle), count: nodes.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [fields]);

  const core = fields.filter((f) => (f.vector ?? "core") === "core" && f.label.trim());
  const corePlaced = core.map((f, i) => {
    const a = (360 / Math.max(1, core.length)) * i - 90 + (hash01(f.field_key) - 0.5) * 18;
    const [x, y] = P(a, core.length <= 1 ? 0 : 46 + (hash01(f.field_key + "r") - 0.5) * 14);
    return { f, x, y, angle: a };
  });

  // Nucleus particle field — deterministic, generated once.
  const particles = useMemo(() => {
    const rnd = mulberry32(7);
    return Array.from({ length: 130 }, () => {
      const a = rnd() * 360;
      const d = (rnd() + rnd()) * 0.5 * 62;           // center-weighted
      const [x, y] = P(a, d);
      return { x, y, r: 0.7 + rnd() * 1.7, o: 0.25 + rnd() * 0.7 };
    });
  }, []);
  const filaments = useMemo(() => {
    const rnd = mulberry32(23);
    return Array.from({ length: 14 }, () => {
      const a = rnd() * 360;
      const [x1, y1] = P(a, 6 + rnd() * 14);
      const [x2, y2] = P(a + (rnd() - 0.5) * 30, 34 + rnd() * 34);
      return { x1, y1, x2, y2, o: 0.1 + rnd() * 0.2 };
    });
  }, []);

  // Zoom: fit the open arm's (or the core's) actual bounds to the frame, so
  // the view recalibrates to whatever the branch has grown into — and returns
  // to the identity fit when you back out.
  let transform = "";
  if (openVector) {
    let xs: number[], ys: number[];
    if (openVector === "core") {
      xs = [CX - 130, CX + 130, ...corePlaced.map((p) => p.x)];
      ys = [CY - 130, CY + 130, ...corePlaced.map((p) => p.y)];
    } else {
      const arm = arms.find((a) => a.v === openVector);
      const [hx, hy] = P(arm?.angle ?? 0, R_HUB);
      xs = [hx - 30, hx + 30, ...(arm?.placed.map((p) => p.x) ?? [])];
      ys = [hy - 30, hy + 30, ...(arm?.placed.map((p) => p.y) ?? [])];
    }
    const pad = 120; // room for the canvas-top header and node labels
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const S = Math.min(2.2, Math.max(1.15, Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY))));
    const [bx, by] = [(minX + maxX) / 2, (minY + maxY) / 2];
    transform = `translate(${CX - S * bx} ${CY - S * by}) scale(${S})`;
  }

  const armOpacity = (v: Vector) => {
    if (openVector) return openVector === v ? 1 : 0.05;
    if (hoverArm) return hoverArm === v ? 1 : 0.42;
    return 1;
  };

  return (
    <div style={{ position: "relative", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signals network — nucleus, vectors and branches"
        style={{ display: "block", width: "100%", background: "radial-gradient(ellipse 75% 70% at 50% 46%, var(--net-bg) 55%, var(--net-bg-edge) 100%)" }}
        onMouseLeave={() => { setHoverArm(null); setHoverNode(null); }}>
        <defs>
          <radialGradient id="net-nucleus-glow">
            <stop offset="0%" stopColor="var(--net-core)" stopOpacity="0.32" />
            <stop offset="55%" stopColor="var(--net-core)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--net-core)" stopOpacity="0" />
          </radialGradient>
          <filter id="net-soft" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>

        <g transform={transform} style={{ transition: "transform 320ms cubic-bezier(0.16,1,0.3,1)" }}>

          {/* ---- nucleus (the core) ---- */}
          <g opacity={openVector && openVector !== "core" ? 0.25 : 1} style={{ cursor: "pointer", transition: "opacity 200ms ease" }}
            onClick={() => onOpenVector(openVector === "core" ? null : "core")}
            onMouseEnter={() => setHoverArm("core")} onMouseLeave={() => setHoverArm(null)}>
            <circle cx={CX} cy={CY} r={104} fill="url(#net-nucleus-glow)">
              <animate attributeName="opacity" values="0.85;1;0.85" dur="6s" repeatCount="indefinite" />
            </circle>
            {filaments.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--net-core)" strokeWidth={0.6} opacity={l.o} />)}
            {particles.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="var(--net-core)" opacity={p.o} />)}
            {/* core nodes — the defining statements live inside the glow */}
            {corePlaced.map(({ f, x, y, angle }) => {
              const active = hoverNode === f.field_key || selectedKey === f.field_key;
              const showLabel = openVector === "core" || active;
              const [lx, ly] = P(angle, 26, x, y);
              return (
                <g key={f.field_key} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); if (openVector === "core") onOpenNode(f.field_key); else onOpenVector("core"); }}
                  onMouseEnter={() => setHoverNode(f.field_key)} onMouseLeave={() => setHoverNode(null)}>
                  <circle cx={x} cy={y} r={11} fill="transparent" />
                  <circle cx={x} cy={y} r={active ? 5.4 : 4.4} fill="var(--net-ink)" opacity={active ? 1 : 0.9} style={{ transition: "all 120ms ease" }} />
                  {showLabel && (
                    <text x={lx} y={ly} textAnchor="middle" fontSize={openVector === "core" ? 9.5 : 11} fill="var(--net-ink)"
                      style={{ fontFamily: "'JetBrains Mono', monospace", pointerEvents: "none" }}>{f.label}</text>
                  )}
                </g>
              );
            })}
            {hoverArm === "core" && !openVector && (
              <text x={CX} y={CY + 130} textAnchor="middle" fontSize={12} fill="var(--net-ink)" letterSpacing="0.14em"
                style={{ fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", pointerEvents: "none" }}>Core — what we are</text>
            )}
          </g>

          {/* ---- arms: hub + branches + always-on name ---- */}
          {arms.map(({ v, angle, placed, links, count }) => {
            const st = VECTOR_STYLE[v];
            const [hx, hy] = P(angle, R_HUB);
            const [tx, ty] = P(angle, R_LABEL);
            const [c1x, c1y] = P(angle, 96);
            const [c2x, c2y] = P(angle, R_HUB - 26);
            const isOpen = openVector === v;
            return (
              <g key={v} opacity={armOpacity(v)} style={{ transition: "opacity 200ms ease" }}
                onMouseEnter={() => setHoverArm(v)} onMouseLeave={() => setHoverArm(null)}>

                {/* nucleus → hub trail (dotted, like the reference) */}
                <line x1={c1x} y1={c1y} x2={c2x} y2={c2y} stroke="var(--net-line)" strokeWidth={1} strokeDasharray="2 6" opacity={0.7} />

                {/* branch links */}
                {links.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--net-line)" strokeWidth={1} />)}

                {/* hub */}
                <g style={{ cursor: "pointer" }} onClick={() => onOpenVector(isOpen ? null : v)}>
                  <circle cx={hx} cy={hy} r={26} fill={st.color} opacity={0.14} filter="url(#net-soft)" />
                  <circle cx={hx} cy={hy} r={17} fill="var(--net-bg)" stroke={st.color} strokeWidth={1.6} />
                  <circle cx={hx} cy={hy} r={17} fill="none" stroke="var(--net-ring)" strokeWidth={5} opacity={hoverArm === v || isOpen ? 1 : 0} style={{ transition: "opacity 120ms ease" }} />
                  <g transform={`translate(${hx - 8} ${hy - 8})`}>
                    <path d={st.icon} fill="none" stroke={st.color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                </g>

                {/* the vector's name — always visible in the overview, reference-
                    style; hidden while zoomed (the header controls name it, and
                    it would collide with the node labels). */}
                <g style={{ cursor: "pointer", opacity: isOpen ? 0 : 1, transition: "opacity 200ms ease", pointerEvents: isOpen ? "none" : undefined }} onClick={() => onOpenVector(isOpen ? null : v)}>
                  <text x={tx} y={ty} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--net-ink)" letterSpacing="0.22em"
                    style={{ fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{st.label}</text>
                  <line x1={tx - 34} y1={ty + 12} x2={tx + 34} y2={ty + 12} stroke="var(--net-ink-dim)" strokeWidth={1.4} strokeDasharray="9 5" />
                  <text x={tx} y={ty + 28} textAnchor="middle" fontSize={10} fill="var(--net-ink-dim)" letterSpacing="0.08em"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}>{count ? `${count} node${count === 1 ? "" : "s"}` : "empty — click to build"}</text>
                </g>

                {/* nodes */}
                {placed.map(({ f, x, y, r, angle: na }) => {
                  const active = hoverNode === f.field_key || selectedKey === f.field_key;
                  const showLabel = isOpen || active;
                  const [lx, ly] = P(na, r + 13, x, y);
                  return (
                    <g key={f.field_key} style={{ cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); if (isOpen) onOpenNode(f.field_key); else onOpenVector(v); }}
                      onMouseEnter={() => setHoverNode(f.field_key)} onMouseLeave={() => setHoverNode(null)}>
                      <circle cx={x} cy={y} r={r + 7} fill="transparent" />
                      {active && <circle cx={x} cy={y} r={r + 4} fill="none" stroke={st.color} strokeWidth={1.2} opacity={0.8} />}
                      <circle cx={x} cy={y} r={r} fill="var(--net-ink)" opacity={0.55 + 0.15 * Math.min(3, Math.max(1, f.weight ?? 2))} style={{ transition: "all 120ms ease" }} />
                      {showLabel && (
                        <text x={lx} y={ly + 3} textAnchor={Math.cos(rad(na)) >= 0 ? "start" : "end"} fontSize={isOpen ? 9 : 10.5}
                          fill={active ? "var(--net-ink)" : "var(--net-ink-dim)"}
                          style={{ fontFamily: "'JetBrains Mono', monospace", pointerEvents: "none" }}>{f.label}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* zoomed controls — the vector's name sits at the TOP of the canvas
          (never among the nodes), controls styled for the dark ground so the
          canvas reads as one consistent surface */}
      {openVector && (() => {
        const isCore = openVector === "core";
        const st = isCore ? null : VECTOR_STYLE[openVector as Exclude<Vector, "core">];
        const name = isCore ? "Core" : st!.label;
        const count = isCore ? core.length : arms.find((a) => a.v === openVector)?.count ?? 0;
        const netBtn: CSSProperties = {
          pointerEvents: "auto", cursor: "pointer",
          background: "rgba(240, 235, 221, 0.07)", color: "var(--net-ink)",
          border: "1px solid rgba(240, 235, 221, 0.22)", borderRadius: "var(--radius-sm)",
          fontSize: 12, fontWeight: 600, padding: "5px 10px", letterSpacing: "0.01em",
        };
        return (
          <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, pointerEvents: "none" }}>
            <button style={netBtn} onClick={() => onOpenVector(null)}>‹ Whole network</button>
            <div style={{ textAlign: "center", pointerEvents: "none" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: st?.color ?? "var(--net-core)" }}>{name}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", color: "var(--net-ink-dim)", marginTop: 2 }}>{count} node{count === 1 ? "" : "s"}</div>
            </div>
            <button style={netBtn} onClick={onCurate}>Manage {isCore ? "core" : st!.label}</button>
          </div>
        );
      })()}
      {!openVector && (
        <div className="t-mono-xs" style={{ position: "absolute", bottom: 10, left: 14, color: "var(--net-ink-dim)", pointerEvents: "none" }}>
          Click a vector to zoom · click a node to open it · closer to the center = closer to your core
        </div>
      )}
    </div>
  );
}
