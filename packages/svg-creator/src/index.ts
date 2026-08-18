/**
 * Turns a traversal grid plus a theme into one animated SVG.
 *
 * This module owns the timing and the geometry; the theme owns every mark on the
 * page. Nothing here knows what a ghost or a biscuit is — it asks the theme for a
 * sprite, positions it, and animates it along the path. That split is what lets a
 * new skin be a manifest rather than a code change.
 *
 * Animation is SMIL with `calcMode="discrete"`, one keyframe per path step, so a
 * figure snaps cell to cell the way an arcade sprite does. Every figure shares one
 * `keyTimes` list and one duration, which is what keeps a train in lockstep.
 */

import type { PathStep, TraversalGrid } from "@git-pacman/grid";
import {
  chooseFormation,
  placeSprite,
  renderSprite,
  type ColorScheme,
  type Direction,
  type DirectionSeries,
  type Formation,
  type ResolvedFigure,
  type ResolvedSprite,
  type Theme,
} from "@git-pacman/theme";

/** Rotation applied to a figure that faces its heading. Sprites face right at 0°. */
const DIR_ANGLE: Record<Direction, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

export interface SvgOptions {
  /**
   * `single` draws the leader alone; `train` adds the theme's followers trailing
   * behind it. Defaults to the theme's own preference.
   */
  formation?: Formation | null;
  colorScheme?: ColorScheme;
  /** Overrides the `<title>`, which screen readers announce. */
  title?: string;
}

export function createSvg(grid: TraversalGrid, theme: Theme, options: SvgOptions = {}): string {
  const { colorScheme = "dark" } = options;
  const formation = chooseFormation(theme, options.formation ?? undefined);
  const { cellSize, cellGap, padding, stepDuration } = theme.layout;

  const step = cellSize + cellGap;
  const width = grid.cols * step + padding * 2;
  const height = grid.rows * step + padding * 2;
  const bg = theme.background[colorScheme] ?? theme.background.dark;
  const title = options.title ?? `GitHub Contributions — ${theme.name}`;

  const n = grid.path.length;
  if (n === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bg}"/></svg>`;
  }

  const totalDuration = n * stepDuration;

  // Shared keyTimes string — same for the leader AND every follower.
  const keyTimes = grid.path
    .map((_, i) => (n === 1 ? "0" : (i / (n - 1)).toFixed(4)))
    .join(";");

  // Sprites are emitted into <defs> only if something actually uses them, so a
  // `single` run never carries the followers' artwork.
  const used = new Set<string>();
  const sprite = (name: string): ResolvedSprite => {
    const found = theme.sprites[name];
    if (!found) throw new Error(`theme "${theme.id}" has no sprite named "${name}"`);
    used.add(name);
    return found;
  };

  // ── Eat-time lookup: "col,row" → step index ──
  const eatTime = new Map<string, number>();
  grid.path.forEach((s, i) => {
    if (s.eating) eatTime.set(`${s.col},${s.row}`, i);
  });

  // ── Grid cells ──
  const wallCells: string[] = [];
  const floorCells: string[] = [];
  const itemCells: string[] = [];

  for (let c = 0; c < grid.cols; c++) {
    for (let r = 0; r < grid.rows; r++) {
      const cell = grid.cells[c][r];
      const x = padding + c * step;
      const y = padding + r * step;

      if (cell.cellType === "wall") {
        if (theme.terrain.wall) wallCells.push(placeSprite(sprite(theme.terrain.wall), x, y));
        continue;
      }
      if (cell.cellType === "floor") {
        if (theme.terrain.floor) floorCells.push(placeSprite(sprite(theme.terrain.floor), x, y));
        continue;
      }

      // A collectible — it disappears the moment the leader arrives.
      const arrival = eatTime.get(`${c},${r}`);
      let eatAnim = "";
      if (arrival !== undefined) {
        const t0 = Math.max(0.0001, arrival / Math.max(1, n - 1));
        const t1 = Math.min(t0 + 0.005, 0.9999);
        eatAnim = `<animate attributeName="opacity" values="1;1;0;0"
            keyTimes="0;${t0.toFixed(4)};${t1.toFixed(4)};1"
            dur="${totalDuration}s" repeatCount="indefinite"/>`;
      }

      // Falls back to the pellet when the grid holds a bonus the theme does not
      // define, so a grid and a theme can always be paired.
      const name =
        cell.cellType === "bonus" && theme.collectibles.bonus
          ? theme.collectibles.bonus.sprite
          : theme.collectibles.pellet;
      itemCells.push(placeSprite(sprite(name), x, y, { children: eatAnim }));
    }
  }

  // ── Figures ──
  const context = { grid, theme, sprite, keyTimes, totalDuration, step, padding, cellSize };
  const leader = renderFigure(theme.leader, context);
  const followers =
    formation === "train" ? theme.followers.map((f) => renderFigure(f, context)) : [];

  const defs = collectDefs(theme, used);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"${defs ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""}
     viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>${escapeText(title)}</title>
  <rect width="${width}" height="${height}" fill="${bg}" rx="6"/>
