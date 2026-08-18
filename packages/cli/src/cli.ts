#!/usr/bin/env node
/**
 * `git-viz` — generate the contribution animation from a terminal.
 *
 * The CLI is where a user picks their skin and how many figures walk the path, and
 * where a theme author previews work in progress: point `--theme` at a directory
 * containing `theme.json` and `--contributions` at a saved calendar, and no token
 * or network call is involved.
 */

import fs from "fs";
import path from "path";
import type { ContributionGrid } from "@git-pacman/github-contributions";
import { generate, summarizeGrid, DEFAULT_THEME } from "@git-pacman/generator";
import { discoverThemes } from "@git-pacman/theme";
import { enumFlag, formatFlags, listFlag, parseArgs, stringFlag, UsageError, type FlagSpec } from "./args";

const FLAGS: FlagSpec[] = [
  { name: "user", short: "u", value: "<login>", help: "GitHub username to draw (env: USERNAME)" },
  { name: "token", short: "t", value: "<token>", help: "GitHub API token (env: GH_TOKEN)" },
  { name: "out", short: "o", value: "<path>", help: "Where to write the SVG (default: dist/pacman.svg)" },
  { name: "theme", value: "<id|dir>", help: `Skin to use, or a directory containing theme.json (default: ${DEFAULT_THEME})` },
  { name: "formation", short: "f", value: "<mode>", help: "single (one figure) or train (figures following) — default: the theme's own" },
  { name: "color-scheme", short: "c", value: "<mode>", help: "Background: dark or light (default: dark)" },
  { name: "theme-path", value: "<dir>", repeatable: true, help: "Extra directory to search for installed themes (repeatable)" },
  { name: "contributions", value: "<file>", help: "Read the calendar from a JSON file instead of the API" },
  { name: "list-themes", boolean: true, help: "List the available themes and exit" },
  { name: "quiet", short: "q", boolean: true, help: "Only report errors" },
  { name: "help", short: "h", boolean: true, help: "Show this help and exit" },
];

const USAGE = `git-viz — turn a GitHub contribution calendar into an animated SVG

Usage:
  git-viz --user <login> --token <token> [options]
  git-viz --contributions calendar.json --theme dogs --out dogs.svg
  git-viz --list-themes

Options:
${formatFlags(FLAGS)}

Formations:
  single   One figure walks the path eating everything on it.
  train    The figure is followed by the theme's other figures, each trailing a
           few steps behind — Pac-Man's ghosts, or the rest of the pack.

Themes:
  Built-in skins are named (see --list-themes). Your own is a directory holding a
  theme.json manifest and its artwork; pass its path to --theme, or drop it in
  ./themes (or a --theme-path directory) and pass its id.
`;

async function main(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, FLAGS);

  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (flags["list-themes"]) {
    printThemes(listFlag(flags["theme-path"]));
    return 0;
  }

  const quiet = flags.quiet === true;
  const log = (message: string) => {
    if (!quiet) process.stderr.write(`${message}\n`);
  };

  const outPath = stringFlag(flags.out) ?? process.env.OUTPUT_PATH ?? "dist/pacman.svg";
  const contributionsFile = stringFlag(flags.contributions);

  const result = await generate({
    username: stringFlag(flags.user) ?? process.env.USERNAME,
    token: stringFlag(flags.token) ?? process.env.GH_TOKEN,
    theme: stringFlag(flags.theme) ?? process.env.THEME,
    themePaths: listFlag(flags["theme-path"]),
    formation: enumFlag(flags.formation, ["single", "train"] as const, "formation") ?? null,
    colorScheme: enumFlag(flags["color-scheme"], ["dark", "light"] as const, "color-scheme"),
    contributions: contributionsFile ? readCalendar(contributionsFile) : undefined,
  });

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, result.svg, "utf8");

  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);

  const counts = summarizeGrid(result.grid);
  log(
    `${result.theme.name} (${result.theme.id}) · ${result.formation} · ` +
      `${result.grid.cols}×${result.grid.rows} grid · ${result.grid.path.length} steps · ` +
      `${counts.pellet ?? 0} pellets, ${counts.bonus ?? 0} bonus`
  );
  log(`wrote ${outPath} (${Math.round(Buffer.byteLength(result.svg) / 1024)} KB)`);
  return 0;
}

function printThemes(themePaths?: string[]): void {
  const report = { warnings: [] };
  const themes = discoverThemes({ searchPaths: themePaths, report });
  const width = Math.max(...themes.map((t) => t.id.length));

  for (const theme of themes) {
    const origin = theme.source === "built-in" ? "built-in" : theme.source;
    process.stdout.write(`  ${theme.id.padEnd(width)}  ${theme.name}${theme.description ? ` — ${theme.description}` : ""}\n`);
    process.stdout.write(`  ${" ".repeat(width)}  ${origin}\n`);
  }
  for (const warning of report.warnings) process.stderr.write(`warning: ${warning}\n`);
  process.stdout.write(
    "\nUse a theme with --theme <id>, or --theme <directory containing theme.json>.\n" +
      "Installed themes are found in ./themes, any --theme-path directory, or GIT_PACMAN_THEME_PATH.\n"
  );
}

/**
 * Reads a saved contribution calendar. Accepts the shape this project's fetcher
 * returns, and also a bare `weeks` array, so a calendar pasted out of the GitHub
 * GraphQL response works without reshaping.
 */
function readCalendar(file: string): ContributionGrid {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new UsageError(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const source = (Array.isArray(parsed) ? { weeks: parsed } : parsed) as Partial<ContributionGrid>;
  const weeks = source?.weeks;
  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw new UsageError(`${file} has no "weeks" array of contribution days`);
  }

  const total =
    source.totalContributions ??
    weeks.reduce((sum, week) => sum + (week.contributionDays ?? []).reduce((s, d) => s + (d.contributionCount ?? 0), 0), 0);

  return { weeks, totalContributions: total, username: source.username ?? "local" };
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`git-viz: ${message}\n`);
    if (err instanceof UsageError) process.stderr.write(`\nRun git-viz --help for usage.\n`);
    process.exit(1);
  });
