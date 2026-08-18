/**
 * The doggie kit: dogs working through a yard of biscuits.
 *
 * This theme is the file-based half of the sprite model, and it is deliberately
 * built the way an installed theme would be — artwork on disk, referenced by
 * relative path, with each left-facing pose derived by mirroring the right-facing
 * one. Nothing here reaches for a capability a third-party theme lacks.
 *
 * Dogs are not radially symmetric, so they never rotate: a dog heading up keeps
 * its feet down and simply faces the way Pac-Man's ghosts do (up reads as right,
 * down as left).
 */

import type { FigureSpec, SpriteSpec, ThemeManifest } from "../types";

/** Artwork lives under `assets/doggie-kit/`, the directory this theme loads from. */
const BREEDS = ["corgi", "shiba", "dachshund", "german"] as const;

/** A right-facing sprite from file, plus its mirrored left-facing twin. */
function breedSprites(breed: string): Record<string, SpriteSpec> {
  return {
    [`${breed}_right`]: { file: `sprites/${breed}_right.svg` },
    // Mirrors the resolved right-facing sprite: same <symbol>, no extra bytes.
    [`${breed}_left`]: { from: `${breed}_right`, flipX: true },
  };
}

/** Vertical travel reads as sideways, matching how the ghosts handle it. */
function dogFigure(breed: string): FigureSpec {
  return {
    id: breed,
    sprites: {
      right: `${breed}_right`,
      up: `${breed}_right`,
      left: `${breed}_left`,
      down: `${breed}_left`,
    },
  };
}

export const dogsTheme: ThemeManifest = {
  schemaVersion: 1,
  id: "dogs",
  name: "Doggie Kit",
  description: "A dog trotting through the yard eating biscuits. No cherries in sight.",
  background: { dark: "#0d1117", light: "#ffffff" },

  sprites: {
    ...BREEDS.reduce((all, breed) => ({ ...all, ...breedSprites(breed) }), {}),

    // Left a little small so neighbouring biscuits do not touch.
    biscuit: { file: "sprites/dogbiscuit.svg", scale: 0.75 },

    // The kit ships no terrain art, so the yard is drawn here: hedge blocks for
    // walls, and the same quiet cell as Pac-Man's corridors for the floor.
    hedge: {
      inline: `<rect x="1" y="1" width="12" height="12" rx="3"
    fill="#16281a" stroke="#4a7c3f" stroke-width="1.5"/>`,
    },
    ground: {
      inline: `<rect x="2" y="2" width="10" height="10" rx="2" fill="#161b22"/>`,
    },
  },

  terrain: { wall: "hedge", floor: "ground" },

  // Dogs eat biscuits, and only biscuits — omitting `bonus` means the grid never
  // promotes a day to a rare collectible at all.
  collectibles: { pellet: "biscuit" },

  figures: {
    leader: dogFigure("corgi"),
    followers: BREEDS.slice(1).map(dogFigure),
    followerSpacing: 4,
  },

  // One dog by default: the artwork is detailed, and four copies of it is a lot
  // of SVG to serve from a README. `--formation train` opts into the whole pack.
  defaultFormation: "single",
};
