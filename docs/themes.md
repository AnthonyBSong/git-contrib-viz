# Writing a theme

A theme is the skin of the animation: the artwork, what gets eaten, and who walks
the path. Themes are **data, not code** — a directory with a `theme.json` manifest
and some SVG files. The built-in Pac-Man and Doggie kits are written against this
same format and use no capability your own theme lacks.

```
my-theme/
  theme.json
  sprites/
    hero_right.svg
    snack.svg
```

Preview it without a token or a GitHub Action:

```bash
# a saved calendar: {"weeks":[{"contributionDays":[{"contributionCount":3}, …]}, …]}
npx git-viz --theme ./my-theme --contributions calendar.json --out preview.svg
```

Drop the directory in `./themes` (or any directory passed to `--theme-path`, or
listed in `GIT_VIZ_THEME_PATH`) and you can refer to it by id instead:

```bash
npx git-viz --theme my-theme --formation train
```

`themes/example-shapes` in this repository is a complete, dependency-free theme
built entirely from inline markup — the shortest thing to copy from.

## The manifest

```jsonc
{
  "schemaVersion": 1,             // required, always 1
  "id": "my-theme",               // required, the --theme value
  "name": "My Theme",             // required, shown in the SVG <title>
  "description": "…",
  "author": "you",
  "homepage": "https://…",

  "layout": {
    "cellSize": 14,               // sprite canvas, one grid cell (default 14)
    "cellGap": 2,                 // gap between cells (default 2)
    "padding": 20,                // border around the grid (default 20)
    "stepDuration": 0.08          // seconds per path step (default 0.08)
  },

  "background": { "dark": "#0d1117", "light": "#ffffff" },

  "sprites": { /* see below */ },

  "terrain": {
    "wall": "hedge",              // inactive day walled in by other inactive days
    "floor": "ground"             // inactive day the leader walks through
  },                              // both optional — omit to draw nothing

  "collectibles": {
    "pellet": "snack",            // required: what sits on every active day
    "bonus": {                    // optional: a rarer treat
      "sprite": "golden_snack",
      "rate": 0.025               // fraction of active days, 0–1
    }
  },

  "figures": {
    "leader": { "sprite": "hero_right" },
    "followers": [ /* FigureSpec… */ ],
    "followerSpacing": 4          // steps between figures in a train (default 4)
  },

  "defaultFormation": "single"    // "single" or "train"
}
```

Omit `collectibles.bonus` and the grid never creates a bonus cell at all — that is
how the Doggie Kit ends up with biscuits and no cherries. The rate lives in the
theme, not in the grid, so this is one field rather than a code path.

## Sprites

Each entry in `sprites` gives exactly one source:

| Field | Meaning |
| --- | --- |
| `file` | An `.svg` file, path relative to the theme directory. |
| `inline` | SVG markup written straight into the manifest. |
| `from` | Derive from another sprite in this theme. |

Plus optional modifiers:

| Field | Meaning |
| --- | --- |
| `flipX`, `flipY` | Mirror the artwork about the cell's centre. Use with `from`. |
| `scale` | Size multiplier inside the cell. `1` fills it; `0.75` leaves a margin. |
| `viewBox` | Override the source coordinate box. |
| `series` | Direction-dependent placeholder values — see below. |

### File sprites versus inline sprites

The distinction is about size, and it is automatic:

- Artwork with a **viewBox** (every `file` sprite, effectively) has its own
  coordinate system. It is emitted **once** as a `<symbol>` and drawn with `<use>`,
  scaled to fit the cell with its aspect ratio preserved. A 60 KB drawing costs
  60 KB whether it appears once or three hundred times.
- Markup with **no viewBox** is assumed to be in cell coordinates already — a
  `14×14` box with `(0,0)` at the cell's top-left — and is pasted at each use site.
  Cheap for small primitives, and it can carry its own `<animate>` elements.

So a hand-drawn dot belongs `inline`, and a traced illustration belongs in a `file`.

### Deriving poses

A theme that ships one facing gets the other for free. The derived sprite reuses the
base sprite's `<symbol>`, so mirroring costs no extra bytes:

```jsonc
"sprites": {
  "hero_right": { "file": "sprites/hero_right.svg" },
  "hero_left":  { "from": "hero_right", "flipX": true }
}
```

## Figures

A figure is something that moves along the path. The leader eats; followers trail it.

