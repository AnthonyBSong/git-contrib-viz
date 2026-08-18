/**
 * Manifest validation and resolution.
 *
 * `resolveTheme` is the single door every theme comes through — built-in skins
 * and installed ones alike — so a third-party theme is never a second-class
 * citizen, and a broken one fails with a message naming the field at fault
 * rather than emitting a subtly wrong drawing.
 */

import { DIRECTIONS } from "./types";
import type {
  ColorScheme,
  Direction,
  FigureSpec,
  Formation,
  ResolvedFigure,
  Theme,
  ThemeManifest,
} from "./types";
import { resolveSprites, type SpriteLoader } from "./sprite";
import type { SanitizeReport } from "./svg-asset";

export const DEFAULT_LAYOUT = {
  cellSize: 14,
  cellGap: 2,
  padding: 20,
  stepDuration: 0.08,
} as const;

export const DEFAULT_BACKGROUND: Record<ColorScheme, string> = {
  dark: "#0d1117",
  light: "#ffffff",
};

const DEFAULT_FOLLOWER_SPACING = 4;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface ResolveThemeOptions {
  /** Where the manifest came from, for error messages: a directory or `built-in`. */
  source: string;
  /** Reads sprite files referenced by the manifest. Themes with none need no loader. */
  loader?: SpriteLoader;
  /** Collects non-fatal problems found while loading artwork. */
  report?: SanitizeReport;
}

/**
 * Validates a manifest and resolves every reference in it: sprite artwork is
 * read and sanitized, derived poses are built, figures get a sprite for all four
 * directions. The result is self-contained — the renderer never touches disk.
 */
