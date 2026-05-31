// Terrain — turn positioned intelligence into a topographic elevation field.
// High ground = where high-confidence, accelerating intelligence concentrates.
// Depressions/rifts = contested ground (contradictions) and thin evidence.
// We compute a scalar field over a coarse grid (gaussian bumps per node), then
// extract iso-contours via marching squares — crisp topo lines, the futuristic
// "map you're fighting on" look. Pure math; rendered by MapView.

export type FieldNode = { x: number; y: number; conf: number; momentum: string | null; contra: number };

export type Contour = { level: number; paths: string[] }; // SVG path 'd' strings per iso-level

type Grid = { vals: number[]; cols: number; rows: number; cell: number; x0: number; y0: number };

// Build the elevation grid. Each node deposits a gaussian bump: amplitude scales
// with confidence and gets a lift for accelerating momentum; contradictions
// carve the value down (rifts). Sampled on a grid for speed.
export function elevationField(nodes: FieldNode[], W: number, H: number, cell = 16): Grid {
  const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
  const vals = new Float64Array(cols * rows) as unknown as number[];
  const sigma = 70;              // bump spread (px)
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (const n of nodes) {
    const lift = n.momentum === "accelerating" ? 1.25 : n.momentum === "fading" ? 0.55 : 1;
    const amp = Math.max(0.05, n.conf) * lift;
    const dip = n.contra * 0.5;  // contradiction carves the local field
    // only touch cells within ~3 sigma for speed
    const ci = Math.round((n.x) / cell), cj = Math.round((n.y) / cell);
    const span = Math.ceil((3 * sigma) / cell);
    for (let j = Math.max(0, cj - span); j < Math.min(rows, cj + span); j++) {
      for (let i = Math.max(0, ci - span); i < Math.min(cols, ci + span); i++) {
        const dx = i * cell - n.x, dy = j * cell - n.y;
        const g = Math.exp(-(dx * dx + dy * dy) * inv2s2);
        vals[j * cols + i] += amp * g - dip * g;
      }
    }
  }
  return { vals: vals as unknown as number[], cols, rows, cell, x0: 0, y0: 0 };
}

// Marching squares: extract iso-line segments at `level`, return SVG path strings.
function isoPaths(grid: Grid, level: number): string[] {
  const { vals, cols, rows, cell } = grid;
  const segs: string[] = [];
  const v = (i: number, j: number) => vals[j * cols + i];
  const interp = (x1: number, y1: number, v1: number, x2: number, y2: number, v2: number) => {
    const t = (level - v1) / (v2 - v1 || 1e-6);
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] as const;
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const x = i * cell, y = j * cell;
      const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
      let idx = 0;
      if (tl > level) idx |= 8;
      if (tr > level) idx |= 4;
      if (br > level) idx |= 2;
      if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      // edge midpoints (interpolated)
      const T = () => interp(x, y, tl, x + cell, y, tr);
      const R = () => interp(x + cell, y, tr, x + cell, y + cell, br);
      const B = () => interp(x, y + cell, bl, x + cell, y + cell, br);
      const L = () => interp(x, y, tl, x, y + cell, bl);
      const line = (p: readonly [number, number], q: readonly [number, number]) =>
        segs.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
      switch (idx) {
        case 1: case 14: line(L(), B()); break;
        case 2: case 13: line(B(), R()); break;
        case 3: case 12: line(L(), R()); break;
        case 4: case 11: line(T(), R()); break;
        case 5: line(L(), T()); line(B(), R()); break;
        case 6: case 9: line(T(), B()); break;
        case 7: case 8: line(L(), T()); break;
        case 10: line(L(), B()); line(T(), R()); break;
      }
    }
  }
  return segs;
}

// Extract N contour levels between a low floor and the field max.
export function contours(grid: Grid, levels = 6): Contour[] {
  let max = 0;
  for (const x of grid.vals) if (x > max) max = x;
  if (max <= 0) return [];
  const out: Contour[] = [];
  for (let k = 1; k <= levels; k++) {
    const level = (k / (levels + 1)) * max;
    out.push({ level: k / (levels + 1), paths: isoPaths(grid, level) });
  }
  return out;
}