```jsonc
{
  "id": "corgi",
  "sprites": {                    // per-direction artwork
    "right": "corgi_right",
    "up":    "corgi_right",       // vertical travel usually reads as sideways
    "left":  "corgi_left",
    "down":  "corgi_left"
  },
  "sprite": "corgi_right",        // shorthand: the same sprite for all directions
  "rotate": false,                // rotate the artwork to face the heading
  "offset": 8,                    // steps behind the leader (followers only)
  "vars": { "color": "#FF0000" }  // fills {{placeholders}} in this figure's sprites
}
```

Two ways to face the direction of travel, and the choice matters:

- **`rotate: true`** spins the artwork (right 0°, down 90°, left 180°, up 270°).
  Correct only for something radially symmetric, like Pac-Man. A dog rotated 90°
  is a dog on its side.
- **Per-direction sprites** swap the artwork instead. Directions that share a
  sprite cost nothing; a figure whose four directions resolve to one sprite is
  drawn once, with no swapping at all.

`offset` is for followers only — the leader must stay in lockstep with the path,
since collectibles disappear on the step they are eaten at. `offset` defaults to
`followerSpacing × (position + 1)`, which is what makes a train
walk in lockstep — each follower simply occupies where the leader was N steps ago.

## Placeholders

Sprite markup may contain `{{name}}` tokens:

| Token | Filled with |
| --- | --- |
| `{{children}}` | Where injected markup goes — most importantly the fade a collectible plays when it is eaten. Sprites without it get wrapped in a `<g>`, which works but gives you less control. |
| `{{anything}}` | The matching key from the figure's `vars`. |
| `{{keyTimes}}`, `{{dur}}` | The shared animation timeline, for sprites that animate themselves. |
| a `series` key | A per-step list built from the figure's heading. |

A **series** is how artwork reacts to its own direction without the renderer knowing
anything about it. Pac-Man's ghosts use one to make their pupils track where they are
going:

```jsonc
"ghost": {
  "inline": "<rect y=\"6\" width=\"1\" height=\"2\"><animate attributeName=\"x\" values=\"{{pupil}}\" keyTimes=\"{{keyTimes}}\" dur=\"{{dur}}s\" repeatCount=\"indefinite\" calcMode=\"discrete\"/></rect>",
  "series": { "pupil": { "right": 4, "left": 2, "up": 4, "down": 2 } }
}
```

An unresolved placeholder is an error naming the sprite and the token, not a silently
broken drawing.

## What happens to your artwork

Theme artwork is treated as untrusted, because a published SVG runs inside whoever
embeds it. Before your drawing is used:

- `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<audio>` and
  `<video>` elements are removed, along with any `on*` event handler attributes.
- References must point inside the document. `href`/`xlink:href`/`url()` targets
  that are not a `#fragment` are dropped — so no remote images, no tracking pixels,
  no `javascript:`. Base64 `data:image/*` URIs are allowed.
- Every `id` is prefixed with the sprite's name, and references to it rewritten, so
  two sprites that both define `#gradient1` do not steal each other's paint.
- `<style>` rules are scoped under the sprite's own id. At-rules such as
  `@keyframes` cannot be scoped this way; they stay global and are reported as a
  warning. Presentation attributes are the safer choice.
- Tags are balanced: stray closing tags are dropped and unclosed elements closed.
- Files must be `.svg`, must live inside the theme directory, and are capped at
  4 MB each. Total artwork over 512 KB earns a warning, because a README has to
  serve it.

Anything changed or refused is reported — the CLI prints it, and the Action logs it
as a workflow warning. A run that produces warnings still produces an SVG.

## Validation

Manifests are checked before anything is drawn, and errors name the field at fault:

```
theme "my-theme" (/path/to/my-theme): collectibles.pellet refers to unknown
sprite "snacks" (declared: snack, hero_right, hero_left)
```

Checked: the schema version, a usable `id` and `name`, that every sprite reference
resolves, that exactly one source is given per sprite, that `from` chains do not
loop, that rates are fractions and sizes are positive, and that file paths stay
inside the theme directory.

## A marketplace, later

Nothing above is specific to the themes this repository ships. Installing a theme
from a marketplace means putting its directory somewhere on the search path; the
renderer, the CLI and the Action need no changes to draw it. The pieces already in
place for that are the manifest format, the search path, the containment and
sanitizing rules, and validation errors aimed at a theme author rather than at us.
