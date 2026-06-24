import * as core from "@actions/core";
import fs from "fs";
import path from "path";
import { fetchContributions } from "@git-pacman/github-contributions";
import { buildGrid } from "@git-pacman/grid";
import { createSvg } from "@git-pacman/svg-creator";

async function main(): Promise<void> {
  // Read from GitHub Actions inputs; fall back to env vars for local dev
  const token = core.getInput("github_token") || process.env.GH_TOKEN || "";
  const username = core.getInput("github_user_name") || process.env.USERNAME || "";
  const outputPath = core.getInput("svg_out_path") || process.env.OUTPUT_PATH || "dist/pacman.svg";
  const colorScheme = (core.getInput("color_scheme") || process.env.COLOR_SCHEME || "dark") as "dark" | "light";

  if (!token) throw new Error("github_token input (or GH_TOKEN env var) is required");
  if (!username) throw new Error("github_user_name input (or USERNAME env var) is required");

  core.info(`Fetching contributions for ${username}…`);
  const contributions = await fetchContributions(username, token);
  core.info(`  Total contributions: ${contributions.totalContributions}`);

  core.info("Building grid and computing Pac-Man path…");
  const grid = buildGrid(contributions);
  core.info(`  Grid: ${grid.cols} cols × ${grid.rows} rows, ${grid.path.length} path steps`);

  core.info("Generating SVG…");
  const svg = createSvg(grid, { includeGhosts: true, colorScheme });

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, svg, "utf8");
  core.info(`SVG written to ${outputPath}`);

  core.setOutput("svg_path", outputPath);
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
