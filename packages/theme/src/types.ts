/**
 * The theme contract — everything a skin needs to describe itself.
 *
 * A theme is data, not code: a `ThemeManifest` plus the SVG files it points at.
 * Built-in themes are manifests written in TypeScript (so sprite markup can be
 * a readable template literal); third-party themes are a directory containing a
 * `theme.json` manifest and its artwork. Both go through the same resolver, so a
 * marketplace theme can do everything a built-in one can.
 */

/** Movement direction of a figure along the path. Sprites face RIGHT at 0°. */
export type Direction = "right" | "left" | "up" | "down";

export const DIRECTIONS: readonly Direction[] = ["right", "left", "up", "down"];

/**
 * How many figures move along the path.
 * - `single` — the leader alone (one dog, one Pac-Man).
 * - `train`  — the leader plus followers trailing at fixed offsets.
 */
export type Formation = "single" | "train";

export type ColorScheme = "dark" | "light";

/**
 * A value per movement direction, expanded by the renderer into a per-step
 * `values` list for a SMIL `<animate>`. Lets a sprite react to its own heading
 * without the renderer knowing anything about the artwork — Pac-Man's ghosts use
 * it to shift their pupils left and right.
 */
export type DirectionSeries = Record<Direction, string | number>;

/**
 * One piece of artwork.
 *
 * Exactly one source must be given:
 * - `file`   — an SVG file relative to the theme directory. Emitted once as a
 *              `<symbol>` and referenced with `<use>`, so large artwork costs
 *              its bytes once no matter how many cells draw it.
 * - `inline` — SVG markup authored directly in cell coordinates. Inlined at
 *              every use site, which keeps small primitives (a dot, a wall)
 *              cheap and lets them carry their own `<animate>` elements.
 * - `from`   — derive from another sprite in the same theme, optionally
 *              mirrored. A theme that ships only a right-facing sprite gets its
 *              left-facing pose for free.
 */
export interface SpriteSpec {
  file?: string;
  inline?: string;
  from?: string;
  /** Mirror horizontally. Use with `from` to derive a left-facing pose. */
  flipX?: boolean;
  /** Mirror vertically. */
  flipY?: boolean;
  /**
   * Source coordinate box, `"minX minY width height"`. Parsed from the artwork's
   * own `<svg>` tag when omitted. Artwork with a viewBox is scaled to fit the
   * cell, preserving aspect ratio; markup without one is assumed to already be
   * in cell coordinates.
   */
  viewBox?: string;
  /** Size multiplier inside the cell. 1 fills the cell; 1.2 overflows slightly. */
  scale?: number;
  /**
   * Direction-dependent `{{placeholder}}` values. Each entry is expanded into a
   * per-animation-step `values` string from the direction the figure is heading
   * on that step.
   */
  series?: Record<string, DirectionSeries>;
}

/** A moving character: the leader that eats, or a follower that trails it. */
export interface FigureSpec {
  /** Identifier used in logs and as a fallback label. */
  id?: string;
  /** Sprite used for every direction. Shorthand for a uniform `sprites` map. */
  sprite?: string;
  /**
   * Per-direction sprite names. Unlisted directions fall back to `sprite`.
   * Directions that share a sprite cost nothing extra — a figure whose four
   * directions all resolve to one sprite is drawn once, with no pose swapping.
   */
  sprites?: Partial<Record<Direction, string>>;
  /**
   * Rotate the artwork to face the direction of travel (right 0°, down 90°,
   * left 180°, up 270°). Right for radially symmetric figures like Pac-Man;
   * wrong for anything with a clear "up", which should supply per-direction
   * sprites instead.
   */
  rotate?: boolean;
  /**
   * Steps this figure trails the leader by. Followers only; defaults to
   * `followerSpacing × (index + 1)`.
   */
  offset?: number;
  /** Values substituted into `{{name}}` placeholders in this figure's sprites. */
  vars?: Record<string, string>;
}

