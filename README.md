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

### 1. Fork this repo

Fork `AnthonyBSong/git-pacman` to your own account. The workflow will
automatically use your username via `github.repository_owner`.

### 2. Create and install the GitHub App

1. Go to **github.com → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set **Homepage URL** to your fork's URL
3. Disable webhooks
4. Permissions: `Contents: Read & Write`, `Metadata: Read-only`
5. Where can this be installed: **Any account**
6. Create the app, note the **App ID**, and generate a **private key** (downloads a `.pem`)
7. On the App page → **Install App** → install it on your fork

### 3. Add secrets to your fork

Go to your fork → **Settings → Secrets and variables → Actions**:
- **Secret**: `APP_ID`, **Value**: The number shown on your GitHub App page |
- **Secret**: `APP_PRIVATE_KEY`, **Value**: Full contents of the downloaded `.pem` file |

### 4. Trigger the Action

Run **Actions → Generate Pac-Man contribution animation → Run workflow**.

The Action runs automatically every day at midnight UTC after that.

### 5. Add to Personal Readme

After the Action runs, copy this into your profile `README.md`
(replace `YOUR_USERNAME` with your GitHub username):

```md
![Pac-Man contributions](https://raw.githubusercontent.com/YOUR_USERNAME/git-pacman/output/pacman.svg)
```

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
