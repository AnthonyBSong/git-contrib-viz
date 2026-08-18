import type { ContributionGrid } from "@git-contrib-viz/github-contributions";
import type { Direction } from "@git-contrib-viz/theme";

export type { Direction };

/**
 * What occupies a cell. Deliberately theme-neutral: the grid decides *what kind*
 * of thing is in a cell, and a theme decides what that looks like. A `pellet` is
 * a dot to Pac-Man and a biscuit to the dogs.
 */
export type CellType =
  /** An active contribution day — holds the theme's common collectible. */
  | "pellet"
  /** An active day promoted to the theme's rare collectible, if it has one. */
  | "bonus"
  /** Inactive day the leader walks through. */
  | "floor"
  /** Inactive day enclosed by other inactive days — a maze wall. */
  | "wall";

export interface Cell {
  col: number;
  row: number;
  contributionCount: number;
  cellType: CellType;
}

export interface PathStep {
  col: number;
  row: number;
  direction: Direction;
  /** True when the leader collects something on arriving here. */
  eating: boolean;
}

/** The traversable grid and the route the leader takes through it. */
export interface TraversalGrid {
  cells: Cell[][];
  cols: number;
  rows: number;
  path: PathStep[];
}

/** @deprecated Use {@link TraversalGrid} — the grid is not Pac-Man-specific. */
export type PacmanGrid = TraversalGrid;

export interface GridOptions {
  /**
   * Fraction of active days promoted to the theme's rare collectible, 0–1.
   * Pass 0 — or leave it, for a theme with no bonus item — and no cell becomes a
   * bonus at all. Comes from the theme's `collectibles.bonus.rate`.
   */
  bonusRate?: number;
}

const CARDINAL: { dc: number; dr: number; dir: Direction }[] = [
  { dc: 1, dr: 0, dir: "right" },
  { dc: 0, dr: 1, dir: "down" },
  { dc: -1, dr: 0, dir: "left" },
  { dc: 0, dr: -1, dir: "up" },
];

const MAX_WALL_CLUSTER = 8;

export function buildGrid(
  contributions: ContributionGrid,
  options: GridOptions = {}
): TraversalGrid {
  const rows = 7;
  const cols = contributions.weeks.length;

  const cells: Cell[][] = Array.from({ length: cols }, (_, col) =>
    Array.from({ length: rows }, (_, row) => {
      const count =
        contributions.weeks[col]?.contributionDays[row]?.contributionCount ?? 0;
      return {
        col, row, contributionCount: count,
        cellType: (count > 0 ? "pellet" : "wall") as CellType,
      };
    })
  );

  const activeCells: [number, number][] = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (cells[c][r].cellType === "pellet") activeCells.push([c, r]);

  if (activeCells.length === 0) return { cells, cols, rows, path: [] };

  // ── Step 1: try 6 BFS start points, keep whichever uses fewest corridors ──
  const n = activeCells.length;
  const candidates = Array.from({ length: Math.min(6, n) }, (_, i) =>
    activeCells[Math.round((i / Math.min(6, n)) * (n - 1))]
  );

  let bestCorridors = new Set<string>();
  let bestWallCount = -1;
  for (const [sc, sr] of candidates) {
    const corridors = bfsCorridors(cells, cols, rows, sc, sr);
    const wallCount = cols * rows - n - corridors.size;
    if (wallCount > bestWallCount) { bestWallCount = wallCount; bestCorridors = corridors; }
  }

  for (const key of bestCorridors) {
    const [c, r] = key.split(",").map(Number);
    cells[c][r].cellType = "floor";
  }

  // ── Step 2: cap wall blobs at MAX_WALL_CLUSTER cells ──
  // Prefer to punch holes at blob boundary (adjacent to floor) so the
  // new floor cell is already connected — avoids isolated floor islands.
  breakLargeWallBlobs(cells, cols, rows);

  // ── Step 3: enforce connectivity ──
  const [startC, startR] = findCenter(cells, cols, rows);
  pruneIsolatedFloors(cells, cols, rows, startC, startR);

  // ── Step 4: sprinkle bonus collectibles — a fraction of the active cells,
  // evenly spaced across the grid in scan order. Themes without a bonus item
  // pass no rate and this is a no-op. ──
  sprinkleBonus(cells, cols, rows, options.bonusRate ?? 0);

  return { cells, cols, rows, path: dfsPath(cells, cols, rows, startC, startR) };
}

// ─────────────────────────────────────────────────────────────────────────────

/** BFS through every cell; for each active cell traces the shortest path back
 *  to the root and collects the inactive cells along the way as corridors. */
function bfsCorridors(
  cells: Cell[][], cols: number, rows: number,
  startC: number, startR: number
): Set<string> {
  const parent: ([number, number] | null)[][] =
    Array.from({ length: cols }, () => new Array<[number, number] | null>(rows).fill(null));
  const vis = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));

  vis[startC][startR] = true;
  const q: [number, number][] = [[startC, startR]];
  let qi = 0;
  while (qi < q.length) {
    const [cc, rr] = q[qi++];
    for (const { dc, dr } of CARDINAL) {
      const nc = cc + dc, nr = rr + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !vis[nc][nr]) {
        vis[nc][nr] = true;
        parent[nc][nr] = [cc, rr];
        q.push([nc, nr]);
      }
    }
  }

  const corridors = new Set<string>();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (cells[c][r].cellType !== "pellet") continue;
      let cc = c, rr = r;
      while (parent[cc][rr] !== null) {
        const [pc, pr] = parent[cc][rr]!;
        if (cells[pc][pr].cellType !== "pellet") corridors.add(`${pc},${pr}`);
        cc = pc; rr = pr;
      }
    }
  }
  return corridors;
}

