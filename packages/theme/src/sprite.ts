/**
 * Sprite resolution and rendering.
 *
 * A `SpriteSpec` says where artwork comes from; a `ResolvedSprite` is that
 * artwork ready to emit. The split matters for size: artwork with its own
 * coordinate system is declared once as a `<symbol>` and drawn with `<use>`, so a
 * 60 KB dog costs 60 KB whether it appears once or three hundred times, while a
 * hand-written primitive stays inline where it is cheapest and can carry its own
 * animation.
 */

import type { DirectionSeries, ResolvedSprite, SpriteSpec } from "./types";
import { parseSvgDocument, sanitizeSvgMarkup, type SanitizeReport } from "./svg-asset";

/** Marks where injected markup goes inside a sprite, e.g. an eat animation. */
const CHILDREN_TOKEN = "{{children}}";

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

/** How a sprite is read from disk. Injected so resolution stays testable. */
export interface SpriteLoader {
  /** Returns the file's text, or throws if it cannot be read. */
  readFile(relativePath: string): string;
}

export interface ResolveSpriteOptions {
  /** Cell canvas size in user units — sprites are fitted into `cellSize` square. */
  cellSize: number;
  /** Prefix for generated symbol ids and id rewriting; keeps themes isolated. */
  idPrefix: string;
  loader: SpriteLoader;
  report?: SanitizeReport;
}

/**
 * Resolves the whole sprite library at once, following `from` derivations.
 *
 * Derived sprites reuse the base sprite's `<symbol>` and only add a transform, so
 * mirroring a sprite to face the other way is free.
 */
export function resolveSprites(
  specs: Record<string, SpriteSpec>,
  options: ResolveSpriteOptions
): Record<string, ResolvedSprite> {
  const resolved: Record<string, ResolvedSprite> = {};
  const inProgress = new Set<string>();

  const resolveOne = (name: string): ResolvedSprite => {
    const done = resolved[name];
    if (done) return done;
    if (inProgress.has(name)) {
      throw new Error(`sprite "${name}" derives from itself (circular "from" chain)`);
    }
    const spec = specs[name];
    if (!spec) throw new Error(`unknown sprite: "${name}"`);

    inProgress.add(name);
    try {
      const sprite = spec.from
        ? derive(name, spec, resolveOne(spec.from), options)
        : fromSource(name, spec, options);
      resolved[name] = sprite;
      return sprite;
    } finally {
      inProgress.delete(name);
    }
  };

  for (const name of Object.keys(specs)) resolveOne(name);
  return resolved;
}

/** Reads a sprite from its own artwork — a file, or inline markup. */
function fromSource(name: string, spec: SpriteSpec, options: ResolveSpriteOptions): ResolvedSprite {
  const { cellSize, idPrefix, loader, report } = options;
  const sources = [spec.file, spec.inline].filter((s) => s !== undefined);
  if (sources.length !== 1) {
    throw new Error(`sprite "${name}" must set exactly one of "file", "inline" or "from"`);
  }

  const scale = spec.scale ?? 1;
  if (!(scale > 0)) throw new Error(`sprite "${name}" has a non-positive scale: ${spec.scale}`);

  const symbolId = `${idPrefix}-sprite-${slug(name)}`;
  const raw = spec.file !== undefined ? loader.readFile(spec.file) : spec.inline!;
  const parsed = parseSvgDocument(raw, report);
  const viewBox = spec.viewBox ?? parsed.viewBox;

  // A viewBox means the artwork has its own coordinate system and must be fitted
  // into the cell. Files always take the symbol path: they are arbitrarily large
  // and typically drawn in many cells, so inlining them would blow up the output.
  const needsSymbol = spec.file !== undefined || viewBox !== undefined;
  const inner = sanitizeSvgMarkup(parsed.inner, symbolId, needsSymbol ? `#${symbolId}` : undefined, report);

  if (!needsSymbol) {
    return {
      name,
      kind: "inline",
      markup: inner,
      transform: scaleTransform(scale, cellSize),
      series: spec.series ?? {},
    };
  }

  const box = viewBox ?? `0 0 ${cellSize} ${cellSize}`;
  return {
    name,
    kind: "symbol",
    markup: useElement(symbolId, scale, cellSize),
    symbolId,
    symbolDefs:
      `<symbol id="${symbolId}" viewBox="${box}" preserveAspectRatio="xMidYMid meet">` +
      `${inner}</symbol>`,
    series: spec.series ?? {},
  };
}

/**
 * Builds a variant of an already-resolved sprite: mirrored, resized, or both.
 *
 * The artwork itself is shared — a derived sprite points at the same `<symbol>` or
 * carries the same inline markup, and only wraps it in a transform. Mirroring a
 * 60 KB drawing therefore costs nothing.
 *
 * Transforms compose outward-in: this sprite's mirror, then whatever the base
 * already applied, then this sprite's own scale. A `scale` on a derived sprite
 * multiplies the base's rather than replacing it.
 */
