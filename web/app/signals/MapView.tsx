"use client";

// The Intelligence Map — a SEMANTIC strategy surface. Position is meaning: a
// curated View maps each theme's attributes to a labelled position. No freeform
// axis-picker — you pick a View, each answering one question. (Action Matrix
// first; more Views as dimensions populate.) Signals collapse into their theme
// here; bridges draw as edges; contradiction shows as a marker. Click a node to
// drill in. Battle-tested to stay legible from a handful to ~50 themes.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Banner, Spinner } from "@/components/ui";
import { projectActionMatrix, VIEWS, type ViewKey, type PTheme, type PBridgeEdge } from "@/lib/projections";
import { elevationField, contours, type Contour } from "@/lib/terrain";

const W = 1000, H = 600, PAD = 56;

// Dark tactical palette — the terrain glows against it.
const BG = "#0B0E14";
const themeFill = (t: PTheme) => (t.lens === "gtm" ? "#8B8FF5" : "#5E8AFF");
const themeOpacity = (t: PTheme) => (t.state === "fading" ? 0.5 : t.state === "dormant" ? 0.32 : t.state === "escalating" ? 1 : 0.9);

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

  // Terrain: elevation field → iso-contours. High ground = confident+accelerating
  // concentration; rifts at contradictions. Recomputed only when themes change.
  const terrain = useMemo<Contour[]>(() => {
    if (projection.nodes.length === 0) return [];
    const grid = elevationField(
      projection.nodes.map((n) => ({ x: n.x, y: n.y, conf: n.conf, momentum: n.momentum, contra: n.contraCount })),
      W, H,
    );
    return contours(grid, 7);
  }, [projection]);

  // "Breathing" — a single slow clock drives subtle ambient motion. Tied to real
  // state: accelerating nodes pulse faster/brighter, the terrain drifts gently.
  // Respects prefers-reduced-motion.
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let mounted = true, last = 0;
    // ~30fps is plenty for slow ambient motion (half the render work); pause when
    // the tab is hidden so we never burn cycles in the background.
    const tick = (now: number) => {
      if (!mounted) return;
      if (now - last > 33 && !document.hidden) { last = now; setT((p) => p + 0.033); }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { mounted = false; if (raf.current) cancelAnimationFrame(raf.current); };
  }, []);
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.6);          // slow 0..1 global breath
  const drift = Math.sin(t * 0.25) * 3;                    // gentle terrain sway (px)

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
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: BG }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "72vh", display: "block" }}>
            <defs>
              <radialGradient id="vignette" cx="50%" cy="42%" r="75%">
                <stop offset="60%" stopColor={BG} stopOpacity="0" />
                <stop offset="100%" stopColor="#05070B" stopOpacity="0.9" />
              </radialGradient>
            </defs>

            {/* TERRAIN — iso-contours that breathe. Higher levels brighter/thicker. */}
            <g transform={`translate(${drift},${drift * 0.5})`}>
              {terrain.map((c, i) => (
                <path key={i} d={c.paths.join(" ")} fill="none"
                  stroke={c.level > 0.66 ? "#7BA0FF" : "#3B5BCC"}
                  strokeWidth={0.5 + c.level * 1.6}
                  opacity={(0.12 + c.level * 0.5) * (0.82 + 0.18 * breathe)} />
              ))}
            </g>

            {/* lane dividers (subtle, on dark) */}
            {projection.lanes.map((l, i) => i === 0 ? null : (
              <line key={i} x1={PAD} y1={l.y0} x2={W - PAD} y2={l.y0} stroke="#1A2030" strokeWidth={1} />
            ))}
            {projection.lanes.map((l, i) => (
              <text key={`lbl${i}`} x={PAD + 6} y={l.y0 + 16} fontSize={11} fontWeight={600} fill="#5A6478" letterSpacing="0.04em">{l.label.toUpperCase()}</text>
            ))}
            {projection.colLabels.map((c, i) => (
              <text key={`c${i}`} x={c.x} y={H - 16} fontSize={11} fontWeight={600} fill="#7A8499" textAnchor="middle" letterSpacing="0.04em">{c.label.toUpperCase()}</text>
            ))}
            <text x={W / 2} y={H - 3} fontSize={10} fill="#4A5366" textAnchor="middle">{projection.xAxisLabel}</text>

            {/* bridges */}
            {bridges.map((b, i) => {
              const a = posById.get(b.source), c = posById.get(b.target);
              if (!a || !c) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#8B8FF5" strokeWidth={1.2} opacity={0.4} />;
            })}

            {/* theme nodes */}
            {projection.nodes.map((n) => {
              const isHover = hover === n.id;
              const accel = n.momentum === "accelerating" && n.state !== "fading";
              const pulse = accel ? 1 + 0.12 * breathe : 1;            // breathing on hot nodes
              const glow = n.flag === "escalating" ? "#E0A642" : n.flag === "reconsider" ? "#E0A642" : isHover ? "#FFFFFF" : null;
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "pointer" }}
                   onClick={() => router.push(n.href)}
                   onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                  {accel && <circle r={n.r * pulse + 5} fill="none" stroke={themeFill(n)} strokeWidth={1} opacity={0.18 + 0.22 * (1 - breathe)} />}
                  <circle r={n.r * pulse} fill={themeFill(n)} opacity={themeOpacity(n)}
                    stroke={glow ?? "none"} strokeWidth={glow ? (n.flag ? 2.5 : 1.5) : 0} />
                  {n.contraCount > 0 && <circle r={3.5} cx={n.r * 0.7} cy={-n.r * 0.7} fill="#FF5C5C" />}
                  <text x={0} y={n.r + 12} fontSize={isHover ? 11 : 9.5} fontWeight={isHover ? 600 : 400} fill={isHover ? "#E8EAF0" : "#9BA3B8"} textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {n.title.length > 22 ? n.title.slice(0, 22) + "…" : n.title}
                  </text>
                </g>
              );
            })}

            <rect x={0} y={0} width={W} height={H} fill="url(#vignette)" style={{ pointerEvents: "none" }} />
          </svg>

          {/* legend */}
          <div className="row gap-2" style={{ padding: "10px 14px", borderTop: "1px solid #1A2030", flexWrap: "wrap", background: "#0E121A" }}>
            <span style={{ color: "#5E8AFF", fontSize: 12, fontWeight: 600 }}>● product</span>
            <span style={{ color: "#8B8FF5", fontSize: 12, fontWeight: 600 }}>● gtm</span>
            <span style={{ color: "#7A8499", fontSize: 11.5 }}>elevation = confidence × momentum concentration · size = confidence · lane = momentum · <span style={{ color: "#FF5C5C" }}>●</span> contradicted · pulse = accelerating</span>
          </div>
        </div>
      )}
    </div>
  );
}
