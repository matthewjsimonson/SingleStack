"use client";

// SignalNetwork — the signals profile as a radial graph you navigate by ZOOM. A
// CENTER ('core' — what we are) with four arms (competitive · industry · persona
// · technology). Nodes are placed by VECTOR (arm) and WEIGHT (distance from the
// center: 3 = core/closest, 1 = edge/farthest). The whole network always fits the
// frame (no scroll). Click an arm to zoom into it; click the core, or "All
// vectors", to zoom back out. Editing happens in the VectorCurator sidebar.

import type { Vector } from "@/components/SignalProfile";

export type NetField = { field_key: string; label: string; value: string; vector?: Vector; weight?: number; origin?: string };

const ARMS: { key: Vector; label: string; angle: number; color: string }[] = [
  { key: "competitive", label: "Competitive", angle: -45, color: "var(--ac, #c2410c)" },
  { key: "industry", label: "Industry", angle: 45, color: "var(--gn-text, #15803d)" },
  { key: "persona", label: "Persona", angle: 135, color: "var(--vl, #7c3aed)" },
  { key: "technology", label: "Technology", angle: 225, color: "var(--bd, #b45309)" },
];

const W = 880, H = 660;
const CX = W / 2, CY = H / 2;
const RING = [116, 196, 276]; // radius for weight 3 (core/closest), 2, 1 (edge)
const radiusFor = (weight?: number) => RING[Math.min(2, Math.max(0, 3 - (weight ?? 2)))];
const rad = (deg: number) => (deg * Math.PI) / 180;
const wOf = (f: NetField) => Math.min(3, Math.max(1, f.weight ?? 2));
const SECTOR = 76; // degrees an arm spans