function derive(
  name: string,
  spec: SpriteSpec,
  base: ResolvedSprite,
  options: ResolveSpriteOptions
): ResolvedSprite {
  if (spec.file !== undefined || spec.inline !== undefined) {
    throw new Error(`sprite "${name}" cannot combine "from" with "file" or "inline"`);
  }
  const { cellSize } = options;
  const scale = spec.scale ?? 1;
  if (!(scale > 0)) throw new Error(`sprite "${name}" has a non-positive scale: ${spec.scale}`);

  const parts: string[] = [];

  // Mirror about the cell's centre so the artwork stays inside its cell.
  if (spec.flipX || spec.flipY) {
    const tx = spec.flipX ? cellSize : 0;
    const ty = spec.flipY ? cellSize : 0;
    parts.push(`translate(${tx},${ty})`, `scale(${spec.flipX ? -1 : 1},${spec.flipY ? -1 : 1})`);
  }
  if (base.transform) parts.push(base.transform);
  if (spec.scale !== undefined) {
    const own = scaleTransform(scale, cellSize);
    if (own) parts.push(own);
  }

  return {
    name,
    kind: base.kind,
    markup: base.markup,
    symbolId: base.symbolId,
    symbolDefs: base.symbolDefs,
    transform: parts.length > 0 ? parts.join(" ") : undefined,
    series: spec.series ?? base.series,
  };
}

/** Centres a `<use>` box of `scale × cellSize` inside the cell. */
function useElement(symbolId: string, scale: number, cellSize: number): string {
  const size = round(cellSize * scale);
  const offset = round((cellSize - cellSize * scale) / 2);
  const position = offset === 0 ? "" : ` x="${offset}" y="${offset}"`;
  return `<use href="#${symbolId}" xlink:href="#${symbolId}"${position} width="${size}" height="${size}">${CHILDREN_TOKEN}</use>`;
}

function scaleTransform(scale: number, cellSize: number): string | undefined {
  if (scale === 1) return undefined;
  const offset = round((cellSize - cellSize * scale) / 2);
  return offset === 0 ? `scale(${scale})` : `translate(${offset},${offset}) scale(${scale})`;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Everything an instance of a sprite needs beyond the artwork itself. */
export interface SpriteContext {
  /** Values for `{{name}}` placeholders in the markup. */
  vars?: Record<string, string>;
  /**
   * Expands a direction series the sprite declared into a per-step `values`
   * string. Supplied for figures, which know their own heading at each step.
   */
  series?: (table: DirectionSeries) => string;
  /** Markup injected at the sprite's `{{children}}` point, e.g. an `<animate>`. */
  children?: string;
}

/**
 * Renders one instance of a sprite in cell coordinates, with the origin at the
 * cell's top-left corner. Callers position it themselves — grid cells with a
 * `translate`, figures with an animated transform.
 */
export function renderSprite(sprite: ResolvedSprite, context: SpriteContext = {}): string {
  const values: Record<string, string> = { ...context.vars };
  for (const [key, table] of Object.entries(sprite.series)) {
    if (context.series) values[key] = context.series(table);
  }

  let markup = substitute(sprite, values);
  markup = injectChildren(markup, context.children ?? "");
  if (sprite.transform) markup = `<g transform="${sprite.transform}">${markup}</g>`;
  return markup;
}

/** Positions a sprite instance at an absolute point in the output. */
export function placeSprite(
  sprite: ResolvedSprite,
  x: number,
  y: number,
  context: SpriteContext = {}
): string {
  const inner = renderSprite(sprite, context);
  if (x === 0 && y === 0) return inner;
  return `<g transform="translate(${round(x)},${round(y)})">${inner}</g>`;
}

function substitute(sprite: ResolvedSprite, values: Record<string, string>): string {
  return sprite.markup.replace(PLACEHOLDER, (all, key: string) => {
    if (key === "children") return all;
    const value = values[key];
    if (value === undefined) {
      throw new Error(
        `sprite "${sprite.name}" references {{${key}}}, which the theme does not define ` +
          `(add it to the figure's "vars" or the sprite's "series")`
      );
    }
    return value;
  });
}

/**
 * Places injected markup at the sprite's declared `{{children}}` point. Sprites
 * that declare none are wrapped in a group, so the injected animation still
 * applies to the whole drawing.
 */
function injectChildren(markup: string, children: string): string {
  if (markup.includes(CHILDREN_TOKEN)) {
    return markup.split(CHILDREN_TOKEN).join(children);
  }
  return children ? `<g>${children}${markup}</g>` : markup;
}

function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "sprite";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
