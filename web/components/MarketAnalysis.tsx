"use client";

// Market analysis — the quadrant view of the competitive landscape, computed
// LIVE from the evidence loop (never hand-placed):
//   X · Product capability — mean capability-matrix score (0..3 → 0..1). Cells
//       scored from evidence (✦, ratified through the gate) count full weight;
//       hand-set cells count too but the panel shows exactly which is which.
//   Y · GTM momentum — recent GTM signal velocity (60d) blended with the
//       confidence of the rival's GTM themes.
// Click a placement for its WORK: every capability score (with provenance +
// rationale), the GTM themes, and the recent signals behind the axes. The
// agents feed this surface through the loop (pulls → synthesis → scores →
// review); this view just refuses to show a number it can't substantiate.
import { useMemo, useState } from "react";
import { Chip, Confidence } from "@/components/ui";

type Competitor = { id: string; name: string; relationship: string };
type Capability = { id: string; name: string };
type Score = { capability_id: string; competitor_id: string | null; score: number; scored_by: string | null; rationale?: string | null; evidence_at: string | null };
type Sig = { id: string; title: string; observed_at: string | null; category?: string | null; competitor_id?: string | null; metadata: { competitor_id?: string } | null };
type Theme = { id: string; title: string; category: string; competitor_id: string | null; conf_level: number | null; state: string };

const sigComp = (s: Sig) => s.competitor_id ?? s.metadata?.competitor_id ?? null;

