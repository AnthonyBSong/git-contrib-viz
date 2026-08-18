import * as core from "@actions/core";
import fs from "fs";
import path from "path";
import { generate, summarizeGrid, DEFAULT_THEME } from "@git-contrib-viz/generator";
import type { ColorScheme, Formation } from "@git-contrib-viz/theme";

/**
 * GitHub Action front-end. Reads inputs, hands them to the shared pipeline and
 * writes the result. Inputs fall back to environment variables so the same code
 * path runs locally, and `theme`/`formation` default to the original Pac-Man train
 * so existing workflows keep producing exactly what they produced before.
 */
async function main(): Promise<void> {
  const token = core.getInput("github_token") || process.env.GH_TOKEN || "";
  const username = core.getInput("github_user_name") || process.env.USERNAME || "";
  const outputPath = core.getInput("svg_out_path") || process.env.OUTPUT_PATH || "dist/pacman.svg";
  const colorScheme = (core.getInput("color_scheme") || process.env.COLOR_SCHEME || "dark") as ColorScheme;
  const themeName = core.getInput("theme") || process.env.THEME || DEFAULT_THEME;
  const formationInput = core.getInput("formation") || process.env.FORMATION || "";

  if (!token) throw new Error("github_token input (or GH_TOKEN env var) is required");
  if (!username) throw new Error("github_user_name input (or USERNAME env var) is required");

  if (formationInput && formationInput !== "single" && formationInput !== "train") {
    throw new Error(`formation input must be "single" or "train" (got "${formationInput}")`);
  }
  if (colorScheme !== "dark" && colorScheme !== "light") {
    throw new Error(`color_scheme input must be "dark" or "light" (got "${colorScheme}")`);
  }

  core.info(`Fetching contributions for ${username}…`);
  const result = await generate({
    username,
    token,
    theme: themeName,
    formation: (formationInput || null) as Formation | null,
    colorScheme,
  });

  core.info(`  Total contributions: ${result.contributions.totalContributions}`);
  core.info(`Theme: ${result.theme.name} (${result.theme.id}), formation: ${result.formation}`);

  const counts = summarizeGrid(result.grid);
  core.info(
    `  Grid: ${result.grid.cols} cols × ${result.grid.rows} rows, ` +
      `${result.grid.path.length} path steps, ${counts.pellet ?? 0} pellets, ${counts.bonus ?? 0} bonus`
  );
  for (const warning of result.warnings) core.warning(warning);

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, result.svg, "utf8");
  core.info(`SVG written to ${outputPath}`);

  core.setOutput("svg_path", outputPath);
  core.setOutput("theme", result.theme.id);
  core.setOutput("formation", result.formation);
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