/** Grid geometry and animation timing. All values are in SVG user units. */
export interface LayoutSpec {
  /** Side of one cell's sprite canvas. */
  cellSize?: number;
  /** Gap between adjacent cells. */
  cellGap?: number;
  /** Border around the grid. */
  padding?: number;
  /** Seconds each path step takes. */
  stepDuration?: number;
}

/** What the leader eats. */
export interface CollectiblesSpec {
  /** Sprite for the common collectible on every active day (dot, biscuit). */
  pellet: string;
  /**
   * Rare collectible sprinkled across active days. Omit for themes with no
   * bonus item at all — the dogs only ever eat biscuits.
   */
  bonus?: {
    sprite: string;
    /** Fraction of active days promoted to a bonus, 0–1. */
    rate: number;
  };
}

/** Sprites for the non-collectible cells. */
export interface TerrainSpec {
  /** Inactive cell with no active neighbours — a maze wall. Omit to draw nothing. */
  wall?: string;
  /** Inactive cell the leader walks through — a corridor. Omit to draw nothing. */
  floor?: string;
}

/** A complete skin. This is the shape of a `theme.json`. */
export interface ThemeManifest {
  /** Manifest format version. Currently always 1. */
  schemaVersion: 1;
  /** Stable identifier, used as the `--theme` value. */
  id: string;
  /** Human-readable name. */
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  layout?: LayoutSpec;
  /** Page background per color scheme. */
  background?: Partial<Record<ColorScheme, string>>;
  /** Named artwork library. Every sprite reference elsewhere resolves here. */
  sprites: Record<string, SpriteSpec>;
  terrain?: TerrainSpec;
  collectibles: CollectiblesSpec;
  figures: {
    leader: FigureSpec;
    /** Drawn only in `train` formation. */
    followers?: FigureSpec[];
    /** Default step gap between consecutive figures in a train. */
    followerSpacing?: number;
  };
  /** Formation used when the caller does not pick one. */
  defaultFormation?: Formation;
}

// ─── Resolved forms ──────────────────────────────────────────────────────────
// Produced by `resolveTheme`. The renderer only ever sees these: sources are
// already read from disk, sanitized, mirrored and sized.

/**
 * A sprite ready to render.
 *
 * `inline` sprites are pasted at each use site; `symbol` sprites are declared
 * once in `<defs>` and referenced with `<use>`.
 */
export interface ResolvedSprite {
  name: string;
  kind: "inline" | "symbol";
  /**
   * `kind: "inline"` — markup in cell coordinates, possibly containing
   * `{{placeholder}}` tokens and a `{{children}}` injection point.
   */
  markup: string;
  /** `kind: "symbol"` — id of the `<symbol>` this sprite emits into `<defs>`. */
  symbolId?: string;
  /** `kind: "symbol"` — the `<symbol>` element itself. */
  symbolDefs?: string;
  /** Transform applied around the sprite, e.g. a mirror or a scale. */
  transform?: string;
  series: Record<string, DirectionSeries>;
}

/** A figure with its poses resolved to concrete sprites. */
export interface ResolvedFigure {
  id: string;
  /** Sprite name per direction — always all four. */
  sprites: Record<Direction, string>;
  rotate: boolean;
  /** Steps behind the leader. 0 for the leader itself. */
  offset: number;
  vars: Record<string, string>;
}

/** A theme with every reference resolved. What `createSvg` consumes. */
export interface Theme {
  id: string;
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Where the theme was loaded from — a directory, or a built-in marker. */
  source: string;
  layout: Required<LayoutSpec>;
  background: Record<ColorScheme, string>;
  sprites: Record<string, ResolvedSprite>;
  terrain: TerrainSpec;
  collectibles: CollectiblesSpec;
  leader: ResolvedFigure;
  followers: ResolvedFigure[];
  defaultFormation: Formation;
}
