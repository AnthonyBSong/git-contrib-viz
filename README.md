# git-pacman
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/AnthonyBSong/git-pacman/main.yml?label=action&style=flat-square)](https://github.com/AnthonyBSong/git-pacman/actions/)
[![GitHub release](https://img.shields.io/github/release/AnthonyBSong/git-pacman.svg?style=flat-square)](https://github.com/AnthonyBSong/git-pacman/releases/latest)
[![GitHub App](https://img.shields.io/badge/app-git--pacman--viz-blue?logo=github&style=flat-square)](https://github.com/apps/git-pacman-viz)
![type definitions](https://img.shields.io/npm/types/typescript?style=flat-square)

![Pac-Man contributions](assets/figures/pacman.svg)

Turns your GitHub contribution chart into an animated Pac-Man animation. Can be embedded in any GitHub profile README.

## How it works

1. A GitHub Action fetches your contribution calendar via the GraphQL API.
2. Active days become dots or cherries (active days * 2.5%) on a 52×7 grid; inactive days are empty cells.
3. A DFS traversal computes a set of ordered path through all active cells and chooses one where the most Pacman walls can be generated.
4. An animated SVG is generated: Pac-Man moves along the path eating dots/cherries, with ghosts trailing behind.
5. The SVG is pushed to the `output` branch and served via raw.githubusercontent.com.

## Usage Guide

### 1. Create a workflow in your profile repo

In your `YOUR_USERNAME/YOUR_USERNAME` profile repository, create `.github/workflows/pacman.yml`:

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

If you would like, you can replace our sprites with your own artwork:

| File | Used for |
|------|----------|
| `pacman.svg` | Pac-Man character (14×14px, facing right) |
| `ghost_{right,left}_{blue,red,pink,yellow}.svg` | Ghost variants per direction and color |
| `dot.svg` | Active contribution day pellet |
| `cherry.svg` | Rare pickup at ~2.5% of active dots |
| `empty.svg` | Inactive day background cell |

After replacing sprites, update the matching shape elements in
[packages/svg-creator/src/index.ts](packages/svg-creator/src/index.ts)
— everything renders inline so the SVG stays self-contained.

## Project structure

```
.github/workflows/main.yml          — Scheduled GitHub Action
packages/
  github-contributions/             — GraphQL API client
  grid/                             — Grid builder + DFS path algorithm
  svg-creator/                      — Animated SVG generator
  action/                           — Action entry point (ties it all together)
assets/sprites/                     — Placeholder sprite artwork
```

## Local development

```bash
npm install
npm run build
GH_TOKEN=<token> USERNAME=AnthonyBSong OUTPUT_PATH=dist/pacman.svg \
  node packages/action/dist/index.js
open dist/pacman.svg
```

## GitHub App

[git-pacman-viz](https://github.com/apps/git-pacman-viz) is the GitHub App that powers this project.
It requests only `Contents: Read & Write` on the repositories it is installed on — just enough to push the generated `pacman.svg` to your `output` branch. No personal access token or extra secrets required.

Inspired by [Platane/snk](https://github.com/Platane/snk), reimagined with Pac-Man path traversal, ghost sprites, dots, cherries, and maze walls.
