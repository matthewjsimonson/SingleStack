"use client";

// SignalNetwork — the signals profile as a living NUCLEUS you navigate by zoom.
// Center = the core (what we are); four arms = competitive · industry · persona ·
// technology; nodes sit by vector (arm) × weight (ring: 3 core/inner … 1 edge).
// The whole nucleus always fits the frame. Hover an arm → it lifts and its name
// appears; click → zoom in. Zoomed: hover a node → its name appears; click a node
// → its sidebar opens. Names stay hidden until hovered so it reads as a nucleus.

import { useState } from "react";
import type { Vector } from "@/components/SignalProfile";

export type NetField = { field_key: string; label: string; value: string; vector?: Vector; weight?: number; origin?: string };

const ARMS: { key: Vector; label: string; angle: number; color: string }[] = [
  { key: "competitive", label: "Competitive", angle: -45, color: "var(--ac, #c2410c)" },
  { key: "industry", label: "Industry", angle: 45, color: "var(--gn-text, #15803d)" },
  { key: "persona", label: "Persona", angle: 135, color: "var(--vl, #7c3aed)" },
  { key: "technology", label: "Technology", angle: 225, color: "var(--bd, #b45309)" },
];

// Near-square viewBox tightened to the content so the nucleus fills the frame
// (no wide letterboxing); rings pushed out to use the space.
const W = 720, H = 680;
const CX = W / 2, CY = H / 2;
const RING = [128, 218, 300];
const radiusFor = (weight?: number) => RING[Math.min(2, Math.max(0, 3 - (weight ?? 2)))];
const rad = (deg: number) => (deg * Math.PI) / 180;
const wOf = (f: NetField) => Math.min(3, Math.max(1, f.weight ?? 2));
const SECTOR = 76;
const P = (deg: number, dist: number): [number, number] => [CX + Math.cos(rad(deg)) * dist, CY + Math.sin(rad(deg)) * dist];

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

  type Placed = { f: NetField; x: number; y: number; r: number };
  const placeArm = (arm: typeof ARMS[number]): Placed[] => {
    const nodes = fields.filter((f) => (f.vector ?? "core") === arm.key && f.label.trim());
    const placed: Placed[] = [];
    for (const w of [3, 2, 1]) {
      const ring = nodes.filter((f) => wOf(f) === w);
      const fan = Math.min(SECTOR, 22 * Math.max(1, ring.length - 1));
      ring.forEach((f, i) => {
        const off = ring.length === 1 ? 0 : (i / (ring.length - 1) - 0.5) * fan;
        const [x, y] = P(arm.angle + off, radiusFor(w));
        placed.push({ f, x, y, r: 6 + w * 3 });
      });
    }
    return placed;
  };
  const armLayouts = ARMS.map((arm) => ({ arm, placed: placeArm(arm) }));
  const core = fields.filter((f) => (f.vector ?? "core") === "core" && f.label.trim());
  const corePlaced = core.map((f, i) => {
    const [x, y] = core.length <= 1 ? [CX, CY] : P((360 / core.length) * i - 90, 50);
    return { f, x, y };
  });

  // Zoom transform: focus the open arm (or core) at the frame center.
  let transform = "";
  if (openVector && openVector !== "core") {
    const arm = ARMS.find((a) => a.key === openVector)!;
    const S = 1.5, [fx, fy] = P(arm.angle, 188);
    transform = `translate(${CX - S * fx} ${CY - S * fy}) scale(${S})`;
  } else if (openVector === "core") {
    const S = 1.7;
    transform = `translate(${CX - S * CX} ${CY - S * CY}) scale(${S})`;
  }
  // Dim: a hovered arm in overview lifts (others dim a little); a zoomed arm
  // hard-dims the rest.
  const armOpacity = (k: Vector) => {
    if (openVector) return openVector === k ? 1 : 0.08;
    if (hoverArm) return hoverArm === k ? 1 : 0.4;
    return 0.92;
  };

  const wedge = (angle: number) => {
    const HS = 45, r0 = 46, r1 = RING[2] + 48;
    const [a, b] = [angle - HS, angle + HS];
    return `M ${P(a, r0).join(" ")} L ${P(a, r1).join(" ")} A ${r1} ${r1} 0 0 1 ${P(b, r1).join(" ")} L ${P(b, r0).join(" ")} A ${r0} ${r0} 0 0 0 ${P(a, r0).join(" ")} Z`;
  };
  const nodeOf = (key: string | null) => key ? fields.find((f) => f.field_key === key) : null;
  const hoverNodeF = nodeOf(hoverNode);

  return (
    <div className="card" style={{ background: "radial-gradient(120% 120% at 50% 50%, var(--panel) 60%, var(--panel-2) 100%)", overflow: "hidden", position: "relative", height: "min(72vh, 640px)" }}>
      {openVector && (
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 2 }} className="row gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => onOpenVector(null)}>‹ All vectors</button>
          <button className="btn btn-sm" onClick={onCurate} style={{ background: "var(--ac)", color: "#fff" }}>Manage vector</button>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signals nucleus" style={{ display: "block" }}>
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--ac)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--ac)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--ac)" stopOpacity="0" />
          </radialGradient>
          <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>

        <g transform={transform} style={{ transition: "transform 380ms cubic-bezier(.4,0,.2,1)" }}>
          {/* nucleus glow + faint weight rings */}
          <circle cx={CX} cy={CY} r={150} fill="url(#coreGlow)">
            <animate attributeName="r" values="140;165;140" dur="6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;1;0.8" dur="6s" repeatCount="indefinite" />
          </circle>
          {RING.map((r, i) => <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="2 7" opacity={0.4} />)}

          {/* hover RAY — a beam of the arm's color out of the nucleus (wide soft
              glow + a brighter narrow core, so the color reads clearly) */}
          {!openVector && hoverArm && (() => {
            const arm = ARMS.find((a) => a.key === hoverArm)!;
            const r = RING[2] + 18;
            const cone = (hw: number) => `M ${CX} ${CY} L ${P(arm.angle - hw, r).join(" ")} A ${r} ${r} 0 0 1 ${P(arm.angle + hw, r).join(" ")} Z`;
            return (<>
              <path d={cone(28)} fill={arm.color} opacity={0.22} filter="url(#soft)" style={{ pointerEvents: "none" }} />
              <path d={cone(12)} fill={arm.color} opacity={0.30} filter="url(#soft)" style={{ pointerEvents: "none" }} />
            </>);
          })()}

          {/* arms: filaments + node dots */}
          {armLayouts.map(({ arm, placed }) => (
            <g key={arm.key} opacity={armOpacity(arm.key)} style={{ transition: "opacity 240ms" }}>
              {placed.map((p) => <line key={`l-${p.f.field_key}`} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={arm.color} strokeWidth={hoverArm === arm.key ? 1.6 : 1} opacity={hoverArm === arm.key ? 0.6 : 0.28} />)}
              {placed.map((p) => {
                const on = selectedKey === p.f.field_key, hov = hoverNode === p.f.field_key;
                const interactive = openVector === arm.key;
                return (
                  <g key={`n-${p.f.field_key}`} style={{ cursor: interactive ? "pointer" : "default" }}
                    onMouseEnter={interactive ? () => setHoverNode(p.f.field_key) : undefined}
                    onMouseLeave={interactive ? () => setHoverNode(null) : undefined}
                    onClick={interactive ? () => onOpenNode(p.f.field_key) : undefined}>
                    {(hov || on) && <circle cx={p.x} cy={p.y} r={p.r + 6} fill={arm.color} opacity={0.25} filter="url(#soft)" />}
                    <circle cx={p.x} cy={p.y} r={p.r} fill={p.f.value.trim() ? arm.color : "var(--panel)"} stroke={arm.color} strokeWidth={on ? 3.5 : 1.5} opacity={p.f.value.trim() ? 0.92 : 1} />
                  </g>
                );
              })}
            </g>
          ))}

          {/* core nucleus */}
          <g opacity={openVector && openVector !== "core" ? 0.1 : 1} style={{ transition: "opacity 240ms" }}>
            <circle cx={CX} cy={CY} r={36} fill="var(--tp)" opacity={0.94} />
            <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", fill: "var(--panel)", pointerEvents: "none" }}>CORE</text>
            {corePlaced.map((p) => {
              const on = selectedKey === p.f.field_key, hov = hoverNode === p.f.field_key, interactive = openVector === "core";
              return (
                <g key={`c-${p.f.field_key}`} style={{ cursor: interactive ? "pointer" : "default" }}
                  onMouseEnter={interactive ? () => setHoverNode(p.f.field_key) : undefined}
                  onMouseLeave={interactive ? () => setHoverNode(null) : undefined}
                  onClick={interactive ? () => onOpenNode(p.f.field_key) : undefined}>
                  {(hov || on) && <circle cx={p.x} cy={p.y} r={14} fill="var(--tp)" opacity={0.25} filter="url(#soft)" />}
                  <circle cx={p.x} cy={p.y} r={8} fill="var(--tp)" stroke="var(--panel)" strokeWidth={on ? 3 : 1.5} />
                </g>
              );
            })}
          </g>

          {/* VECTOR LABELS — always visible (muted); the hovered one pops + colors */}
          {!openVector && ARMS.map((arm) => {
            const [lx, ly] = P(arm.angle, RING[2] + 20);
            const hv = hoverArm === arm.key;
            return <text key={`lbl-${arm.key}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: hv ? 15.5 : 12.5, fontWeight: hv ? 800 : 680, letterSpacing: "0.07em", textTransform: "uppercase", fill: hv ? arm.color : "var(--tm)", transition: "fill 160ms, font-size 160ms", pointerEvents: "none" }}>{arm.label}</text>;
          })}
          {openVector && hoverNodeF && (() => {
            const p = [...armLayouts.flatMap((a) => a.placed), ...corePlaced.map((c) => ({ ...c, r: 8 }))].find((x) => x.f.field_key === hoverNode);
            if (!p) return null;
            return <text x={p.x} y={p.y - (p.r ?? 8) - 10} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 700, fill: "var(--tp)", pointerEvents: "none" }}>{hoverNodeF.label}</text>;
          })()}

          {/* hover/click hit-areas: per-arm wedges (overview only) + core */}
          {!openVector && ARMS.map((arm) => (
            <path key={`hit-${arm.key}`} d={wedge(arm.angle)} fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverArm(arm.key)} onMouseLeave={() => setHoverArm(null)}
              onClick={() => { setHoverArm(null); onOpenVector(arm.key); }} />
          ))}
          <circle cx={CX} cy={CY} r={38} fill="transparent" style={{ cursor: "pointer" }}
            onMouseEnter={() => !openVector && setHoverArm(null)}
            onClick={() => (openVector ? onOpenVector(null) : onOpenVector("core"))} />
        </g>
      </svg>

      {!openVector && (
        <div className="t-sub t-muted" style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11.5, pointerEvents: "none" }}>Hover a vector · click to zoom in &amp; manage</div>
      )}
    </div>
  );
}