export default function MarketAnalysis({ competitors, capabilities, scores, compSignals, themes }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Sig[]; themes: Theme[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const model = useMemo(() => {
    const cutoff = Date.now() - 60 * 86400_000;
    const perComp = competitors.map((c) => {
      const cells = scores.filter((s) => s.competitor_id === c.id);
      const rated = cells.filter((s) => s.score > 0 || s.scored_by);
      const prod = capabilities.length ? cells.reduce((a, s) => a + s.score, 0) / (capabilities.length * 3) : 0;
      const evidenced = cells.filter((s) => s.scored_by).length;
      const gtmThemes = themes.filter((t) => t.competitor_id === c.id && t.category === "gtm" && t.state !== "fading");
      const themeConf = gtmThemes.length ? gtmThemes.reduce((a, t) => a + (t.conf_level ?? 0), 0) / gtmThemes.length : 0;
      const recentGtm = compSignals.filter((s) => sigComp(s) === c.id && s.observed_at && new Date(s.observed_at).getTime() > cutoff && (s.category === "gtm" || s.category === "both" || !s.category));
      return { c, prod, evidenced, ratedCount: rated.length, cells, gtmThemes, recentGtm, themeConf };
    });
    const maxSig = Math.max(1, ...perComp.map((p) => p.recentGtm.length));
    const placed = perComp.map((p) => ({ ...p, gtm: 0.5 * (p.recentGtm.length / maxSig) + 0.5 * p.themeConf }));
    const usCells = scores.filter((s) => s.competitor_id === null);
    const usProd = capabilities.length ? usCells.reduce((a, s) => a + s.score, 0) / (capabilities.length * 3) : 0;
    return { placed, usProd };
  }, [competitors, capabilities, scores, compSignals, themes]);

  const open = model.placed.find((p) => p.c.id === openId) ?? null;
  const W = 640, H = 380, PAD = 44;
  const px = (x: number) => PAD + x * (W - PAD * 2);
  const py = (y: number) => H - PAD - y * (H - PAD * 2);
  const capName = (id: string) => capabilities.find((k) => k.id === id)?.name ?? "Capability";
  const LV = ["—", "Partial", "Good", "Strong"];

  if (competitors.length === 0 || capabilities.length === 0) {
    return <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The quadrant plots competitors against the capability matrix and their GTM evidence. Run the guided setup (Dashboard) to stand both up — placements appear as evidence lands.</div>;
  }

  return (
    <div className="stack-3">
      <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
        Computed live from the evidence — never hand-placed. <b>X</b>: product capability (matrix, ✦ = evidence-scored). <b>Y</b>: GTM momentum (signals · 60d + theme confidence). Click a player for the work behind its position.
      </div>
      <div className="card card-pad" style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 760, display: "block", margin: "0 auto" }}>
          {/* quadrant frame */}
          <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} fill="var(--panel-2)" stroke="var(--border)" rx={8} />
          <line x1={W / 2} y1={PAD} x2={W / 2} y2={H - PAD} stroke="var(--border)" strokeDasharray="4 4" />
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="var(--border)" strokeDasharray="4 4" />
          <text x={W - PAD - 4} y={PAD + 14} fontSize={10} fill="var(--tm, #A6A9B2)" textAnchor="end" fontWeight={700}>LEADERS</text>
          <text x={PAD + 4} y={PAD + 14} fontSize={10} fill="var(--tm, #A6A9B2)" fontWeight={600}>LOUD, THIN PRODUCT</text>
          <text x={W - PAD - 4} y={H - PAD - 6} fontSize={10} fill="var(--tm, #A6A9B2)" textAnchor="end" fontWeight={600}>STRONG, QUIET</text>
          <text x={PAD + 4} y={H - PAD - 6} fontSize={10} fill="var(--tm, #A6A9B2)" fontWeight={600}>NICHE</text>
          <text x={W / 2} y={H - 8} fontSize={10.5} fill="var(--tm, #A6A9B2)" textAnchor="middle">Product capability →</text>
          <text x={12} y={H / 2} fontSize={10.5} fill="var(--tm, #A6A9B2)" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>GTM momentum →</text>

          {/* us — reference line on the product axis */}
          <line x1={px(model.usProd)} y1={PAD} x2={px(model.usProd)} y2={H - PAD} stroke="var(--ac, #4F46E5)" strokeWidth={1.4} strokeDasharray="2 3" opacity={0.7} />
          <text x={px(model.usProd)} y={PAD - 6} fontSize={10} fill="var(--ac, #4F46E5)" textAnchor="middle" fontWeight={700}>us</text>

          {/* competitor placements */}
          {model.placed.map((p) => {
            const r = 8 + Math.min(10, (p.recentGtm.length + p.evidenced));
            const on = openId === p.c.id;
            return (
              <g key={p.c.id} transform={`translate(${px(p.prod)},${py(p.gtm)})`} style={{ cursor: "pointer" }} onClick={() => setOpenId(on ? null : p.c.id)}>
                <circle r={r} fill={p.c.relationship === "direct" ? "#4F46E5" : "#A78BFA"} opacity={on ? 0.95 : 0.75} stroke={on ? "var(--tp, #1B1D22)" : "none"} strokeWidth={1.5} />
                <text y={-r - 5} fontSize={11} fontWeight={640} fill="var(--tp, #1B1D22)" textAnchor="middle">{p.c.name}</text>
                {p.evidenced > 0 && <text y={3.5} fontSize={9} fill="#fff" textAnchor="middle" fontWeight={700}>✦</text>}
              </g>
            );
          })}
        </svg>
        <div className="row gap-2" style={{ justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
          <span className="t-mono-xs"><span style={{ color: "#4F46E5" }}>●</span> direct</span>
          <span className="t-mono-xs"><span style={{ color: "#A78BFA" }}>●</span> adjacent</span>
          <span className="t-mono-xs">size = evidence volume</span>
          <span className="t-mono-xs">✦ = has evidence-scored cells</span>
        </div>
      </div>

      {open && (
        <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 14.5, fontWeight: 680 }}>{open.c.name} — the work behind the position</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(null)}>Close</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            <div>
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Product axis · {(open.prod * 100).toFixed(0)}% <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— {open.evidenced} of {capabilities.length} cells evidence-scored</span></div>
              <div className="stack-2">
                {open.cells.filter((s) => s.score > 0 || s.scored_by).map((s, i) => (
                  <div key={i} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
                    <div className="row-between" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 620 }}>{capName(s.capability_id)}</span>
                      <Chip tone={s.scored_by ? "accent" : "default"}>{LV[s.score]}{s.scored_by ? " ✦" : ""}</Chip>
                    </div>
                    <div className="t-mono-xs t-muted" style={{ marginTop: 2 }}>{s.scored_by ? `✦ ${s.scored_by}${s.evidence_at ? ` · ${new Date(s.evidence_at).toLocaleDateString()}` : ""}` : "set by hand — run ✦ Score from evidence to substantiate"}</div>
                  </div>
                ))}
                {open.cells.filter((s) => s.score > 0 || s.scored_by).length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No rated cells yet — pull their sources, then ✦ Score from evidence.</div>}
              </div>
            </div>
            <div>
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>GTM axis · {(open.gtm * 100).toFixed(0)}% <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— {open.recentGtm.length} signals · 60d, {open.gtmThemes.length} theme{open.gtmThemes.length === 1 ? "" : "s"}</span></div>
              <div className="stack-2">
                {open.gtmThemes.map((t) => (
                  <div key={t.id} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
                    <div className="row-between" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 620 }}>{t.title}</span>
                      <Confidence label={null} level={t.conf_level} />
                    </div>
                  </div>
                ))}
                {open.recentGtm.slice(0, 5).map((s) => (
                  <div key={s.id} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px", borderLeft: "2px solid var(--vl)", fontSize: 12 }}>{s.title}</div>
                ))}
                {open.gtmThemes.length === 0 && open.recentGtm.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No GTM evidence yet — their press/LinkedIn monitors will feed this.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
