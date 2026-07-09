"use client";

// CoverageMap — the signals network as a calm coverage grid: your three
// FOCUSES (competitive · market · technology) across the top, the LEVELS of
// focus (direct · adjacent · indirect) down the side, and every node placed in
// its cell. Full coverage is legible at a glance: an empty cell is a visible
// GAP in the network, not a missing arm on a picture. The core (what you are)
// sits above the grid — every focus reads from it.
//
// Click a cell to work that focus at that level; click a gap to add the first
// node there. No motion, no zooming — the structure IS the view.

import type { Vector } from "@/components/SignalProfile";

type Field = { field_key: string; label: string; value: string; vector?: Vector; weight?: number; parent_key?: string | null };

const FOCUSES: { key: Exclude<Vector, "core">; label: string; color: string }[] = [
  { key: "competitive", label: "Competitive", color: "var(--rd-text)" },
  { key: "market", label: "Market", color: "var(--gn-text)" },
  { key: "technology", label: "Technology", color: "var(--am-text)" },
];
const LEVELS: { w: number; label: string; hint: string }[] = [
  { w: 3, label: "Direct", hint: "your ground — searched first" },
  { w: 2, label: "Adjacent", hint: "one step out — tracked steadily" },
  { w: 1, label: "Indirect", hint: "the horizon — caught, not chased" },
];

export default function CoverageMap({ fields, active, onOpen }: {
  fields: Field[];
  active: Vector;
  // Open a focus at a level; addFirst = true when the cell is a gap.
  onOpen: (focus: Vector, level: number, addFirst: boolean) => void;
}) {
  const nodesAt = (focus: string, w: number) =>
    fields.filter((f) => (f.vector ?? "core") === focus && Math.min(3, Math.max(1, f.weight ?? 2)) === w && f.field_key.trim());
  const core = fields.filter((f) => (f.vector ?? "core") === "core" && f.field_key.trim());

  return (
    <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
      {/* The core — what you are; every focus reads from it. */}
      <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <button className="t-label" onClick={() => onOpen("core", 3, core.length === 0)}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0, color: active === "core" ? "var(--tp)" : "var(--tm)" }}>
          Core · {core.length}
        </button>
        {core.length === 0
          ? <span className="t-sub t-muted" style={{ fontSize: 12 }}>not set up yet — start here; every focus builds on it</span>
          : core.map((f) => (
            <span key={f.field_key} className="t-sub" style={{ fontSize: 12, background: "var(--fill)", borderRadius: 999, padding: "2px 9px", cursor: "pointer" }}
              onClick={() => onOpen("core", 3, false)}>{f.label || "Untitled"}</span>
          ))}
      </div>

      {/* Focus × level grid — coverage at a glance. */}
      <div style={{ display: "grid", gridTemplateColumns: "84px repeat(3, 1fr)", gap: 6 }}>
        <span />
        {FOCUSES.map((fo) => (
          <button key={fo.key} onClick={() => onOpen(fo.key, 3, false)}
            style={{ cursor: "pointer", background: "none", border: "none", padding: "2px 4px", textAlign: "left" }}>
            <span className="t-label" style={{ color: active === fo.key ? fo.color : "var(--tm)" }}>{fo.label}</span>
          </button>
        ))}
        {LEVELS.map((lv) => (
          <FragmentRow key={lv.w} lv={lv} nodesAt={nodesAt} onOpen={onOpen} active={active} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ lv, nodesAt, onOpen, active }: {
  lv: { w: number; label: string; hint: string };
  nodesAt: (focus: string, w: number) => Field[];
  onOpen: (focus: Vector, level: number, addFirst: boolean) => void;
  active: Vector;
}) {
  return (
    <>
      <div style={{ paddingTop: 8 }}>
        <div className="t-label" style={{ fontSize: 10.5 }}>{lv.label}</div>
        <div className="t-mono-xs t-muted" style={{ fontSize: 9.5, lineHeight: 1.4, marginTop: 2 }}>{lv.hint}</div>
      </div>
      {FOCUSES.map((fo) => {
        const nodes = nodesAt(fo.key, lv.w);
        const gap = nodes.length === 0;
        return (
          <button key={fo.key} onClick={() => onOpen(fo.key, lv.w, gap)}
            title={gap ? `No ${lv.label.toLowerCase()} ${fo.label.toLowerCase()} coverage yet — add the first node` : `${nodes.length} node(s) — open ${fo.label}`}
            style={{
              cursor: "pointer", textAlign: "left", minHeight: 52, padding: "7px 9px",
              background: gap ? "transparent" : active === fo.key ? "var(--panel-2)" : "var(--panel)",
              border: gap ? "1px dashed var(--border-strong)" : "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start", alignContent: "flex-start",
            }}>
            {gap
              ? <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>+ cover this</span>
              : nodes.slice(0, 6).map((n) => (
                <span key={n.field_key} className="t-sub" style={{ fontSize: 11.5, background: "var(--fill)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{n.label || "Untitled"}</span>
              ))}
            {!gap && nodes.length > 6 && <span className="t-mono-xs t-muted">+{nodes.length - 6}</span>}
          </button>
        );
      })}
    </>
  );
}
