/**
 * The pipeline: contributions → grid → themed SVG.
 *
 * Both front-ends (the CLI and the GitHub Action) call `generate`, so the wiring
 * that matters — above all, that the grid's bonus rate comes from the theme, so a
 * theme with no bonus item never gets bonus cells — is decided in one place and
 * cannot drift between them.
 */

import { fetchContributions, type ContributionGrid } from "@git-contrib-viz/github-contributions";
import { buildGrid, type TraversalGrid } from "@git-contrib-viz/grid";
import { createSvg } from "@git-contrib-viz/svg-creator";
import {
  chooseFormation,
  loadTheme,
  type ColorScheme,
  type Formation,
  type SanitizeReport,
  type Theme,
} from "@git-contrib-viz/theme";

export const DEFAULT_THEME = "pacman";

export interface GenerateOptions {
  /** GitHub login whose calendar is drawn. Not needed when `contributions` is given. */
  username?: string;
  /** Token for the GraphQL API. Not needed when `contributions` is given. */
  token?: string;
  /** Theme id or a directory containing `theme.json`. Defaults to Pac-Man. */
  theme?: string;
  /** Extra directories to search for installed themes. */
  themePaths?: string[];
  /** Overrides the theme's own formation preference. */
  formation?: Formation | null;
  colorScheme?: ColorScheme;
  /**
   * Use this calendar instead of calling the API. Lets a theme author preview
   * their work — and lets the tests run — without a token.
   */
  contributions?: ContributionGrid;
  /** Directory relative theme paths resolve against. Defaults to the process cwd. */
  cwd?: string;
}

export interface GenerateResult {
  svg: string;
  theme: Theme;
  grid: TraversalGrid;
  formation: Formation;
  contributions: ContributionGrid;
  /** Non-fatal problems found while loading theme artwork. */
  warnings: string[];
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const report: SanitizeReport = { warnings: [] };
  const theme = loadTheme(options.theme ?? DEFAULT_THEME, {
    searchPaths: options.themePaths,
    cwd: options.cwd,
    report,
  });
  const formation = chooseFormation(theme, options.formation ?? undefined);

  const contributions = options.contributions ?? (await fetchCalendar(options));

  // The theme decides whether a rare collectible exists at all: no bonus in the
  // manifest means no bonus cells in the grid, which is how the dogs end up
  // eating biscuits and nothing else.
  const grid = buildGrid(contributions, { bonusRate: theme.collectibles.bonus?.rate ?? 0 });

  const svg = createSvg(grid, theme, { formation, colorScheme: options.colorScheme });

  return { svg, theme, grid, formation, contributions, warnings: dedupe(report.warnings) };
}

async function fetchCalendar(options: GenerateOptions): Promise<ContributionGrid> {
  if (!options.token) throw new Error("a GitHub token is required to fetch contributions");
  if (!options.username) throw new Error("a GitHub username is required to fetch contributions");
  return fetchContributions(options.username, options.token);
}

/** One warning per distinct problem, however many sprites tripped over it. */
function dedupe(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

/** Counts each kind of cell — used for the run summary the front-ends print. */
export function summarizeGrid(grid: TraversalGrid): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const column of grid.cells) {
    for (const cell of column) counts[cell.cellType] = (counts[cell.cellType] ?? 0) + 1;
  }
  return counts;
}
