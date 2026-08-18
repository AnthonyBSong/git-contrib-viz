/**
 * Finding and loading themes.
 *
 * Three sources, in priority order: a directory path the caller gave us, an
 * installed theme found on the search path, or a built-in. The search path is the
 * seam a theme marketplace plugs into — installing a theme means dropping a
 * directory containing `theme.json` somewhere on it, and nothing in the renderer
 * or the CLI has to learn about it.
 */

import fs from "fs";
import path from "path";
import { resolveTheme, type ResolveThemeOptions } from "./manifest";
import type { SpriteLoader } from "./sprite";
import type { SanitizeReport } from "./svg-asset";
import type { Theme, ThemeManifest } from "./types";
import { pacmanTheme } from "./builtin/pacman";
import { dogsTheme } from "./builtin/dogs";

/** Filename that marks a directory as a theme. */
export const MANIFEST_FILENAME = "theme.json";

/** Refuses absurd artwork before it becomes an unservable SVG. */
const MAX_SPRITE_BYTES = 4 * 1024 * 1024;

/** Total artwork size that earns a warning — a README has to serve this. */
const SPRITE_BUDGET_WARN_BYTES = 512 * 1024;

interface BuiltinTheme {
  manifest: ThemeManifest;
  /** Artwork directory under `assets/`, for themes whose sprites are files. */
  assetDir?: string;
}

const BUILTINS: Record<string, BuiltinTheme> = {
  [pacmanTheme.id]: { manifest: pacmanTheme },
  [dogsTheme.id]: { manifest: dogsTheme, assetDir: "doggie-kit" },
};

export interface ThemeSummary {
  id: string;
  name: string;
  description?: string;
  source: string;
}

/** Built-in themes, for `--list-themes` and error messages. */
export function listBuiltinThemes(): ThemeSummary[] {
  return Object.values(BUILTINS).map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    source: "built-in",
  }));
}

export function builtinThemeIds(): string[] {
  return Object.keys(BUILTINS);
}

/**
 * Every theme available to `loadTheme`: the ones installed on the search path
 * first, since those shadow a built-in of the same id, then the built-ins.
 *
 * A directory is only reported if its manifest parses and declares an id, so a
 * half-written theme shows up as a warning rather than as a listing entry.
 */