/** Iteratively finds wall blobs larger than MAX_WALL_CLUSTER and promotes one
 *  cell to floor, preferring cells already adjacent to a floor cell so the new
 *  floor is immediately connected (not isolated). Repeats until all blobs fit. */
function breakLargeWallBlobs(cells: Cell[][], cols: number, rows: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    const wallVis = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));

    for (let c0 = 0; c0 < cols; c0++) {
      for (let r0 = 0; r0 < rows; r0++) {
        if (cells[c0][r0].cellType !== "wall" || wallVis[c0][r0]) continue;

        const blob: [number, number][] = [];
        const q: [number, number][] = [[c0, r0]];
        wallVis[c0][r0] = true;
        let qi = 0;
        while (qi < q.length) {
          const [cc, rr] = q[qi++];
          blob.push([cc, rr]);
          for (const { dc, dr } of CARDINAL) {
            const nc = cc + dc, nr = rr + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows &&
                !wallVis[nc][nr] && cells[nc][nr].cellType === "wall") {
              wallVis[nc][nr] = true;
              q.push([nc, nr]);
            }
          }
        }

        if (blob.length <= MAX_WALL_CLUSTER) continue;

        const avgC = blob.reduce((s, [c]) => s + c, 0) / blob.length;
        const avgR = blob.reduce((s, [, r]) => s + r, 0) / blob.length;

        // Prefer a wall cell adjacent to an existing floor cell (already connected)
        const boundary = blob.filter(([cc, rr]) =>
          CARDINAL.some(({ dc, dr }) => {
            const nc = cc + dc, nr = rr + dr;
            return nc >= 0 && nc < cols && nr >= 0 && nr < rows &&
                   cells[nc][nr].cellType === "floor";
          })
        );

        const pool = boundary.length > 0 ? boundary : blob;
        let best = pool[0], bestDist = Infinity;
        for (const cell of pool) {
          const d = (cell[0] - avgC) ** 2 + (cell[1] - avgR) ** 2;
          if (d < bestDist) { bestDist = d; best = cell; }
        }

        cells[best[0]][best[1]].cellType = "floor";
        changed = true;
      }
    }
  }
}

/** BFS from (startC, startR) through non-wall cells; any floor cell that is
 *  not reachable gets reverted to wall. Guarantees DFS never needs to teleport. */
function pruneIsolatedFloors(
  cells: Cell[][], cols: number, rows: number,
  startC: number, startR: number
): void {
  const reachable = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
  const q: [number, number][] = [[startC, startR]];
  reachable[startC][startR] = true;
  let qi = 0;
  while (qi < q.length) {
    const [cc, rr] = q[qi++];
    for (const { dc, dr } of CARDINAL) {
      const nc = cc + dc, nr = rr + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows &&
          !reachable[nc][nr] && cells[nc][nr].cellType !== "wall") {
        reachable[nc][nr] = true;
        q.push([nc, nr]);
      }
    }
  }
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (!reachable[c][r] && cells[c][r].cellType === "floor")
        cells[c][r].cellType = "wall";
}

/** Non-wall cell closest to the grid's center — where the leader starts. */
function findCenter(cells: Cell[][], cols: number, rows: number): [number, number] {
  const cc = cols / 2, cr = rows / 2;
  let bestC = 0, bestR = 0, bestDist = Infinity;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      if (cells[c][r].cellType === "wall") continue;
      const d = Math.abs(c - cc) + Math.abs(r - cr);
      if (d < bestDist) { bestDist = d; bestC = c; bestR = r; }
    }
  return [bestC, bestR];
}

/**
 * Promotes floor(rate × active cells) pellets to the bonus collectible, spaced
 * uniformly through the left-to-right scan order so they appear distributed
 * across the whole chart rather than clustered.
 */
function sprinkleBonus(cells: Cell[][], cols: number, rows: number, rate: number): void {
  if (!(rate > 0)) return;

  const active: [number, number][] = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (cells[c][r].cellType === "pellet") active.push([c, r]);

  const count = Math.floor(active.length * rate);
  if (count === 0) return;

  // Pick `count` evenly-spaced indices through the active list
  for (let i = 0; i < count; i++) {
    const idx = Math.round(((i + 0.5) / count) * active.length);
    const [c, r] = active[Math.min(idx, active.length - 1)];
    cells[c][r].cellType = "bonus";
  }
}

/** DFS through non-wall cells from (startC, startR). */
function dfsPath(
  cells: Cell[][], cols: number, rows: number,
  startC: number, startR: number
): PathStep[] {
  const visited = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
  const path: PathStep[] = [];

  function dfs(col: number, row: number, dir: Direction): void {
    visited[col][row] = true;
    path.push({
      col, row, direction: dir,
      eating: cells[col][row].cellType === "pellet" || cells[col][row].cellType === "bonus",
    });
    for (const { dc, dr, dir: nextDir } of CARDINAL) {
      const nc = col + dc, nr = row + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows &&
          !visited[nc][nr] && cells[nc][nr].cellType !== "wall") {
        dfs(nc, nr, nextDir);
      }
    }
  }

  dfs(startC, startR, "right");

  // Safety fallback for any remaining disconnected components (should be rare
  // after pruneIsolatedFloors, but handled gracefully).
  let more = true;
  while (more) {
    more = false;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!visited[c][r] && cells[c][r].cellType !== "wall") {
          dfs(c, r, path[path.length - 1].direction);
          more = true; break;
        }
      }
      if (more) break;
    }
  }

  return path;
}
