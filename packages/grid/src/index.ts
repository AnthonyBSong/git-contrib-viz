import type { ContributionGrid } from "@git-pacman/github-contributions";

export type CellType = "active" | "floor" | "wall" | "cherry";

export interface Cell {
  col: number;
  row: number;
  contributionCount: number;
  cellType: CellType;
}

export type Direction = "right" | "left" | "up" | "down";

export interface PathStep {
  col: number;
  row: number;
  direction: Direction;
  eating: boolean;
}

export interface PacmanGrid {
  cells: Cell[][];
  cols: number;
  rows: number;
  path: PathStep[];
}

const CARDINAL: { dc: number; dr: number; dir: Direction }[] = [
  { dc: 1, dr: 0, dir: "right" },
  { dc: 0, dr: 1, dir: "down" },
  { dc: -1, dr: 0, dir: "left" },
  { dc: 0, dr: -1, dir: "up" },
];

const MAX_WALL_CLUSTER = 8;

export function buildGrid(contributions: ContributionGrid): PacmanGrid {
  const rows = 7;
  const cols = contributions.weeks.length;

  const cells: Cell[][] = Array.from({ length: cols }, (_, col) =>
    Array.from({ length: rows }, (_, row) => {
      const count =
        contributions.weeks[col]?.contributionDays[row]?.contributionCount ?? 0;
      return {
        col, row, contributionCount: count,
        cellType: (count > 0 ? "active" : "wall") as CellType,
      };
    })
  );

  const activeCells: [number, number][] = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (cells[c][r].cellType === "active") activeCells.push([c, r]);

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

  // ── Step 3: enforce connectivity — any floor cell unreachable from the
  // DFS start reverts to wall so Pac-Man never needs to teleport. ──
  const [startC, startR] = findCenter(cells, cols, rows);
  pruneIsolatedFloors(cells, cols, rows, startC, startR);

  return { cells, cols, rows, path: dfsPath(cells, cols, rows, startC, startR, activeCells.length) };
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
      if (cells[c][r].cellType !== "active") continue;
      let cc = c, rr = r;
      while (parent[cc][rr] !== null) {
        const [pc, pr] = parent[cc][rr]!;
        if (cells[pc][pr].cellType !== "active") corridors.add(`${pc},${pr}`);
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

/** Non-wall cell closest to the grid's center — natural Pac-Man start. */
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

/** DFS through non-wall cells from (startC, startR).
 *  The subgraph should be fully connected after pruneIsolatedFloors, but if
 *  any disconnected components remain, the first active cell of each one is
 *  promoted to "cherry" (up to 5% of total active dots, minimum 0) so the
 *  teleport is visually signalled rather than silently happening mid-dot. */
function dfsPath(
  cells: Cell[][], cols: number, rows: number,
  startC: number, startR: number,
  totalActiveDots: number
): PathStep[] {
  const maxCherries = Math.floor(totalActiveDots * 0.05);
  const visited = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
  const path: PathStep[] = [];

  function dfs(col: number, row: number, dir: Direction): void {
    visited[col][row] = true;
    path.push({
      col, row, direction: dir,
      eating: cells[col][row].cellType === "active" || cells[col][row].cellType === "cherry",
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

  // Safety fallback for any remaining disconnected components.
  // Mark the first active cell of each new component as a cherry (max 4 total)
  // so the teleport arrival point gets a visual marker.
  let cherryCount = 0;
  let more = true;
  while (more) {
    more = false;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!visited[c][r] && cells[c][r].cellType !== "wall") {
          if (cells[c][r].cellType === "active" && cherryCount < maxCherries) {
            cells[c][r].cellType = "cherry";
            cherryCount++;
          }
          dfs(c, r, path[path.length - 1].direction);
          more = true; break;
        }
      }
      if (more) break;
    }
  }

  return path;
}