export function discoverThemes(options: LoadThemeOptions = {}): ThemeSummary[] {
  const cwd = options.cwd ?? process.cwd();
  const found: ThemeSummary[] = [];
  const seen = new Set<string>();

  for (const root of searchPaths(options.searchPaths, cwd)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // A search path that does not exist is not an error.
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(root, entry.name);
      if (!isThemeDirectory(dir)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, MANIFEST_FILENAME), "utf8")
        ) as ThemeManifest;
        if (typeof manifest.id !== "string" || manifest.id === "" || seen.has(manifest.id)) continue;
        seen.add(manifest.id);
        found.push({
          id: manifest.id,
          name: typeof manifest.name === "string" ? manifest.name : manifest.id,
          description: manifest.description,
          source: dir,
        });
      } catch (err) {
        options.report?.warnings.push(
          `ignoring ${dir}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return [...found, ...listBuiltinThemes().filter((t) => !seen.has(t.id))];
}

export interface LoadThemeOptions {
  /**
   * Directories searched for installed themes, each expected to contain
   * `<id>/theme.json`. Defaults to `./themes` plus `GIT_VIZ_THEME_PATH`.
   */
  searchPaths?: string[];
  /** Collects artwork problems worth telling the user about. */
  report?: SanitizeReport;
  /** Directory relative paths are resolved against. Defaults to the process cwd. */
  cwd?: string;
}

/**
 * Loads a theme by id or directory path.
 *
 * @param spec a built-in id (`pacman`), an installed theme id, or a path to a
 *        directory containing `theme.json`.
 */
export function loadTheme(spec: string, options: LoadThemeOptions = {}): Theme {
  const trimmed = (spec ?? "").trim();
  if (trimmed === "") throw new Error("no theme specified");

  const cwd = options.cwd ?? process.cwd();

  // An explicit path always wins, so a theme under development shadows a
  // same-named built-in rather than being silently ignored.
  if (looksLikePath(trimmed)) {
    const dir = path.resolve(cwd, trimmed);
    if (!isThemeDirectory(dir)) {
      throw new Error(`no ${MANIFEST_FILENAME} found in ${dir}`);
    }
    return loadThemeFromDirectory(dir, options.report);
  }

  for (const root of searchPaths(options.searchPaths, cwd)) {
    const dir = path.resolve(root, trimmed);
    if (isThemeDirectory(dir)) return loadThemeFromDirectory(dir, options.report);
  }

  const builtin = BUILTINS[trimmed];
  if (!builtin) {
    throw new Error(
      `unknown theme "${trimmed}". Built-in themes: ${builtinThemeIds().join(", ")}. ` +
        `Pass a directory containing a ${MANIFEST_FILENAME} to use your own.`
    );
  }
  return loadBuiltinTheme(builtin, options.report);
}

function searchPaths(explicit: string[] | undefined, cwd: string): string[] {
  if (explicit) return explicit;
  const fromEnv = (process.env.GIT_VIZ_THEME_PATH ?? "")
    .split(path.delimiter)
    .filter((p) => p.trim() !== "");
  return [path.resolve(cwd, "themes"), ...fromEnv];
}

function looksLikePath(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~") || spec.includes(path.sep);
}

function isThemeDirectory(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, MANIFEST_FILENAME)).isFile();
  } catch {
    return false;
  }
}

/** Loads a theme from a directory containing `theme.json` and its artwork. */
export function loadThemeFromDirectory(dir: string, report?: SanitizeReport): Theme {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ThemeManifest;
  } catch (err) {
    throw new Error(`could not read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return resolveTheme(manifest, {
    source: dir,
    loader: createDirectoryLoader(dir, report),
    report,
  });
}

function loadBuiltinTheme(builtin: BuiltinTheme, report?: SanitizeReport): Theme {
  const options: ResolveThemeOptions = { source: "built-in", report };
  if (builtin.assetDir) {
    const dir = path.join(findAssetsRoot(), builtin.assetDir);
    options.source = dir;
    options.loader = createDirectoryLoader(dir, report);
  }
  return resolveTheme(builtin.manifest, options);
}

/**
 * Reads sprite files from one directory and nowhere else.
 *
 * Containment is the point: a manifest is data, and once themes are installed
 * from a marketplace, `"file": "../../../.ssh/id_rsa"` is a manifest away from
 * being embedded in a published SVG.
 */
export function createDirectoryLoader(dir: string, report?: SanitizeReport): SpriteLoader {
  const root = path.resolve(dir);
  let totalBytes = 0;

  return {
    readFile(relativePath: string): string {
      if (typeof relativePath !== "string" || relativePath.trim() === "") {
        throw new Error(`sprite "file" must be a non-empty path`);
      }
      if (path.isAbsolute(relativePath)) {
        throw new Error(`sprite file "${relativePath}" must be relative to the theme directory`);
      }

      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`sprite file "${relativePath}" escapes the theme directory`);
      }
      if (path.extname(resolved).toLowerCase() !== ".svg") {
        throw new Error(`sprite file "${relativePath}" must be an .svg file`);
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        throw new Error(`sprite file "${relativePath}" not found in ${root}`);
      }
      if (!stat.isFile()) throw new Error(`sprite file "${relativePath}" is not a file`);
      if (stat.size > MAX_SPRITE_BYTES) {
        throw new Error(
          `sprite file "${relativePath}" is ${formatBytes(stat.size)}, over the ` +
            `${formatBytes(MAX_SPRITE_BYTES)} limit`
        );
      }

      totalBytes += stat.size;
      if (totalBytes > SPRITE_BUDGET_WARN_BYTES) {
        report?.warnings.push(
          `theme artwork totals ${formatBytes(totalBytes)}; the generated SVG will be large`
        );
      }

      return fs.readFileSync(resolved, "utf8");
    },
  };
}

/**
 * Locates the bundled `assets/` directory.
 *
 * The compiled action is bundled to `dist/index.js` at the repo root, while the
 * package runs from `packages/theme/dist/`, so the depth differs — walking up for
 * the marker handles both. `GIT_VIZ_ASSETS_DIR` overrides it outright.
 */
export function findAssetsRoot(): string {
  const override = process.env.GIT_VIZ_ASSETS_DIR;
  if (override) return path.resolve(override);

  const marker = path.join("pacman-kit", "sprites");
  const starts = [__dirname, process.cwd()];

  for (const start of starts) {
    let dir = path.resolve(start);
    for (let up = 0; up < 8; up++) {
      const candidate = path.join(dir, "assets");
      if (fs.existsSync(path.join(candidate, marker))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(
    "could not locate the bundled assets/ directory; set GIT_VIZ_ASSETS_DIR to its path"
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
