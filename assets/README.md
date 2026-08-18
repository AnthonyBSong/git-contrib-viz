# Sprite kits

Artwork for the built-in themes. A "kit" is just a folder of sprites; what turns one
into a skin is a theme manifest — see [../docs/themes.md](../docs/themes.md).

## `pacman-kit/`

Reference artwork for the `pacman` theme. Its sprites are simple enough to be
hand-written primitives, so the theme keeps them as inline markup in
[`packages/theme/src/builtin/pacman.ts`](../packages/theme/src/builtin/pacman.ts)
rather than loading these files — that is what lets Pac-Man's mouth chomp and his
ghosts' pupils track their heading, which a static file cannot express.

These files are the drawings those primitives were traced from. Editing one does not
change the output; to change how Pac-Man looks, edit the theme's markup, or write
your own theme.

| File | Drawing |
|------|---------|
| `sprites/pacman.svg` | Pac-Man, facing right |
| `sprites/ghost_{right,left}_{red,pink,yellow,blue}.svg` | Ghost, per facing and color |
| `sprites/dot.svg` | The pellet on an active day |
| `sprites/cherry.svg` | The bonus, on ~2.5% of active days |
| `sprites/empty.svg` | An inactive day |
| `figures/` | Full-size source art |

## `doggie-kit/`

The artwork the `dogs` theme actually loads. Four breeds plus a biscuit, each drawn
facing right; the theme derives every left-facing pose by mirroring, so only the
`_right` files are referenced.

| File | Drawing |
|------|---------|
| `sprites/{corgi,shiba,dachshund,german}_right.svg` | Each breed, facing right |
| `sprites/{corgi,shiba,dachshund,german}_left.svg` | The same, pre-mirrored |
| `sprites/dogbiscuit.svg` | The biscuit, this theme's only collectible |

These are hand-traced and fairly large (~40–65 KB each), which is why the theme draws
one dog by default; `--formation train` sends all four and roughly triples the output.

## Adding artwork

Nothing here is privileged. A theme directory anywhere on the search path can point
at its own files and the renderer treats it identically — see
[../docs/themes.md](../docs/themes.md), and `../themes/example-shapes/` for a theme
that ships no files at all.