export function resolveTheme(manifest: ThemeManifest, options: ResolveThemeOptions): Theme {
  const { source } = options;
  const fail = (message: string): never => {
    throw new Error(`theme ${manifest?.id ? `"${manifest.id}" ` : ""}(${source}): ${message}`);
  };

  if (!manifest || typeof manifest !== "object") fail("manifest is not an object");
  if (manifest.schemaVersion !== 1) {
    fail(`unsupported schemaVersion ${JSON.stringify(manifest.schemaVersion)} (expected 1)`);
  }
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    fail(`"id" must be a name like "doggie-kit" (got ${JSON.stringify(manifest.id)})`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") fail(`"name" is required`);

  const layout = {
    cellSize: positive(manifest.layout?.cellSize, DEFAULT_LAYOUT.cellSize, "layout.cellSize", fail),
    cellGap: nonNegative(manifest.layout?.cellGap, DEFAULT_LAYOUT.cellGap, "layout.cellGap", fail),
    padding: nonNegative(manifest.layout?.padding, DEFAULT_LAYOUT.padding, "layout.padding", fail),
    stepDuration: positive(
      manifest.layout?.stepDuration,
      DEFAULT_LAYOUT.stepDuration,
      "layout.stepDuration",
      fail
    ),
  };

  if (!manifest.sprites || typeof manifest.sprites !== "object" || Object.keys(manifest.sprites).length === 0) {
    fail(`"sprites" must declare at least one sprite`);
  }

  const loader: SpriteLoader =
    options.loader ??
    {
      readFile(relativePath) {
        throw new Error(
          `sprite file "${relativePath}" cannot be read: this theme was loaded without a file loader`
        );
      },
    };

  let sprites;
  try {
    sprites = resolveSprites(manifest.sprites, {
      cellSize: layout.cellSize,
      idPrefix: manifest.id.replace(/[^a-zA-Z0-9_-]+/g, "-"),
      loader,
      report: options.report,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const requireSprite = (name: unknown, field: string): string => {
    if (typeof name !== "string" || name === "") fail(`${field} must name a sprite`);
    if (!sprites[name as string]) {
      fail(`${field} refers to unknown sprite "${name}" (declared: ${Object.keys(sprites).join(", ")})`);
    }
    return name as string;
  };

  if (!manifest.collectibles || typeof manifest.collectibles !== "object") {
    fail(`"collectibles" is required (the leader has to eat something)`);
  }
  const pellet = requireSprite(manifest.collectibles.pellet, "collectibles.pellet");

  let bonus: Theme["collectibles"]["bonus"];
  if (manifest.collectibles.bonus) {
    const rate = manifest.collectibles.bonus.rate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      fail(`collectibles.bonus.rate must be a fraction between 0 and 1 (got ${JSON.stringify(rate)})`);
    }
    bonus = { sprite: requireSprite(manifest.collectibles.bonus.sprite, "collectibles.bonus.sprite"), rate };
  }

  const terrain = {
    wall: manifest.terrain?.wall === undefined ? undefined : requireSprite(manifest.terrain.wall, "terrain.wall"),
    floor: manifest.terrain?.floor === undefined ? undefined : requireSprite(manifest.terrain.floor, "terrain.floor"),
  };

  if (!manifest.figures?.leader) fail(`"figures.leader" is required`);
  const spacing = positive(
    manifest.figures.followerSpacing,
    DEFAULT_FOLLOWER_SPACING,
    "figures.followerSpacing",
    fail
  );

  // The leader must walk the path in lockstep with it: collectibles disappear on the
  // step index they are eaten at, so a leader trailing its own path would eat things
  // it had not reached yet.
  if (manifest.figures.leader.offset !== undefined && manifest.figures.leader.offset !== 0) {
    fail(`figures.leader.offset must be 0 — only followers trail the path`);
  }
  const leader = resolveFigure(manifest.figures.leader, "figures.leader", "leader", 0, requireSprite, fail);
  const followers = (manifest.figures.followers ?? []).map((spec, i) =>
    resolveFigure(
      spec,
      `figures.followers[${i}]`,
      `follower-${i + 1}`,
      spacing * (i + 1),
      requireSprite,
      fail
    )
  );

  const defaultFormation = manifest.defaultFormation ?? (followers.length > 0 ? "train" : "single");
  if (defaultFormation !== "single" && defaultFormation !== "train") {
    fail(`"defaultFormation" must be "single" or "train" (got ${JSON.stringify(defaultFormation)})`);
  }

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    source,
    layout,
    background: { ...DEFAULT_BACKGROUND, ...manifest.background },
    sprites,
    terrain,
    collectibles: { pellet, bonus },
    leader,
    followers,
    defaultFormation,
  };
}

function resolveFigure(
  spec: FigureSpec,
  field: string,
  fallbackId: string,
  defaultOffset: number,
  requireSprite: (name: unknown, field: string) => string,
  fail: (message: string) => never
): ResolvedFigure {
  if (!spec || typeof spec !== "object") fail(`${field} must be an object`);
  if (spec.sprite === undefined && (!spec.sprites || Object.keys(spec.sprites).length === 0)) {
    fail(`${field} must set "sprite" or "sprites"`);
  }

  const sprites = {} as Record<Direction, string>;
  for (const direction of DIRECTIONS) {
    const name = spec.sprites?.[direction] ?? spec.sprite;
    if (name === undefined) {
      fail(`${field} has no sprite for direction "${direction}" (add it to "sprites", or set "sprite")`);
    }
    sprites[direction] = requireSprite(name, `${field}.sprites.${direction}`);
  }

  const offset = spec.offset ?? defaultOffset;
  if (!Number.isInteger(offset) || offset < 0) {
    fail(`${field}.offset must be a whole number of steps ≥ 0 (got ${JSON.stringify(spec.offset)})`);
  }

  return {
    id: spec.id ?? fallbackId,
    sprites,
    rotate: spec.rotate === true,
    offset,
    vars: { ...spec.vars },
  };
}

function positive(
  value: number | undefined,
  fallback: number,
  field: string,
  fail: (message: string) => never
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${field} must be a positive number (got ${JSON.stringify(value)})`);
  }
  return value;
}

function nonNegative(
  value: number | undefined,
  fallback: number,
  field: string,
  fail: (message: string) => never
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${field} must be a number ≥ 0 (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** The formation a caller ends up with, given the theme's default and any override. */
export function chooseFormation(theme: Theme, requested?: Formation | null): Formation {
  const formation = requested ?? theme.defaultFormation;
  if (formation !== "single" && formation !== "train") {
    throw new Error(`unknown formation "${formation}" (expected "single" or "train")`);
  }
  return formation;
}
