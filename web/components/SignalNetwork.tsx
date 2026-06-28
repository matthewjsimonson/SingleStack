"use client";

// SignalNetwork — the signals profile rendered as a radial graph. A CENTER
// ('core' — what we are) with four arms (competitive · industry · persona ·
// technology). Each node is placed by its VECTOR (which arm) and its WEIGHT
// (distance from center: 3 = core/closest, 1 = edge/farthest). Purely visual:
// it reads the profile fields and reports clicks; editing stays in SignalProfile.

import type { Vector } from "@/components/SignalProfile";

export type NetField = { field_key: string; label: string; value: string; vector?: Vector; weight?: number; origin?: string };

// The four arms, at evenly-spaced angles (degrees, 0 = east, clockwise in SVG
// where +y is down). Colors lean on the app's accent tokens.
const ARMS: { key: Vector; label: string; angle: number; color: string }[] = [
  { key: "competitive", label: "Competitive", angle: -45, color: "var(--ac, #c2410c)" },
  { key: "industry", label: "Industry", angle: 45, color: "var(--gn-text, #15803d)" },
  { key: "persona", label: "Persona", angle: 135, color: "var(--vl, #7c3aed)" },
  { key: "technology", label: "Technology", angle: 225, color: "var(--bd, #b45309)" },
];

const W = 720, H = 560;
const CX = W / 2, CY = H / 2;
const RING = [96, 168, 244]; // radius for weight 3 (core/closest), 2, 1 (edge)
const radiusFor = (weight?: number) => RING[Math.min(2, Math.max(0, 3 - (weight ?? 2)))];
const rad = (deg: number) => (deg * Math.PI) / 180;

export default function SignalNetwork({ headline, fields, onSelect, selectedKey }: {
  headline: string;
  fields: NetField[];
  onSelect: (fieldKey: string) => void;
  selectedKey?: string | null;
}) {
  const core = fields.filter((f) => (f.vector ?? "core") === "core" && f.label.trim());

  // Lay out each arm's nodes: sort by weight (core first), place by radius
  // (weight) and fan across an angular spread so siblings don't overlap.
  type Placed = { f: NetField; x: number; y: number; r: number };
  const placeArm = (arm: typeof ARMS[number]): Placed[] => {
    const nodes = fields.filter((f) => (f.vector ?? "core") === arm.key && f.label.trim())
      .sort((a, b) => (b.weight ?? 2) - (a.weight ?? 2));
    const spread = Math.min(64, 18 * Math.max(1, nodes.length - 1)); // total fan, degrees
    return nodes.map((f, i) => {
      const off = nodes.length === 1 ? 0 : (i / (nodes.length - 1) - 0.5) * spread;
      const a = rad(arm.angle + off);
      const dist = radiusFor(f.weight) + ((i % 2) * 14); // slight stagger to de-overlap
      return { f, x: CX + Math.cos(a) * dist, y: CY + Math.sin(a) * dist, r: 5 + (f.weight ?? 2) * 3 };
    });
  };

  const armLayouts = ARMS.map((arm) => ({ arm, placed: placeArm(arm) }));
  // Core nodes ring tightly around the center.
  const corePlaced = core.map((f, i) => {
    const a = rad((360 / Math.max(1, core.length)) * i - 90);
    const dist = core.length === 1 ? 0 : 40;
    return { f, x: CX + Math.cos(a) * dist, y: CY + Math.sin(a) * dist };
  });

  const trunc = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const empty = fields.filter((f) => f.label.trim()).length === 0;

  return (
    <div className="card" style={{ background: "var(--panel)", overflow: "hidden", position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxHeight: 560 }} role="img" aria-label="Signals profile network">
        {/* weight rings */}
        {RING.map((r, i) => (
          <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="3 5" opacity={0.5} />
        ))}
        {/* arm labels at the rim */}
        {ARMS.map((arm) => {
          const a = rad(arm.angle);
          const lx = CX + Math.cos(a) * (RING[2] + 34), ly = CY + Math.sin(a) * (RING[2] + 34);
          return <text key={arm.key} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fill: arm.color }}>{arm.label}</text>;
        })}

        {/* branches + nodes per arm */}
        {armLayouts.map(({ arm, placed }) => (
          <g key={arm.key}>
            {placed.map((p) => (
              <line key={`l-${p.f.field_key}`} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={arm.color} strokeWidth={1} opacity={0.32} />
            ))}
            {placed.map((p) => {
              const on = selectedKey === p.f.field_key;
              return (
                <g key={`n-${p.f.field_key}`} style={{ cursor: "pointer" }} onClick={() => onSelect(p.f.field_key)}>
                  <circle cx={p.x} cy={p.y} r={p.r} fill={p.f.value.trim() ? arm.color : "var(--panel)"} stroke={arm.color} strokeWidth={on ? 3 : 1.5} opacity={p.f.value.trim() ? 0.9 : 1} />
                  <text x={p.x} y={p.y - p.r - 5} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: on ? 700 : 540, fill: "var(--tp)" }}>{trunc(p.f.label)}</text>
                </g>
              );
            })}
          </g>
        ))}

        {/* the core — center */}
        <circle cx={CX} cy={CY} r={30} fill="var(--tp)" opacity={0.92} />
        <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", fill: "var(--panel)" }}>CORE</text>
        {corePlaced.map((p) => {
          const on = selectedKey === p.f.field_key;
          return (
            <g key={`c-${p.f.field_key}`} style={{ cursor: "pointer" }} onClick={() => onSelect(p.f.field_key)}>
              <circle cx={p.x} cy={p.y} r={7} fill="var(--tp)" stroke="var(--panel)" strokeWidth={on ? 3 : 1.5} />
              <text x={p.x} y={p.y - 12} textAnchor="middle" style={{ fontSize: 10, fontWeight: on ? 700 : 560, fill: "var(--tp)" }}>{trunc(p.f.label, 18)}</text>
            </g>
          );
        })}
      </svg>

      {headline.trim() && <div className="t-sub" style={{ position: "absolute", left: 14, bottom: 12, right: 14, fontSize: 12, fontStyle: "italic", color: "var(--tm)" }}>{headline}</div>}
      {empty && <div className="t-sub t-muted" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>Draft with AI to build the network.</div>}
    </div>
  );
}
