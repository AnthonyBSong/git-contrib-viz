/**
 * The original skin: Pac-Man eating dots and cherries, four ghosts in tow.
 *
 * Every sprite here is inline markup in cell coordinates, which is what a
 * hand-drawn primitive wants to be — it costs a few dozen bytes per cell and can
 * carry its own animation, so the mouth chomps and the ghosts' pupils track
 * their heading without the renderer knowing anything about either.
 */

import type { ThemeManifest } from "../types";

/** Pixel-art cherry, traced from `assets/pacman-kit/sprites/cherry.svg`. */
const CHERRY = ((): string => {
  const t = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  const leaf = "#3a7d44";
  const flesh = "#cc1100";
  const shine = "#ff5555";
  return `<g>
    {{children}}
    ${t(6, 0, 2, 1, leaf)}
    ${t(5, 1, 1, 1, leaf)}${t(8, 1, 1, 1, leaf)}
    ${t(4, 2, 1, 1, leaf)}${t(9, 2, 1, 1, leaf)}
    ${t(3, 3, 1, 1, leaf)}${t(10, 3, 1, 1, leaf)}
    ${t(2, 4, 3, 1, flesh)}${t(9, 4, 3, 1, flesh)}
    ${t(1, 5, 5, 3, flesh)}${t(8, 5, 5, 3, flesh)}
    ${t(2, 8, 3, 1, flesh)}${t(9, 8, 3, 1, flesh)}
    ${t(2, 5, 1, 1, shine)}${t(9, 5, 1, 1, shine)}
  </g>`;
})();

/**
 * Pixel-art ghost. `{{color}}` comes from each ghost figure's `vars`, so one
 * sprite covers all four; `{{pupilLeft}}`/`{{pupilRight}}` are direction series
 * the renderer expands into a per-step `values` list, which is how the eyes end
 * up looking where the ghost is going.
 */
const GHOST = `<!-- Top dome -->
    <rect x="4"  y="0" width="6"  height="1" fill="{{color}}"/>
    <rect x="3"  y="1" width="8"  height="1" fill="{{color}}"/>
    <rect x="2"  y="2" width="10" height="1" fill="{{color}}"/>
    <rect x="1"  y="3" width="12" height="1" fill="{{color}}"/>
    <!-- Eye-row body (left edge, centre, right edge) -->
    <rect x="1"  y="4" width="1"  height="4" fill="{{color}}"/>
    <rect x="5"  y="4" width="3"  height="4" fill="{{color}}"/>
    <rect x="11" y="4" width="2"  height="4" fill="{{color}}"/>
    <!-- Main body rows 8-10 -->
    <rect x="1"  y="8" width="12" height="3" fill="{{color}}"/>
    <!-- Skirt: 3 feet bases (row 11) -->
    <rect x="1"  y="11" width="3" height="1" fill="{{color}}"/>
    <rect x="5"  y="11" width="3" height="1" fill="{{color}}"/>
    <rect x="9"  y="11" width="3" height="1" fill="{{color}}"/>
    <!-- Skirt: 3 feet tips (row 12) -->
    <rect x="1"  y="12" width="2" height="1" fill="{{color}}"/>
    <rect x="5"  y="12" width="2" height="1" fill="{{color}}"/>
    <rect x="9"  y="12" width="2" height="1" fill="{{color}}"/>
    <!-- Left eye white -->
    <rect x="2" y="4" width="3" height="4" fill="white"/>
    <!-- Left pupil — 2 when facing left, 4 when facing right -->
    <rect y="6" width="1" height="2" fill="#1a1a1a">
      <animate attributeName="x" values="{{pupilLeft}}"
        keyTimes="{{keyTimes}}" dur="{{dur}}s" repeatCount="indefinite" calcMode="discrete"/>
    </rect>
    <!-- Right eye white -->
    <rect x="8" y="4" width="3" height="4" fill="white"/>
    <!-- Right pupil — 8 when facing left, 10 when facing right -->
    <rect y="6" width="1" height="2" fill="#1a1a1a">
      <animate attributeName="x" values="{{pupilRight}}"
        keyTimes="{{keyTimes}}" dur="{{dur}}s" repeatCount="indefinite" calcMode="discrete"/>
    </rect>`;

/** Vertical travel reads as sideways for the eyes: up looks right, down looks left. */
const PUPIL_LEFT = { right: 4, left: 2, up: 4, down: 2 } as const;
const PUPIL_RIGHT = { right: 10, left: 8, up: 10, down: 8 } as const;

const GHOST_COLORS = [
  { id: "blinky", color: "#FF0000" },
  { id: "pinky", color: "#FFB8FF" },
  { id: "clyde", color: "#FFD700" },
  { id: "inky", color: "#29ABE2" },
];

export const pacmanTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "pacman",
  name: "Pac-Man",
  description: "Pac-Man eats dots and cherries with four ghosts trailing behind.",
  background: { dark: "#0d1117", light: "#ffffff" },

  sprites: {
    wall: {
      // Blue-outlined rect — classic Pac-Man maze wall look.
      inline: `<rect x="1" y="1" width="12" height="12" rx="1.5"
    fill="#0f1b3d" stroke="#3b82f6" stroke-width="1.5"/>`,
    },
    floor: {
      inline: `<rect x="2" y="2" width="10" height="10" rx="2" fill="#161b22"/>`,
    },
    dot: {
      inline: `<circle cx="7" cy="7" r="3.5" fill="#FFD700">{{children}}</circle>`,
    },
    cherry: { inline: CHERRY },
    pacman: {
      // Facing right, centred at (7,7); the mouth chomps on its own clock.
      inline: `<path fill="#FFD700">
        <animate attributeName="d"
          values="M7,7 L13,4 A6,6 0,1,0 13,10 Z;M7,7 L13,6.8 A6,6 0,1,0 13,7.2 Z;M7,7 L13,4 A6,6 0,1,0 13,10 Z"
          dur="0.3s" repeatCount="indefinite"/>
      </path>`,
    },
    ghost: {
      inline: GHOST,
      series: { pupilLeft: PUPIL_LEFT, pupilRight: PUPIL_RIGHT },
    },
  },

  terrain: { wall: "wall", floor: "floor" },
  collectibles: {
    pellet: "dot",
    bonus: { sprite: "cherry", rate: 0.025 },
  },

  figures: {
    // Pac-Man is radially symmetric, so rotating him to face his heading is right.
    leader: { id: "pacman", sprite: "pacman", rotate: true },
    followers: GHOST_COLORS.map(({ id, color }) => ({ id, sprite: "ghost", vars: { color } })),
    followerSpacing: 4,
  },

  defaultFormation: "train",
};
