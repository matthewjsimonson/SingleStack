"use client";

// The Intelligence Map — a SEMANTIC strategy surface. Position is meaning: a
// curated View maps each theme's attributes to a labelled position. No freeform
// axis-picker — you pick a View, each answering one question. (Action Matrix
// first; more Views as dimensions populate.) Signals collapse into their theme
// here; contradiction shows as a marker. Click a node to
// drill in. Battle-tested to stay legible from a handful to ~50 themes.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Banner, Spinner } from "@/components/ui";
import { projectActionMatrix, VIEWS, type ViewKey, type PTheme } from "@/lib/projections";

const W = 1000, H = 600, PAD = 56;

// Light surface — consistent with the rest of the product. The terrain sits
// softly on the app canvas; nodes use the product's indigo (product) / violet
// (gtm) accents rather than a dark "tactical" look.
const BG = "#F7F8FA";
const themeFill = (t: PTheme) => (t.lens === "gtm" ? "#7C3AED" : "#4F46E5");
const themeOpacity = (t: PTheme) => (t.state === "fading" ? 0.5 : t.state === "dormant" ? 0.32 : t.state === "escalating" ? 1 : 0.9);

export default function MapView({ productFilter = "all", onOpenTheme }: { productFilter?: string; onOpenTheme?: (id: string) => void }) {
  const supabase = createClient();
  const router = useRouter();
  const [themes, setThemes] = useState<PTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("action");
  const [hover, setHover] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: ths }, { data: strength }, { data: tsig }, { data: misses }] = await Promise.all([
      supabase.from("signal_themes").select("id, title, category, state, momentum, horizon, owner_team, product_id, conf_level").neq("state", "dormant"),
      supabase.from("theme_evidence_strength").select("theme_id, honest_conf, contra_signals"),
      supabase.from("theme_signals").select("theme_id, stance"),
      supabase.from("theme_misses").select("theme_id"),
    ]);
    const confBy: Record<string, number> = {}, contraBy: Record<string, number> = {};
    for (const s of strength ?? []) { confBy[s.theme_id] = s.honest_conf ?? 0; contraBy[s.theme_id] = s.contra_signals ?? 0; }
    const sigCount: Record<string, number> = {};
    for (const t of tsig ?? []) sigCount[t.theme_id] = (sigCount[t.theme_id] ?? 0) + 1;
    const missSet = new Set((misses ?? []).map((m) => m.theme_id));

    const scoped = (ths ?? []).filter((t) =>
      productFilter === "all" ? true : productFilter === "company" ? !t.product_id : t.product_id === productFilter);
    const list: PTheme[] = scoped.map((t) => ({
      id: t.id, title: t.title, lens: t.category as "product" | "gtm", conf: confBy[t.id] || (t.conf_level ?? 0),
      momentum: t.momentum, state: t.state, horizon: t.horizon, owner: t.owner_team,
      signalCount: sigCount[t.id] ?? 0, contraCount: contraBy[t.id] ?? 0,
      flag: t.state === "escalating" ? "escalating" : missSet.has(t.id) ? "reconsider" : null,
      href: `/signals/themes/${t.id}`,
    }));
    setThemes(list);
    setLoading(false);
  }, [supabase, productFilter]);
  useEffect(() => { load(); }, [load]);

  const projection = useMemo(() => projectActionMatrix(themes, W, H, PAD), [themes]);
  const posById = useMemo(() => new Map(projection.nodes.map((n) => [n.id, n])), [projection]);

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
              <radialGradient id="bgGrad" cx="50%" cy="38%" r="80%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#EEF0F4" />
              </radialGradient>
            </defs>

            {/* soft canvas — gentle depth instead of a flat field */}
            <rect x={0} y={0} width={W} height={H} fill="url(#bgGrad)" />

            {/* momentum lanes, tinted live: accelerating = warm, fading = cool */}
            {projection.lanes.map((l, i) => {
              const h = (projection.lanes[i + 1]?.y0 ?? H) - l.y0;
              const tint = l.tone === "hot" ? "var(--am-text)" : l.tone === "cool" ? "#6366F1" : "#94A3B8";
              const op = l.tone === "hot" ? 0.07 : l.tone === "cool" ? 0.05 : 0.025;
              return <rect key={`band${i}`} x={0} y={l.y0} width={W} height={h} fill={tint} opacity={op} />;
            })}
            {/* "Act now" zone — high-confidence right edge glows faintly */}
            <rect x={PAD + (W - PAD * 2) * 0.66} y={PAD - 6} width={(W - PAD * 2) * 0.34 + 6} height={H - PAD * 2 + 12} fill="var(--gn)" opacity={0.05} />
            {projection.lanes.map((l, i) => i === 0 ? null : (
              <line key={i} x1={PAD} y1={l.y0} x2={W - PAD} y2={l.y0} stroke="#E6E8EE" strokeWidth={1} />
            ))}
            {projection.lanes.map((l, i) => (
              <text key={`lbl${i}`} x={PAD + 6} y={l.y0 + 16} fontSize={11} fontWeight={600} fill="#8B8E97" letterSpacing="0.04em">{l.label.toUpperCase()}</text>
            ))}
            {projection.colLabels.map((c, i) => (
              <text key={`c${i}`} x={c.x} y={H - 16} fontSize={11} fontWeight={600} fill="#8B8E97" textAnchor="middle" letterSpacing="0.04em">{c.label.toUpperCase()}</text>
            ))}
            <text x={W / 2} y={H - 3} fontSize={10} fill="#A6A9B2" textAnchor="middle">{projection.xAxisLabel}</text>

            {/* theme nodes */}
            {projection.nodes.map((n) => {
              const isHover = hover === n.id;
              const accel = n.momentum === "accelerating" && n.state !== "fading";
              const pulse = accel ? 1 + 0.12 * breathe : 1;            // breathing on hot nodes
              const glow = n.flag === "escalating" ? "var(--am-text)" : n.flag === "reconsider" ? "var(--am-text)" : isHover ? "#4F46E5" : null;
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "pointer" }}
                   onClick={() => (onOpenTheme ? onOpenTheme(n.id) : router.push(n.href))}
                   onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}>
                  {accel && <circle r={n.r * pulse + 6} fill="none" stroke={themeFill(n)} strokeWidth={1.2} opacity={0.16 + 0.2 * (1 - breathe)} />}
                  {/* white halo so nodes read cleanly on the light canvas */}
                  <circle r={n.r * pulse + 3} fill="#FFFFFF" opacity={0.92} />
                  <circle r={n.r * pulse} fill={themeFill(n)} opacity={themeOpacity(n)}
                    stroke={glow ?? "#FFFFFF"} strokeWidth={glow ? (n.flag ? 2.5 : 2) : 1.5} />
                  {isHover && <circle r={n.r * pulse + 3} fill="none" stroke={themeFill(n)} strokeWidth={1.5} opacity={0.5} />}
                  {n.contraCount > 0 && <circle r={3.5} cx={n.r * 0.7} cy={-n.r * 0.7} fill="var(--rd-text)" stroke="#fff" strokeWidth={1} />}
                  <text x={0} y={n.r + 13} fontSize={isHover ? 11.5 : 10} fontWeight={isHover ? 680 : 560} fill={isHover ? "#131417" : "#5A5E68"} textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {n.title.length > 24 ? n.title.slice(0, 24) + "…" : n.title}
                  </text>
                </g>
              );
            })}

          </svg>

          {/* legend */}
          <div className="row gap-2" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap", background: "var(--panel)" }}>
            <span style={{ color: "#4F46E5", fontSize: 12, fontWeight: 600 }}>● product</span>
            <span style={{ color: "#7C3AED", fontSize: 12, fontWeight: 600 }}>● gtm</span>
            <span style={{ color: "var(--tm)", fontSize: 11.5 }}>size = confidence · lane = momentum · position = action priority · <span style={{ color: "var(--rd-text)" }}>●</span> contradicted · pulse = accelerating · click a node to open it</span>
          </div>
        </div>
      )}
    </div>
  );
}