export default function SignalNetwork({ headline, fields, openVector, onOpenVector, onSelect, selectedKey }: {
  headline: string;
  fields: NetField[];
  openVector: Vector | null;
  onOpenVector: (v: Vector | null) => void;
  onSelect: (fieldKey: string) => void;
  selectedKey?: string | null;
}) {
  type Placed = { f: NetField; x: number; y: number; r: number };
  const placeArm = (arm: typeof ARMS[number]): Placed[] => {
    const nodes = fields.filter((f) => (f.vector ?? "core") === arm.key && f.label.trim());
    const placed: Placed[] = [];
    for (const w of [3, 2, 1]) {
      const ring = nodes.filter((f) => wOf(f) === w);
      const fan = Math.min(SECTOR, 22 * Math.max(1, ring.length - 1));
      ring.forEach((f, i) => {
        const off = ring.length === 1 ? 0 : (i / (ring.length - 1) - 0.5) * fan;
        const a = rad(arm.angle + off);
        const dist = radiusFor(w);
        placed.push({ f, x: CX + Math.cos(a) * dist, y: CY + Math.sin(a) * dist, r: 6 + w * 3 });
      });
    }
    return placed;
  };
  const armLayouts = ARMS.map((arm) => ({ arm, placed: placeArm(arm) }));
  const core = fields.filter((f) => (f.vector ?? "core") === "core" && f.label.trim());
  const corePlaced = core.map((f, i) => {
    const a = rad((360 / Math.max(1, core.length)) * i - 90);
    const dist = core.length <= 1 ? 0 : 46;
    return { f, x: CX + Math.cos(a) * dist, y: CY + Math.sin(a) * dist };
  });

  // Zoom transform: focus the open arm (or the core) at the frame center.
  let transform = "";
  if (openVector && openVector !== "core") {
    const arm = ARMS.find((a) => a.key === openVector)!;
    const S = 1.5, DF = 188;
    const fx = CX + Math.cos(rad(arm.angle)) * DF, fy = CY + Math.sin(rad(arm.angle)) * DF;
    transform = `translate(${CX - S * fx} ${CY - S * fy}) scale(${S})`;
  } else if (openVector === "core") {
    const S = 1.7;
    transform = `translate(${CX - S * CX} ${CY - S * CY}) scale(${S})`;
  }
  const dim = (k: Vector) => (openVector && openVector !== k ? 0.1 : 1);

  const trunc = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const empty = fields.filter((f) => f.label.trim()).length === 0;
  const armClick = (k: Vector) => (openVector === k ? undefined : onOpenVector(k));

  return (
    <div className="card" style={{ background: "var(--panel)", overflow: "hidden", position: "relative", height: "min(72vh, 640px)" }}>
      {openVector && (
        <button className="btn btn-secondary btn-sm" onClick={() => onOpenVector(null)} style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }}>‹ All vectors</button>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signals profile network" style={{ display: "block" }}>
        <g transform={transform} style={{ transition: "transform 380ms cubic-bezier(.4,0,.2,1)" }}>
          {/* weight rings */}
          {RING.map((r, i) => <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="3 6" opacity={0.45} />)}

          {/* arms */}
          {armLayouts.map(({ arm, placed }) => {
            const a = rad(arm.angle);
            const lx = CX + Math.cos(a) * (RING[2] + 40), ly = CY + Math.sin(a) * (RING[2] + 40);
            return (
              <g key={arm.key} opacity={dim(arm.key)} style={{ transition: "opacity 380ms" }}>
                {placed.map((p) => <line key={`l-${p.f.field_key}`} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={arm.color} strokeWidth={1} opacity={0.3} />)}
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" onClick={() => armClick(arm.key)}
                  style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", fill: arm.color, cursor: "pointer" }}>{arm.label}{!openVector ? ` · ${placed.length}` : ""}</text>
                {placed.map((p) => {
                  const on = selectedKey === p.f.field_key;
                  const click = openVector === arm.key ? () => onSelect(p.f.field_key) : () => onOpenVector(arm.key);
                  return (
                    <g key={`n-${p.f.field_key}`} style={{ cursor: "pointer" }} onClick={click}>
                      <circle cx={p.x} cy={p.y} r={p.r} fill={p.f.value.trim() ? arm.color : "var(--panel)"} stroke={arm.color} strokeWidth={on ? 3.5 : 1.5} opacity={p.f.value.trim() ? 0.92 : 1} />
                      {(openVector === arm.key || !openVector) && <text x={p.x} y={p.y - p.r - 5} textAnchor="middle" style={{ fontSize: openVector === arm.key ? 11 : 10, fontWeight: on ? 700 : 540, fill: "var(--tp)" }}>{trunc(p.f.label, openVector === arm.key ? 30 : 20)}</text>}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* the core — center */}
          <g opacity={dim("core")} style={{ transition: "opacity 380ms", cursor: "pointer" }} onClick={() => (openVector === "core" ? undefined : onOpenVector("core"))}>
            <circle cx={CX} cy={CY} r={34} fill="var(--tp)" opacity={0.93} />
            <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", fill: "var(--panel)" }}>CORE</text>
          </g>
          {corePlaced.map((p) => {
            const on = selectedKey === p.f.field_key;
            const click = openVector === "core" ? () => onSelect(p.f.field_key) : () => onOpenVector("core");
            return (
              <g key={`c-${p.f.field_key}`} opacity={dim("core")} style={{ cursor: "pointer" }} onClick={click}>
                <circle cx={p.x} cy={p.y} r={8} fill="var(--tp)" stroke="var(--panel)" strokeWidth={on ? 3 : 1.5} />
                {(openVector === "core" || !openVector) && <text x={p.x} y={p.y - 13} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: on ? 700 : 560, fill: "var(--tp)" }}>{trunc(p.f.label, 20)}</text>}
              </g>
            );
          })}
        </g>
      </svg>

      {!openVector && headline.trim() && <div className="t-sub" style={{ position: "absolute", left: 14, bottom: 12, right: 14, fontSize: 12, fontStyle: "italic", color: "var(--tm)" }}>{headline}</div>}
      {empty && <div className="t-sub t-muted" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, pointerEvents: "none" }}>Click a vector to start filling it out.</div>}
      {!openVector && !empty && <div className="t-sub t-muted" style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11.5, pointerEvents: "none" }}>Click a vector to zoom in & curate</div>}
    </div>
  );
}
