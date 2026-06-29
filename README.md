# git-contrib-viz
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/AnthonyBSong/git-pacman/main.yml?label=action&style=flat-square)](https://github.com/AnthonyBSong/git-pacman/actions/)
[![GitHub release](https://img.shields.io/github/release/AnthonyBSong/git-pacman.svg?style=flat-square)](https://github.com/AnthonyBSong/git-pacman/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-git--pacman--viz-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/git-pacman-viz)
![type definitions](https://img.shields.io/npm/types/typescript?style=flat-square)

![Pac-Man contributions](https://raw.githubusercontent.com/AnthonyBSong/git-pacman/output/pacman.svg)

Turns your GitHub contribution chart into an animated Pac-Man animation. Can be embedded in any GitHub profile README.

## How it works

1. A GitHub Action fetches your contribution calendar via the GraphQL API.
2. Active days become dots or cherries (~2.5% of active days) on a 52×7 grid; inactive days are empty cells or walls.
3. A DFS traversal computes a path through all active cells, maximizing the number of maze walls that can be placed.
4. An animated SVG is generated: Pac-Man moves along the path eating dots and cherries, with ghosts trailing behind.
5. The SVG is pushed to the `output` branch and served via raw.githubusercontent.com.

## Usage Guide

Add this to a workflow in your `YOUR_USERNAME/YOUR_USERNAME` profile repository:

```yaml
- uses: AnthonyBSong/git-pacman@v1
  with:
    github_user_name: ${{ github.repository_owner }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### 1. Create `.github/workflows/pacman.yml`:

```yaml
name: Generate Pac-Man contribution animation

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

      - uses: AnthonyBSong/git-pacman@v1
        with:
          github_user_name: ${{ github.repository_owner }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          svg_out_path: dist/pacman.svg

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

Run **Actions → Generate Pac-Man contribution animation → Run workflow** once to generate the first SVG. It will update automatically every day after that.

## Customizing sprites

To use your own personalized spirits, you can fork this repo and update the shape elements in [packages/svg-creator/src/index.ts](packages/svg-creator/src/index.ts). All sprites render inline so the SVG stays self-contained. Reference files are in [assets/sprites/](assets/sprites/):

| File | Used for |
|------|----------|
| `pacman.svg` | Pac-Man character (14×14px, facing right) |
| `ghost_{right,left}_{blue,red,pink,yellow}.svg` | Ghost variants per direction and color |
| `dot.svg` | Active contribution day pellet |
| `cherry.svg` | Rare pickup at ~2.5% of active dots |
| `empty.svg` | Inactive day background cell |

## Project structure

```
action.yml                          — GitHub Action definition
dist/index.js                       — Bundled action entry point (auto-built)
.github/workflows/
  main.yml                          — Self-test on AnthonyBSong's contributions
  build.yml                         — Auto-rebuilds dist/ on package changes
packages/
  github-contributions/             — GraphQL API client
  grid/                             — Grid builder + DFS path algorithm
  svg-creator/                      — Animated SVG generator
  action/                           — Action entry point
assets/sprites/                     — Sprite reference artwork
```

## Local development

```bash
npm install
npm run build
GH_TOKEN=<token> USERNAME=AnthonyBSong OUTPUT_PATH=dist/pacman.svg \
  node packages/action/dist/index.js
open dist/pacman.svg
```

Inspired by [Platane/snk](https://github.com/Platane/snk), reimagined with Pac-Man path traversal, ghost sprites, dots, cherries, and maze walls.
