"use client";

// Competitive momentum grid — a G2-style quadrant: feature coverage (how much of
// the capability surface they cover) × momentum (recent competitive activity).
// Plots each competitor + "Us" so a platform play is visible at a glance:
// top-right = Leaders, top-left = Risers, bottom-right = Established, bottom-left
// = Niche. Light, on-system; complements the precise matrix.
type Competitor = { id: string; name: string; relationship: string };
type Capability = { id: string };
type Score = { capability_id: string; competitor_id: string | null; score: number };
type Sig = { title: string; why: string | null };

const W = 720, H = 460, PAD = 54;

export default function CompetitiveGrid({ competitors, capabilities, scores, compSignals }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Sig[];
}) {
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
  const coverage = (compId: string | null) => capabilities.length ? capabilities.reduce((a, c) => a + scoreOf(c.id, compId), 0) / (capabilities.length * 3) : 0;
  const momentumOf = (name: string) => Math.min(1, compSignals.filter((s) => (s.title + " " + (s.why ?? "")).toLowerCase().includes(name.toLowerCase())).length / 3);

  const pts = [
    { id: "us", name: "Us", cov: coverage(null), mom: 0.85, kind: "us" as const },
    ...competitors.map((c) => ({ id: c.id, name: c.name, cov: coverage(c.id), mom: momentumOf(c.name), kind: c.relationship === "direct" ? ("direct" as const) : ("adjacent" as const) })),
  ];
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const px = (cov: number) => PAD + cov * innerW;
  const py = (mom: number) => PAD + (1 - mom) * innerH;
  const fill = (k: string) => (k === "us" ? "#4F46E5" : k === "direct" ? "#7C3AED" : "#94A3B8");
  const QUAD: [number, number, string][] = [[0.5, 0.0, "Risers"], [1.0, 0.0, "Leaders"], [0.5, 1.0, "Niche"], [1.0, 1.0, "Established"]];

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        <defs>
          <radialGradient id="cg" cx="78%" cy="22%" r="80%"><stop offset="0%" stopColor="#16A34A" stopOpacity="0.06" /><stop offset="60%" stopColor="#fff" stopOpacity="0" /></radialGradient>
        </defs>
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="url(#cg)" />
        {/* quadrant guides */}
        <line x1={PAD + innerW / 2} y1={PAD} x2={PAD + innerW / 2} y2={PAD + innerH} stroke="#E6E8EE" strokeWidth={1} strokeDasharray="4 4" />
        <line x1={PAD} y1={PAD + innerH / 2} x2={PAD + innerW} y2={PAD + innerH / 2} stroke="#E6E8EE" strokeWidth={1} strokeDasharray="4 4" />
        {/* quadrant labels */}
        {QUAD.map(([fx, fy, label]) => (
          <text key={label} x={PAD + fx * innerW - (fx === 1 ? 10 : 0) + (fx === 0.5 ? 10 : -10)} y={PAD + fy * innerH + (fy === 0 ? 20 : -10)} fontSize={11} fontWeight={700} fill="#C2C6CF" textAnchor={fx === 1 ? "end" : "start"} letterSpacing="0.04em">{label.toUpperCase()}</text>
        ))}
        {/* axes */}
        <text x={PAD + innerW / 2} y={H - 14} fontSize={11} fontWeight={600} fill="#8B8E97" textAnchor="middle" letterSpacing="0.04em">FEATURE COVERAGE →</text>
        <text x={16} y={PAD + innerH / 2} fontSize={11} fontWeight={600} fill="#8B8E97" textAnchor="middle" letterSpacing="0.04em" transform={`rotate(-90 16 ${PAD + innerH / 2})`}>MOMENTUM →</text>
        {/* points */}
        {pts.map((p) => {
          const x = px(p.cov), y = py(p.mom), r = p.kind === "us" ? 11 : 9;
          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r={r + 3} fill="#fff" opacity={0.92} />
              <circle cx={x} cy={y} r={r} fill={fill(p.kind)} opacity={p.kind === "adjacent" ? 0.8 : 1} stroke={p.kind === "us" ? "#312E81" : "#fff"} strokeWidth={p.kind === "us" ? 2 : 1.5} />
              <text x={x} y={y + r + 13} fontSize={p.kind === "us" ? 12 : 11} fontWeight={p.kind === "us" ? 700 : 560} fill={p.kind === "us" ? "#312E81" : "#5A5E68"} textAnchor="middle">{p.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="row gap-2" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap", background: "var(--panel)" }}>
        <span style={{ color: "#4F46E5", fontSize: 12, fontWeight: 700 }}>● us</span>
        <span style={{ color: "#7C3AED", fontSize: 12, fontWeight: 600 }}>● direct</span>
        <span style={{ color: "#94A3B8", fontSize: 12, fontWeight: 600 }}>● adjacent</span>
        <span style={{ color: "var(--tm)", fontSize: 11.5 }}>coverage = avg capability score · momentum = recent competitive activity · top-right = leaders</span>
      </div>
    </div>
  );
}
