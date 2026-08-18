/**
 * Themes — the skin layer.
 *
 * A theme describes what the animation looks like: the artwork, what the leader
 * eats, and who follows it. The grid and the renderer know nothing about Pac-Man
 * or dogs; they ask a theme for markup. Adding a skin means adding a manifest, not
 * touching either.
 */

export * from "./types";
export { resolveTheme, chooseFormation, DEFAULT_LAYOUT, DEFAULT_BACKGROUND } from "./manifest";
export type { ResolveThemeOptions } from "./manifest";
export { renderSprite, placeSprite, resolveSprites } from "./sprite";
export type { SpriteContext, SpriteLoader, ResolveSpriteOptions } from "./sprite";
export { parseSvgDocument, sanitizeSvgMarkup, attrValue } from "./svg-asset";
export type { SvgAsset, SanitizeReport } from "./svg-asset";
export {
  loadTheme,
  loadThemeFromDirectory,
  createDirectoryLoader,
  listBuiltinThemes,
  discoverThemes,
  builtinThemeIds,
  findAssetsRoot,
  MANIFEST_FILENAME,
} from "./registry";
export type { LoadThemeOptions, ThemeSummary } from "./registry";
export { pacmanTheme } from "./builtin/pacman";
export { dogsTheme } from "./builtin/dogs";
