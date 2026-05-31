// Curated projection engine. Position is MEANING: each named View is a fixed,
// opinionated mapping from a theme's attributes to (x,y) on a labelled surface.
// No freeform axis-picker — a few deliberate Views, each answering one question.
// Signals are collapsed into their theme at this altitude; bridges render as
// edges between theme positions; contradiction shows as a node marker.

export type PTheme = {
  id: string; title: string; lens: "product" | "gtm" | null;
  conf: number; momentum: string | null; state: string | null;
  horizon?: string | null; owner?: string | null;
  signalCount: number; contraCount: number; flag?: string | null; href: string;
};
export type PBridgeEdge = { source: string; target: string; conf: number };

export type Positioned = PTheme & { x: number; y: number; r: number };
export type Lane = { y0: number; y1: number; label: string; tone?: "hot" | "warm" | "cool" };
export type ColLabel = { x: number; label: string };
export type Projection = {
  nodes: Positioned[];
  lanes: Lane[];          // horizontal bands with meaning
  xAxisLabel: string;
  colLabels: ColLabel[];  // markers along the x axis
};

export type ViewKey = "action";
export const VIEWS: { key: ViewKey; label: string; question: string }[] = [
  { key: "action", label: "Action Matrix", question: "What do I act on now?" },
];

const radius = (conf: number) => 9 + Math.max(0, Math.min(1, conf)) * 9;

// Resolve overlaps WITHIN a lane without moving nodes off their meaningful x
// (confidence is the message — we must not distort it). Iterative relaxation:
// nudge overlapping pairs mostly on Y (cheap, preserves x), with a tiny X give
// only when two nodes are nearly coincident. Clamp to the lane band. Converges
// fast at this scale and leaves the surface readable ("works well").
const LABEL_PAD = 6;
function despread(nodes: Positioned[], lanes: Lane[]) {
  const laneFor = (n: Positioned) => lanes.find((l) => n.y >= l.y0 && n.y < l.y1) ?? lanes[lanes.length - 1];
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const la = laneFor(a), lb = laneFor(b);
        if (la !== lb) continue; // only resolve within a momentum lane
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist = a.r + b.r + LABEL_PAD;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          // direction: mostly vertical (preserve x/confidence); small x give if nearly stacked
          let ux = dx / dist, uy = dy / dist;
          if (Math.abs(uy) < 0.2) { uy = uy >= 0 ? 0.2 : -0.2; } // avoid pure-horizontal push
          ux *= 0.25; // dampen horizontal so confidence barely shifts
          const k = overlap;
          a.x -= ux * k; a.y -= uy * k;
          b.x += ux * k; b.y += uy * k;
          moved = true;
        }
      }
    }
    // clamp into lane band
    for (const n of nodes) {
      const l = laneFor(n);
      n.y = Math.max(l.y0 + n.r + 2, Math.min(l.y1 - n.r - 12, n.y)); // -12 leaves room for the label
    }
    if (!moved) break;
  }
}

// ACTION MATRIX — X = honest confidence, Y = momentum lane.
// Accelerating (top) · Steady (mid) · Fading (bottom). Within the accelerating
// lane, right = high confidence = ACT NOW; left = low conf = watch. Fading +
// high conf (bottom right) = "yesterday's truth — revisit".
export function projectActionMatrix(themes: PTheme[], W: number, H: number, pad = 56): Projection {
  const innerW = W - pad * 2, innerH = H - pad * 2;
  const laneH = innerH / 3;
  const lanes: Lane[] = [
    { y0: pad, y1: pad + laneH, label: "Accelerating", tone: "hot" },
    { y0: pad + laneH, y1: pad + laneH * 2, label: "Steady", tone: "warm" },
    { y0: pad + laneH * 2, y1: pad + innerH, label: "Fading", tone: "cool" },
  ];
  const laneOf = (m: string | null) => m === "accelerating" ? lanes[0] : m === "fading" ? lanes[2] : lanes[1];

  const nodes: Positioned[] = themes.map((t) => {
    const lane = laneOf(t.momentum);
    const conf = Math.max(0, Math.min(1, t.conf));
    return {
      ...t,
      r: radius(conf),
      x: pad + conf * innerW,
      y: (lane.y0 + lane.y1) / 2 + (Math.random() - 0.5) * (laneH * 0.4),
    };
  });
  despread(nodes, lanes);

  return {
    nodes,
    lanes,
    xAxisLabel: "Confidence  (low → high)",
    colLabels: [
      { x: pad + innerW * 0.12, label: "Watch" },
      { x: pad + innerW * 0.85, label: "Act now" },
    ],
  };
}
