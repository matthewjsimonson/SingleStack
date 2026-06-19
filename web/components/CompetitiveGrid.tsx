"use client";

// Competitive momentum grid — coverage (evidence-backed capability scores) ×
// momentum (recent signals on the rival, 60d). HONEST BY CONSTRUCTION:
//   • a player with no rated cells AND no recent signals isn't plotted —
//     no data means no dot, never a pile at the origin;
//   • nothing at all to plot → a quiet empty hint, not an empty chart;
//   • "Us" appears as a reference line at our coverage (we don't fake our own
//     momentum from competitive signals);
//   • momentum counts signals actually LINKED to the rival (competitor_id),
//     not name-substring matches.
// Dot size = evidence volume. Click a dot for the work behind the position.
type Competitor = { id: string; name: string; relationship: string };
type Capability = { id: string };
type Score = { capability_id: string; competitor_id: string | null; score: number; scored_by?: string | null };
type Sig = { observed_at?: string | null; competitor_id?: string | null; metadata?: { competitor_id?: string } | null };

const W = 720, H = 440, PAD = 56;

export default function CompetitiveGrid({ competitors, capabilities, scores, compSignals, onOpenCompetitor }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Sig[]; onOpenCompetitor?: (id: string) => void;
}) {
  const sigComp = (s: Sig) => s.competitor_id ?? s.metadata?.competitor_id ?? null;
  const cutoff = Date.now() - 60 * 86400_000;
  const recentOf = (compId: string) => compSignals.filter((s) => sigComp(s) === compId && s.observed_at && new Date(s.observed_at).getTime() > cutoff).length;
  const cellsOf = (compId: string | null) => scores.filter((s) => s.competitor_id === compId && s.score > 0);
  const coverage = (compId: string | null) => capabilities.length ? cellsOf(compId).reduce((a, s) => a + s.score, 0) / (capabilities.length * 3) : 0;

  // Only players with actual evidence get a dot.
  const withData = competitors.map((c) => {
    const cells = cellsOf(c.id);
    const recent = recentOf(c.id);
    return { c, cov: coverage(c.id), mom: 0, cells: cells.length, recent, evidenced: cells.some((s) => s.scored_by) };
  }).filter((p) => p.cells > 0 || p.recent > 0);
  const maxRecent = Math.max(1, ...withData.map((p) => p.recent));
  const pts = withData.map((p) => ({ ...p, mom: p.recent / maxRecent }));
  const usCov = coverage(null);

  if (pts.length === 0 && usCov === 0) {
    return (
      <div className="card card-pad" style={{ maxWidth: 600, margin: "0 auto", border: "1px dashed var(--border)", textAlign: "center" }}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          The grid draws itself from evidence — nothing is plotted until it exists.<br />
          Rate capabilities (or run <b>✦ Score from evidence</b>) and let the monitors pull signals; players appear as their data does.
        </div>
      </div>
    );
  }

  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const px = (v: number) => PAD + Math.min(1, Math.max(0, v)) * innerW;
  const py = (v: number) => PAD + (1 - Math.min(1, Math.max(0, v))) * innerH;
  const QUADS: [number, number, string][] = [[0, 0, "RISERS"], [1, 0, "LEADERS"], [0, 1, "NICHE"], [1, 1, "ESTABLISHED"]];

  return (
    <div className="card" style={{ overflow: "hidden", maxWidth: 640, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", maxHeight: 380, background: "var(--panel)" }} preserveAspectRatio="xMidYMid meet">
        {/* quadrant tints — barely-there, leaders corner warmest */}
        <rect x={PAD + innerW / 2} y={PAD} width={innerW / 2} height={innerH / 2} fill="var(--gn-bg, var(--gn))" opacity={0.05} />
        <rect x={PAD} y={PAD} width={innerW / 2} height={innerH / 2} fill="var(--am-bg, var(--am-text))" opacity={0.03} />
        {/* frame + midlines */}
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="none" stroke="var(--border, #E6E8EE)" rx={10} />
        <line x1={PAD + innerW / 2} y1={PAD + 8} x2={PAD + innerW / 2} y2={PAD + innerH - 8} stroke="var(--border, #E6E8EE)" strokeDasharray="3 5" />
        <line x1={PAD + 8} y1={PAD + innerH / 2} x2={PAD + innerW - 8} y2={PAD + innerH / 2} stroke="var(--border, #E6E8EE)" strokeDasharray="3 5" />
        {/* quadrant labels — tucked into corners */}
        {QUADS.map(([fx, fy, label]) => (
          <text key={label} x={fx === 0 ? PAD + 12 : PAD + innerW - 12} y={fy === 0 ? PAD + 18 : PAD + innerH - 10}
            fontSize={10} fontWeight={700} fill="var(--tm, #A6A9B2)" opacity={0.8} textAnchor={fx === 0 ? "start" : "end"} letterSpacing="0.08em">{label}</text>
        ))}
        {/* axes */}
        <text x={PAD + innerW / 2} y={H - 12} fontSize={10.5} fontWeight={600} fill="var(--tm, #8B8E97)" textAnchor="middle" letterSpacing="0.06em">CAPABILITY COVERAGE →</text>
        <text x={18} y={PAD + innerH / 2} fontSize={10.5} fontWeight={600} fill="var(--tm, #8B8E97)" textAnchor="middle" letterSpacing="0.06em" transform={`rotate(-90 18 ${PAD + innerH / 2})`}>SIGNAL MOMENTUM · 60D →</text>

        {/* us — an honest reference line at our coverage, only when we have scores */}
        {usCov > 0 && (
          <g>
            <line x1={px(usCov)} y1={PAD + 6} x2={px(usCov)} y2={PAD + innerH - 6} stroke="var(--ac, #4F46E5)" strokeWidth={1.6} strokeDasharray="2 4" opacity={0.75} />
            <text x={px(usCov)} y={PAD - 8} fontSize={10.5} fontWeight={700} fill="var(--ac-text, #4F46E5)" textAnchor="middle">us · {Math.round(usCov * 100)}%</text>
          </g>
        )}

        {/* players — size = evidence volume, ✦ = has gate-ratified scores */}
        {pts.map((p) => {
          const x = px(p.cov), y = py(p.mom);
          const r = 7 + Math.min(8, Math.round((p.cells + p.recent) / 2));
          const direct = p.c.relationship === "direct";
          const dotColor = direct ? "var(--ac, #4F46E5)" : p.c.relationship === "watching" ? "var(--tm, #94A3B8)" : "var(--vl, #A78BFA)";
          return (
            <g key={p.c.id} style={onOpenCompetitor ? { cursor: "pointer" } : undefined}
               onClick={() => onOpenCompetitor?.(p.c.id)}>
              <title>{`${p.c.name} — ${p.cells} rated cell${p.cells === 1 ? "" : "s"}, ${p.recent} signal${p.recent === 1 ? "" : "s"} · 60d${p.evidenced ? " · ✦ evidence-scored" : ""} — click for the work`}</title>
              <circle cx={x} cy={y} r={r + 4} fill={dotColor} opacity={0.12} />
              <circle cx={x} cy={y} r={r} fill={dotColor} opacity={direct ? 0.92 : 0.8} stroke="var(--panel, #fff)" strokeWidth={1.5} />
              {p.evidenced && <text x={x} y={y + 3.5} fontSize={9} fontWeight={700} fill="#fff" textAnchor="middle">✦</text>}
              <text x={x} y={y + r + 14} fontSize={11} fontWeight={620} fill="var(--ts, #5A5E68)" textAnchor="middle">{p.c.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="row-between" style={{ padding: "9px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
        <span className="row gap-2" style={{ alignItems: "center" }}>
          <span className="t-mono-xs" style={{ color: "var(--ac-text, #4F46E5)", fontWeight: 700 }}>┊ us</span>
          <span className="t-mono-xs" style={{ color: "var(--ac, #4F46E5)", fontWeight: 600 }}>● direct</span>
          <span className="t-mono-xs" style={{ color: "var(--vl, #A78BFA)", fontWeight: 600 }}>● adjacent</span>
          <span className="t-mono-xs" style={{ color: "var(--tm, #94A3B8)", fontWeight: 600 }}>● watching</span>
          <span className="t-mono-xs t-muted">size = evidence · ✦ = ratified scores</span>
        </span>
        <span className="t-mono-xs t-muted">click a player for the work behind its position</span>
      </div>
    </div>
  );
}
