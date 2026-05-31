"use client";

// The Intelligence Map — a SEMANTIC strategy surface. Position is meaning: a
// curated View maps each theme's attributes to a labelled position. No freeform
// axis-picker — you pick a View, each answering one question. (Action Matrix
// first; more Views as dimensions populate.) Signals collapse into their theme
// here; bridges draw as edges; contradiction shows as a marker. Click a node to
// drill in. Battle-tested to stay legible from a handful to ~50 themes.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Banner, Spinner, Chip } from "@/components/ui";
import { projectActionMatrix, VIEWS, type ViewKey, type PTheme, type PBridgeEdge } from "@/lib/projections";

const W = 1000, H = 600, PAD = 56;

const LANE_FILL: Record<string, string> = { hot: "var(--rd-fill)", warm: "var(--am-fill)", cool: "var(--fill)" };
const themeFill = (t: PTheme) => (t.lens === "gtm" ? "var(--vl)" : "var(--ac)");
const themeOpacity = (t: PTheme) => (t.state === "fading" ? 0.5 : t.state === "dormant" ? 0.32 : t.state === "escalating" ? 1 : 0.85);

export default function MapView() {
  const supabase = createClient();
  const router = useRouter();
  const [themes, setThemes] = useState<PTheme[]>([]);
  const [bridges, setBridges] = useState<PBridgeEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("action");
  const [hover, setHover] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: ths }, { data: strength }, { data: tsig }, { data: misses }, { data: brs }] = await Promise.all([
      supabase.from("signal_themes").select("id, title, category, state, momentum, horizon, owner_team").neq("state", "dormant"),
      supabase.from("theme_evidence_strength").select("theme_id, honest_conf, contra_signals"),
      supabase.from("theme_signals").select("theme_id, stance"),
      supabase.from("theme_misses").select("theme_id"),
      supabase.from("bridge_strength").select("product_theme_id, gtm_theme_id, bridge_conf, state"),
    ]);
    const confBy: Record<string, number> = {}, contraBy: Record<string, number> = {};
    for (const s of strength ?? []) { confBy[s.theme_id] = s.honest_conf ?? 0; contraBy[s.theme_id] = s.contra_signals ?? 0; }
    const sigCount: Record<string, number> = {};
    for (const t of tsig ?? []) sigCount[t.theme_id] = (sigCount[t.theme_id] ?? 0) + 1;
    const missSet = new Set((misses ?? []).map((m) => m.theme_id));

    const list: PTheme[] = (ths ?? []).map((t) => ({
      id: t.id, title: t.title, lens: t.category as "product" | "gtm", conf: confBy[t.id] ?? 0,
      momentum: t.momentum, state: t.state, horizon: t.horizon, owner: t.owner_team,
      signalCount: sigCount[t.id] ?? 0, contraCount: contraBy[t.id] ?? 0,
      flag: t.state === "escalating" ? "escalating" : missSet.has(t.id) ? "reconsider" : null,
      href: `/signals/themes/${t.id}`,
    }));
    setThemes(list);
    setBridges((brs ?? []).filter((b) => b.state !== "dismissed").map((b) => ({ source: b.product_theme_id, target: b.gtm_theme_id, conf: b.bridge_conf ?? 0 })));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const projection = useMemo(() => projectActionMatrix(themes, W, H, PAD), [themes]);
  const posById = useMemo(() => new Map(projection.nodes.map((n) => [n.id, n])), [projection]);

  if (loading) return <Spinner label="Projecting the map…" />;

  const activeView = VIEWS.find((v) => v.key === view)!;

  return (
    <div>
      <Banner>{error}</Banner>

      {/* View picker — curated, not freeform. */}
      <div className="row-between" style={{ marginBottom: "var(--sp-3)", alignItems: "baseline" }}>
        <div className="row gap-2">
          {VIEWS.map((v) => (
            <button key={v.key} className={v.key === view ? "btn btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
        <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>{activeView.question}</span>
      </div>

      {themes.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>The map is empty</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Synthesize themes and they appear here, positioned by what they mean.</div>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel)" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "72vh", display: "block" }}>
            {/* lanes (meaning bands) */}
            {projection.lanes.map((l, i) => (
              <g key={i}>
                <rect x={PAD} y={l.y0} width={W - PAD * 2} height={l.y1 - l.y0} fill={LANE_FILL[l.tone ?? "cool"]} opacity={0.5} />
                <text x={PAD + 8} y={l.y0 + 18} fontSize={12} fontWeight={600} fill="var(--tm)">{l.label}</text>
              </g>
            ))}
            {/* x-axis labels */}
            {projection.colLabels.map((c, i) => (
              <text key={i} x={c.x} y={H - 18} fontSize={12} fontWeight={600} fill="var(--ts)" textAnchor="middle">{c.label}</text>
            ))}
            <text x={W / 2} y={H - 3} fontSize={11} fill="var(--tm)" textAnchor="middle">{projection.xAxisLabel}</text>

            {/* bridge edges between positioned themes */}
            {bridges.map((b, i) => {
              const a = posById.get(b.source), c = posById.get(b.target);
              if (!a || !c) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="var(--vl)" strokeWidth={1.5} opacity={0.45} />;
            })}

            {/* theme nodes */}
            {projection.nodes.map((n) => {
              const isHover = hover === n.id;
              const stroke = n.flag === "escalating" ? "var(--am-text)" : n.flag === "reconsider" ? "var(--am-text)" : isHover ? "var(--tp)" : "none";
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "pointer" }}
                   onClick={() => router.push(n.href)}
                   onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                  <circle r={n.r} fill={themeFill(n)} opacity={themeOpacity(n)} stroke={stroke} strokeWidth={n.flag ? 2.5 : isHover ? 1.5 : 0} />
                  {n.contraCount > 0 && <circle r={3.5} cx={n.r * 0.7} cy={-n.r * 0.7} fill="var(--rd-text)" />}
                  <text x={0} y={n.r + 11} fontSize={isHover ? 11 : 9.5} fontWeight={isHover ? 600 : 400} fill="var(--tp)" textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {n.title.length > 22 ? n.title.slice(0, 22) + "…" : n.title}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* legend */}
          <div className="row gap-2" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <Chip tone="accent">product</Chip><Chip tone="violet">gtm</Chip>
            <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>size = confidence · lane = momentum · ring = escalating/reconsider · <span style={{ color: "var(--rd-text)" }}>●</span> contradicted · line = bridge</span>
          </div>
        </div>
      )}
    </div>
  );
}