${defs}
  <!-- Walls (inactive, no active neighbors) -->
  ${wallCells.join("\n  ")}

  <!-- Floor / corridors (inactive, adjacent to active) -->
  ${floorCells.join("\n  ")}

  <!-- Collectibles (disappear as the leader eats them) -->
  ${itemCells.join("\n  ")}

  <!-- Followers — trailing the leader at fixed offsets (snake chain, no growth) -->
  ${followers.join("\n")}

  <!-- Leader -->
  ${leader}
</svg>`;
}

interface FigureContext {
  grid: TraversalGrid;
  theme: Theme;
  sprite: (name: string) => ResolvedSprite;
  keyTimes: string;
  totalDuration: number;
  step: number;
  padding: number;
  cellSize: number;
}

/**
 * Draws one figure and animates it along the path.
 *
 * A follower with offset `k` occupies the leader's position from `k` steps ago, so
 * the whole train walks the same route without any of them needing to know about
 * each other. Before the animation is `k` steps old they all pile on the start
 * cell, which is what makes the train emerge from a single point.
 */
function renderFigure(figure: ResolvedFigure, context: FigureContext): string {
  const { grid, keyTimes, totalDuration, step, padding, cellSize } = context;

  const at = (i: number): PathStep => grid.path[Math.max(0, i - figure.offset)];
  const headings = grid.path.map((_, i) => at(i).direction);

  const translate = grid.path
    .map((_, i) => `${padding + at(i).col * step},${padding + at(i).row * step}`)
    .join(";");

  // Sprite-declared direction series become per-step animation values.
  const series = (table: DirectionSeries): string => headings.map((d) => table[d]).join(";");
  const vars = { ...figure.vars, keyTimes, dur: String(totalDuration) };

  const body = renderPoses(figure, headings, context, { vars, series });

  const inner = figure.rotate
    ? `<g>
      <animateTransform attributeName="transform" type="rotate"
        values="${grid.path.map((_, i) => `${DIR_ANGLE[at(i).direction]},${cellSize / 2},${cellSize / 2}`).join(";")}"
        keyTimes="${keyTimes}"
        dur="${totalDuration}s" repeatCount="indefinite" calcMode="discrete"/>
      ${body}
    </g>`
    : body;

  return `
  <g>
    <animateTransform attributeName="transform" type="translate"
      values="${translate}" keyTimes="${keyTimes}"
      dur="${totalDuration}s" repeatCount="indefinite" calcMode="discrete"/>
    ${inner}
  </g>`;
}

/**
 * Renders the figure's artwork for every direction it actually travels in.
 *
 * A figure whose four directions resolve to one sprite — anything that rotates, or
 * ignores its heading — is drawn once. A figure with distinct poses draws each one
 * and cross-fades between them on the step clock, since swapping artwork is not
 * something a transform can express.
 */
function renderPoses(
  figure: ResolvedFigure,
  headings: Direction[],
  context: FigureContext,
  spriteContext: { vars: Record<string, string>; series: (table: DirectionSeries) => string }
): string {
  const { keyTimes, totalDuration } = context;
  const perStep = headings.map((d) => figure.sprites[d]);
  const distinct = [...new Set(perStep)];

  if (distinct.length === 1) {
    return renderSprite(context.sprite(distinct[0]), spriteContext);
  }

  return distinct
    .map((name) => {
      const values = perStep.map((p) => (p === name ? 1 : 0));
      return `<g opacity="${values[0]}">
      <animate attributeName="opacity" values="${values.join(";")}"
        keyTimes="${keyTimes}" dur="${totalDuration}s" repeatCount="indefinite" calcMode="discrete"/>
      ${renderSprite(context.sprite(name), spriteContext)}
    </g>`;
    })
    .join("\n      ");
}

/** Emits `<defs>` for the symbol sprites this drawing actually referenced. */
function collectDefs(theme: Theme, used: Set<string>): string {
  const symbols = new Map<string, string>();
  for (const name of used) {
    const sprite = theme.sprites[name];
    if (sprite?.kind === "symbol" && sprite.symbolId && sprite.symbolDefs) {
      symbols.set(sprite.symbolId, sprite.symbolDefs);
    }
  }
  if (symbols.size === 0) return "";
  return `\n  <defs>\n    ${[...symbols.values()].join("\n    ")}\n  </defs>\n`;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
