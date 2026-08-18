# git-contrib-viz
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/AnthonyBSong/git-contrib-viz/main.yml?label=action&style=flat-square)](https://github.com/AnthonyBSong/git-contrib-viz/actions/)
[![GitHub release](https://img.shields.io/github/release/AnthonyBSong/git-contrib-viz.svg?style=flat-square)](https://github.com/AnthonyBSong/git-contrib-viz/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-git--contrib--viz-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/git-contrib-viz)
![type definitions](https://img.shields.io/npm/types/typescript?style=flat-square)

![Pac-Man contributions](https://raw.githubusercontent.com/AnthonyBSong/git-contrib-viz/output/pacman.svg)

Turns your GitHub contribution chart into an animated SVG you can embed in any
profile README. Pac-Man eating dots with ghosts in tow is the default — and it is
just one **theme**. Pick another, or bring your own artwork.

## How it works

1. A GitHub Action fetches your contribution calendar via the GraphQL API.
2. Active days become collectibles on a 52×7 grid; inactive days become corridors
   or maze walls. A theme decides what a collectible looks like, and whether a rare
   bonus one exists at all.
3. A DFS traversal computes a path through all active cells, maximizing the number
   of maze walls that can be placed.
4. An animated SVG is generated: the theme's leader moves along the path eating
   everything on it, alone or with followers trailing behind.
5. The SVG is pushed to the `output` branch and served via raw.githubusercontent.com.

## Themes and formations

Two knobs, both available to the Action and the CLI:

| `theme` | |
| --- | --- |
| `pacman` *(default)* | Pac-Man eats dots and cherries. |
| `dogs` | Dogs work through a yard of biscuits. No cherries. |
| a directory path | Your own artwork — see [docs/themes.md](docs/themes.md). |

| `formation` | |
| --- | --- |
| `single` | One figure walks the path eating everything on it. |
| `train` | The figure is followed by the theme's others, each trailing a few steps behind — Pac-Man's ghosts, or the rest of the pack. |

Leave `formation` empty and each theme picks its own default: Pac-Man brings the
ghosts, the dogs send one dog. Existing workflows that set neither produce exactly
what they produced before.

## Usage Guide

Add this to a workflow in your `YOUR_USERNAME/YOUR_USERNAME` profile repository:

```yaml
- uses: AnthonyBSong/git-contrib-viz@v1
  with:
    github_user_name: ${{ github.repository_owner }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### 1. Create `.github/workflows/contributions.yml`:

```yaml
name: Generate contribution animation

on:
  schedule:
    - cron: "0 0 * * *"   # runs daily at midnight UTC
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: AnthonyBSong/git-contrib-viz@v1
        with:
          github_user_name: ${{ github.repository_owner }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          svg_out_path: dist/pacman.svg
          # theme: dogs         # pacman (default) or dogs
          # formation: single   # single or train

      - name: Push SVG to output branch
        run: |
          cd dist
          git init -b output
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add pacman.svg
          git commit -m "chore: update pacman animation [skip ci]"
          git push -f "https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.git" output:output
```

### 2. Add the embed to your profile README

```md
![Pac-Man contributions](https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_USERNAME/output/pacman.svg)
```

### 3. Trigger it

Run **Actions → Generate contribution animation → Run workflow** once to generate the first SVG. It will update automatically every day after that.

### Action inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github_user_name` | repository owner | Whose calendar to draw |
| `github_token` | `github.token` | Token for the GraphQL API |
| `svg_out_path` | `dist/pacman.svg` | Where to write the SVG |
| `color_scheme` | `dark` | `dark` or `light` background |
| `theme` | `pacman` | Built-in id, or a path to a directory containing `theme.json` |
| `formation` | *(theme's own)* | `single` or `train` |

Outputs: `svg_path`, `theme`, `formation`.

## CLI

The command is `git-viz`. From a clone, `npm link` puts it on your PATH — or run
`node packages/cli/dist/cli.js` directly.

```bash
npm install && npm run build
npm link --workspace packages/cli    # optional: installs the `git-viz` command

git-viz --user YOUR_NAME --token "$GH_TOKEN" --theme dogs
```

```
  -u, --user <login>        GitHub username to draw (env: USERNAME)
  -t, --token <token>       GitHub API token (env: GH_TOKEN)
  -o, --out <path>          Where to write the SVG (default: dist/pacman.svg)
      --theme <id|dir>      Skin to use, or a directory containing theme.json
  -f, --formation <mode>    single (one figure) or train (figures following)
  -c, --color-scheme <mode> dark or light
      --theme-path <dir>    Extra directory to search for installed themes
      --contributions <file> Read the calendar from a JSON file instead of the API
      --list-themes         List the available themes and exit
  -q, --quiet               Only report errors
  -h, --help                Show help
```

`--contributions` takes a saved calendar and skips the API entirely, which is the
quick way to iterate on a theme without a token:

```bash
git-viz --contributions calendar.json \
  --theme ./themes/example-shapes --formation train --out preview.svg
```

## Bringing your own artwork

A theme is a directory with a `theme.json` manifest and some SVG files — no code.
[docs/themes.md](docs/themes.md) is the full format; `themes/example-shapes/` is a
complete theme built from inline markup that you can copy as a starting point.

The short version: name your artwork in `sprites`, say what the leader eats in
`collectibles`, and describe who walks the path in `figures`.

```jsonc
{
  "schemaVersion": 1,
  "id": "my-theme",
  "name": "My Theme",
  "sprites": {
    "hero_right": { "file": "sprites/hero_right.svg" },
    "hero_left":  { "from": "hero_right", "flipX": true },
    "snack":      { "file": "sprites/snack.svg", "scale": 0.75 }
  },
  "collectibles": { "pellet": "snack" },
  "figures": {
    "leader": {
      "sprites": { "right": "hero_right", "up": "hero_right",
                   "left": "hero_left",  "down": "hero_left" }
    }
  }
}
```

```bash
git-viz --theme ./my-theme --contributions calendar.json
```

Artwork is loaded as untrusted input: scripts, event handlers and external
references are stripped, ids are namespaced per sprite, and files must stay inside
the theme directory. Large artwork is emitted once as a `<symbol>` and referenced
per cell, so a detailed drawing costs its bytes once. See
[docs/themes.md](docs/themes.md) for the details and the warnings you may see.

Theme resolution order: an explicit directory path, then `./themes` and any
`--theme-path` / `GIT_VIZ_THEME_PATH` directory, then the built-in ids. This is
the seam a theme marketplace plugs into — installing a theme will mean dropping its
directory on that search path, with no change to the renderer, the CLI or the Action.

Since the search path includes `./themes` in the working directory, a theme committed
to your own profile repository works in the Action with no extra wiring:

```yaml
      - uses: actions/checkout@v4          # your repo, containing themes/my-theme/
      - uses: AnthonyBSong/git-contrib-viz@v1
        with:
          theme: my-theme
```

### A note on size

Detailed artwork makes a large SVG. The dogs' hand-traced sprites are ~60 KB each,
so `--theme dogs --formation single` produces ~180 KB and `--formation train` about
375 KB. Pac-Man's sprites are hand-written primitives and cost almost nothing.
Anything over 512 KB of artwork earns a warning.

## Project structure

```
action.yml                          — GitHub Action definition
dist/index.js                       — Bundled action entry point (auto-built)
docs/themes.md                      — Theme manifest format
themes/example-shapes/              — Reference theme, inline markup only
scripts/test.js                     — Test suite (npm test)
.github/workflows/
  main.yml                          — Self-test on AnthonyBSong's contributions
  build.yml                         — Tests and rebuilds dist/ on changes
packages/
  github-contributions/             — GraphQL API client
  theme/                            — Manifest format, sprite resolution, registry
  grid/                             — Grid builder + DFS path algorithm
  svg-creator/                      — Positions and animates a theme's sprites
  generator/                        — Pipeline shared by the CLI and the Action
  cli/                              — Command-line front-end
  action/                           — GitHub Action front-end
assets/
  pacman-kit/                       — Pac-Man reference artwork
  doggie-kit/                       — Dog and biscuit artwork (used by the dogs theme)
```

The split that matters: `grid` decides *what kind* of thing is in each cell,
`theme` decides what that looks like, and `svg-creator` owns timing and geometry
without knowing about either Pac-Man or dogs. Adding a skin is a manifest, not a
code change.

## Local development

```bash
npm install
npm run build
npm test

# generate without a token, using a saved calendar
git-viz --contributions calendar.json --out dist/pacman.svg
open dist/pacman.svg
```

Inspired by [Platane/snk](https://github.com/Platane/snk), reimagined with maze-path
traversal, a themeable sprite layer, and whatever artwork you want walking it.
