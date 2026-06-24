import type { PacmanGrid, Direction } from "@git-pacman/grid";

// ─── Layout ──────────────────────────────────────────────────────────────────
const CELL_SIZE = 14;
const CELL_GAP = 2;
const PADDING = 20;
const STEP_DURATION = 0.08; // seconds per path step

// ─── Direction → rotation angle (Pac-Man faces right at 0°) ─────────────────
const DIR_ANGLE: Record<Direction, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

// ─── Cell renderers ───────────────────────────────────────────────────────────
// SPRITE: replace rect/circle shapes with custom artwork. Canvas is 14×14px.

function renderWall(x: number, y: number): string {
  // Blue-outlined rect — classic Pac-Man maze wall look
  return `<rect x="${x + 1}" y="${y + 1}" width="12" height="12" rx="1.5"
    fill="#0f1b3d" stroke="#3b82f6" stroke-width="1.5"/>`;
}

function renderFloor(x: number, y: number): string {
  return `<rect x="${x + 2}" y="${y + 2}" width="10" height="10" rx="2" fill="#161b22"/>`;
}

function renderDot(x: number, y: number, opacityAnim: string): string {
  // SPRITE: yellow pellet dot — replace circle with custom artwork
  return `<circle cx="${x + 7}" cy="${y + 7}" r="3.5" fill="#FFD700">${opacityAnim}</circle>`;
}

function renderCherry(x: number, y: number, opacityAnim: string): string {
  // SPRITE: pixel-art cherry — traced from assets/sprites/cherry.svg (14×14 canvas).
  // opacityAnim is a complete <animate> element placed inside the <g> to fade
  // the whole cherry out when Pac-Man eats it.
  const t = (dx: number, dy: number, w: number, h: number, fill: string) =>
    `<rect x="${x + dx}" y="${y + dy}" width="${w}" height="${h}" fill="${fill}"/>`;
  return `<g>
    ${opacityAnim}
    ${t(6, 0, 2, 1, "#3a7d44")}
    ${t(5, 1, 1, 1, "#3a7d44")}${t(8, 1, 1, 1, "#3a7d44")}
    ${t(4, 2, 1, 1, "#3a7d44")}${t(9, 2, 1, 1, "#3a7d44")}
    ${t(3, 3, 1, 1, "#3a7d44")}${t(10, 3, 1, 1, "#3a7d44")}
    ${t(2, 4, 3, 1, "#cc1100")}${t(9, 4, 3, 1, "#cc1100")}
    ${t(1, 5, 5, 3, "#cc1100")}${t(8, 5, 5, 3, "#cc1100")}
    ${t(2, 8, 3, 1, "#cc1100")}${t(9, 8, 3, 1, "#cc1100")}
    ${t(2, 5, 1, 1, "#ff5555")}${t(9, 5, 1, 1, "#ff5555")}
  </g>`;
}

// ─── Character renderers ──────────────────────────────────────────────────────
// Each character uses nested <g> elements:
//   outer <g>: animateTransform translate → moves to grid position
//   inner <g>: animateTransform rotate   → faces movement direction
//
// SPRITE: replace shape elements inside inner <g> with custom artwork (14×14 canvas,
// character should face RIGHT at 0°, centered at (7,7)).

function renderPacman(
  translateValues: string,
  rotateValues: string,
  keyTimes: string,
  dur: number
): string {
  return `
  <g>
    <animateTransform attributeName="transform" type="translate"
      values="${translateValues}" keyTimes="${keyTimes}"
      dur="${dur}s" repeatCount="indefinite" calcMode="discrete"/>
    <g>
      <animateTransform attributeName="transform" type="rotate"
        values="${rotateValues}" keyTimes="${keyTimes}"
        dur="${dur}s" repeatCount="indefinite" calcMode="discrete"/>
      <!-- SPRITE: Pac-Man body — facing right, centered at (7,7) -->
      <path fill="#FFD700">
        <animate attributeName="d"
          values="M7,7 L13,4 A6,6 0,1,0 13,10 Z;M7,7 L13,6.8 A6,6 0,1,0 13,7.2 Z;M7,7 L13,4 A6,6 0,1,0 13,10 Z"
          dur="0.3s" repeatCount="indefinite"/>
      </path>
    </g>
  </g>`;
}

