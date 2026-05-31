// A tiny dependency-free force simulation for the Intelligence Map. Repulsion
// (charge) + edge springs + gravity to center. Good for tens–hundreds of nodes.
// Deterministic-ish; runs a fixed number of ticks then settles, and can be
// nudged when a node is dragged.

export type GNode = {
  id: string;
  kind: "signal" | "theme" | "bridge" | "decision" | "build";
  label: string;
  lens?: "product" | "gtm" | null;
  conf?: number | null;        // 0..1 → size/mass
  momentum?: string | null;    // accelerating | steady | fading
  state?: string | null;       // lifecycle → opacity
  href?: string;               // drill-in target
  flag?: string | null;        // commander callout on this node
  // simulation state
  x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null;
};

export type GEdge = {
  source: string;
  target: string;
  kind: "supports" | "contradicts" | "bridge" | "decision" | "build";
};

export function radiusOf(n: GNode): number {
  const base = n.kind === "bridge" ? 11 : n.kind === "theme" ? 9 : n.kind === "decision" ? 8 : n.kind === "build" ? 7 : 4;
  const conf = n.conf == null ? 0.4 : n.conf;
  return base + conf * 8;
}

// Run the simulation in-place for `ticks` steps.
export function simulate(nodes: GNode[], edges: GEdge[], width: number, height: number, ticks = 220) {
  const cx = width / 2, cy = height / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const k = 0.025;            // spring
  const charge = -1100;       // repulsion
  const center = 0.012;       // gravity to center

  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    // repulsion (O(n^2) — fine at this scale)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = (charge * alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    // springs (edges). Contradicting edges want a LONGER rest length (repel apart).
    for (const e of edges) {
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) continue;
      const rest = e.kind === "contradicts" ? 170 : e.kind === "bridge" ? 130 : 90;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = k * (d - rest) * alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    // gravity + integrate
    for (const n of nodes) {
      if (n.fx != null && n.fy != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.vx += (cx - n.x) * center * alpha;
      n.vy += (cy - n.y) * center * alpha;
      n.vx *= 0.85; n.vy *= 0.85;     // damping
      n.x += n.vx; n.y += n.vy;
      // keep in bounds
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    }
  }
}