// Pupil x-positions per direction.
// Left eye white: x=2..4. Right eye white: x=8..10.
// Pupil is 1×2; right-facing → right side of eye; left-facing → left side.
const PUPIL_X: Record<Direction, { left: number; right: number }> = {
  right: { left: 4, right: 10 },
  left:  { left: 2, right: 8  },
  up:    { left: 4, right: 10 }, // treat up/down as right-facing
  down:  { left: 2, right: 8  }, // treat down as left-facing
};

function renderGhost(
  color: string,
  translateValues: string,
  leftPupilX: string,   // per-frame x for left-eye pupil
  rightPupilX: string,  // per-frame x for right-eye pupil
  keyTimes: string,
  dur: number
): string {
  // SPRITE: pixel-art ghost traced from ghost_right.jpeg (14×14 canvas).
  // Replace rect/circle shapes with custom artwork to reskin.
  return `
  <g>
    <animateTransform attributeName="transform" type="translate"
      values="${translateValues}" keyTimes="${keyTimes}"
      dur="${dur}s" repeatCount="indefinite" calcMode="discrete"/>
    <!-- Top dome -->
    <rect x="4"  y="0" width="6"  height="1" fill="${color}"/>
    <rect x="3"  y="1" width="8"  height="1" fill="${color}"/>
    <rect x="2"  y="2" width="10" height="1" fill="${color}"/>
    <rect x="1"  y="3" width="12" height="1" fill="${color}"/>
    <!-- Eye-row body (left edge, centre, right edge) -->
    <rect x="1"  y="4" width="1"  height="4" fill="${color}"/>
    <rect x="5"  y="4" width="3"  height="4" fill="${color}"/>
    <rect x="11" y="4" width="2"  height="4" fill="${color}"/>
    <!-- Main body rows 8-10 -->
    <rect x="1"  y="8" width="12" height="3" fill="${color}"/>
    <!-- Skirt: 3 feet bases (row 11) -->
    <rect x="1"  y="11" width="3" height="1" fill="${color}"/>
    <rect x="5"  y="11" width="3" height="1" fill="${color}"/>
    <rect x="9"  y="11" width="3" height="1" fill="${color}"/>
    <!-- Skirt: 3 feet tips (row 12) -->
    <rect x="1"  y="12" width="2" height="1" fill="${color}"/>
    <rect x="5"  y="12" width="2" height="1" fill="${color}"/>
    <rect x="9"  y="12" width="2" height="1" fill="${color}"/>
    <!-- Left eye white -->
    <rect x="2" y="4" width="3" height="4" fill="white"/>
    <!-- Left pupil — animates x between 2 (left-facing) and 4 (right-facing) -->
    <rect y="6" width="1" height="2" fill="#1a1a1a">
      <animate attributeName="x" values="${leftPupilX}"
        keyTimes="${keyTimes}" dur="${dur}s" repeatCount="indefinite" calcMode="discrete"/>
    </rect>
    <!-- Right eye white -->
    <rect x="8" y="4" width="3" height="4" fill="white"/>
    <!-- Right pupil — animates x between 8 (left-facing) and 10 (right-facing) -->
    <rect y="6" width="1" height="2" fill="#1a1a1a">
      <animate attributeName="x" values="${rightPupilX}"
        keyTimes="${keyTimes}" dur="${dur}s" repeatCount="indefinite" calcMode="discrete"/>
    </rect>
  </g>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export interface SvgOptions {
  includeGhosts?: boolean;
  colorScheme?: "dark" | "light";
}

export function createSvg(grid: PacmanGrid, options: SvgOptions = {}): string {
  const { includeGhosts = true, colorScheme = "dark" } = options;

  const step = CELL_SIZE + CELL_GAP;
  const width = grid.cols * step + PADDING * 2;
  const height = grid.rows * step + PADDING * 2;
  const bg = colorScheme === "dark" ? "#0d1117" : "#ffffff";

  const n = grid.path.length;
  if (n === 0) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bg}"/></svg>`;

  const totalDuration = n * STEP_DURATION;

  // Shared keyTimes string — same for Pac-Man AND all ghosts
  const keyTimes = grid.path
    .map((_, i) => (n === 1 ? "0" : (i / (n - 1)).toFixed(4)))
    .join(";");

  // ── Eat-time lookup: "col,row" → step index ──
  const eatTime = new Map<string, number>();
  grid.path.forEach((s, i) => {
    if (s.eating) eatTime.set(`${s.col},${s.row}`, i);
  });

  // ── All 52×7 cells ──
  const wallCells: string[] = [];
  const floorCells: string[] = [];
  const dotCells: string[] = [];

  for (let c = 0; c < grid.cols; c++) {
    for (let r = 0; r < grid.rows; r++) {
      const cell = grid.cells[c][r];
      const x = PADDING + c * step;
      const y = PADDING + r * step;

      if (cell.cellType === "wall") {
        wallCells.push(renderWall(x, y));
      } else if (cell.cellType === "floor") {
        floorCells.push(renderFloor(x, y));
      } else {
        // active dot or cherry — disappears when Pac-Man arrives
        const arrival = eatTime.get(`${c},${r}`);
        let opacityAnim = "";
        if (arrival !== undefined) {
          const t0 = Math.max(0.0001, arrival / Math.max(1, n - 1));
          const t1 = Math.min(t0 + 0.005, 0.9999);
          opacityAnim = `<animate attributeName="opacity" values="1;1;0;0"
            keyTimes="0;${t0.toFixed(4)};${t1.toFixed(4)};1"
            dur="${totalDuration}s" repeatCount="indefinite"/>`;
        }
        if (cell.cellType === "cherry") {
          dotCells.push(renderCherry(x, y, opacityAnim));
        } else {
          dotCells.push(renderDot(x, y, opacityAnim));
        }
      }
    }
  }

  // ── Pac-Man ──
  const pacTranslate = grid.path
    .map((s) => `${PADDING + s.col * step},${PADDING + s.row * step}`)
    .join(";");
  const pacRotate = grid.path
    .map((s) => `${DIR_ANGLE[s.direction]},7,7`)
    .join(";");

  const pacman = renderPacman(pacTranslate, pacRotate, keyTimes, totalDuration);

  // ── Ghosts — snake chain: ghost k is always exactly `offset` steps behind Pac-Man ──
  // Colors match the user's four ghost variants: red, pink, yellow, neon blue
  const GHOST_COLORS = ["#FF0000", "#FFB8FF", "#FFD700", "#29ABE2"];
  const GHOST_OFFSETS = [4, 8, 12, 16];

  let ghosts = "";
  if (includeGhosts) {
    ghosts = GHOST_COLORS.map((color, gi) => {
      const offset = GHOST_OFFSETS[gi];

      // At step i this ghost occupies path[max(0, i - offset)]
      const src = (i: number) => grid.path[Math.max(0, i - offset)];

      const translateValues = grid.path
        .map((_, i) => `${PADDING + src(i).col * step},${PADDING + src(i).row * step}`)
        .join(";");

      // Pupil x positions update with the ghost's own movement direction
      const leftPupilX = grid.path
        .map((_, i) => PUPIL_X[src(i).direction].left)
        .join(";");
      const rightPupilX = grid.path
        .map((_, i) => PUPIL_X[src(i).direction].right)
        .join(";");

      return renderGhost(color, translateValues, leftPupilX, rightPupilX, keyTimes, totalDuration);
    }).join("\n");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>GitHub Contributions — Pac-Man</title>
  <rect width="${width}" height="${height}" fill="${bg}" rx="6"/>

  <!-- Walls (inactive, no active neighbors) -->
  ${wallCells.join("\n  ")}

  <!-- Floor / corridors (inactive, adjacent to active) -->
  ${floorCells.join("\n  ")}

  <!-- Active dots (disappear as Pac-Man eats them) -->
  ${dotCells.join("\n  ")}

  <!-- Ghosts — trailing Pac-Man at fixed offsets (snake chain, no growth) -->
  ${ghosts}

  <!-- Pac-Man -->
  ${pacman}
</svg>`;
}
