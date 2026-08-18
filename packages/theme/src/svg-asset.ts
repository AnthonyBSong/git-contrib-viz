/**
 * Reads third-party SVG artwork and makes it safe to paste into our document.
 *
 * Theme artwork is untrusted: once themes can be installed from a marketplace,
 * an `.svg` is arbitrary markup running inside whatever page embeds the result.
 * Everything here is about making that harmless while changing the drawing as
 * little as possible:
 *
 *  - active content is removed (`<script>`, `<foreignObject>`, `on*` handlers);
 *  - references may only point inside this document, so artwork cannot phone
 *    home or leak a referrer when the animation renders;
 *  - every `id` is prefixed, so two sprites that both define `#gradient1` do not
 *    quietly steal each other's paint;
 *  - `<style>` rules are scoped to the sprite that declared them, so one theme's
 *    `path { fill: red }` cannot repaint the rest of the chart;
 *  - tags are balanced, so a hand-edited file cannot break the document around it.
 */

/** Removed elements, with everything they contain. */
const FORBIDDEN_ELEMENTS = ["script", "foreignObject", "iframe", "object", "embed", "audio", "video"];

/** URI schemes an attribute may point at, besides same-document `#fragment`. */
const ALLOWED_URI = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i;

export interface SvgAsset {
  /** Drawing content, sanitized — no enclosing `<svg>` element. */
  inner: string;
  /** The source's own coordinate box, when it declared one. */
  viewBox?: string;
}

/** Collects everything the loader changed or refused, for the caller to surface. */
export interface SanitizeReport {
  warnings: string[];
}

/**
 * Pulls the drawable content out of an SVG document.
 *
 * Tolerates the junk real-world exports carry: repeated XML declarations, a
 * DOCTYPE, wrapper elements outside the root `<svg>`. Content outside the root
 * element is dropped rather than trusted — so a file whose wrapper `<g>` is
 * mis-nested (a common flip-by-hand mistake) loads as its *unflipped* artwork
 * instead of emitting unbalanced markup. That case is reported, because the
 * drawing silently loses whatever the stray wrapper was doing.
 */
export function parseSvgDocument(source: string, report?: SanitizeReport): SvgAsset {
  const text = stripPreamble(source);

  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) {
    // Not a document — treat the whole thing as bare markup in cell coordinates.
    return { inner: text.trim() };
  }

  if (/<[a-z]/i.test(text.slice(0, open.index))) {
    report?.warnings.push("markup before the root <svg> was dropped (mis-nested wrapper element)");
  }

  const close = text.lastIndexOf("</svg>");
  const inner =
    close === -1 || close < open.index
      ? text.slice(open.index + open[0].length)
      : text.slice(open.index + open[0].length, close);

  const viewBox = attrValue(open[0], "viewBox") ?? boxFromSize(open[0]);
  return { inner: inner.trim(), viewBox };
}

function stripPreamble(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

/** Falls back to `width`/`height` when the root `<svg>` has no viewBox. */
function boxFromSize(openTag: string): string | undefined {
  const w = parseFloat(attrValue(openTag, "width") ?? "");
  const h = parseFloat(attrValue(openTag, "height") ?? "");
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  return `0 0 ${w} ${h}`;
}

export function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? m[2] ?? m[3] : undefined;
}

/**
 * Strips active content and rewrites every identifier and reference so the
 * markup is inert and cannot collide with anything else in the document.
 *
 * @param idPrefix prepended to every `id` the markup declares.
 * @param scopeSelector CSS selector that `<style>` rules are scoped under, e.g.
 *        `#sprite-corgi`. Rules are left global when omitted.
 */
export function sanitizeSvgMarkup(
  markup: string,
  idPrefix: string,
  scopeSelector?: string,
  report?: SanitizeReport
): string {
  let out = stripPreamble(markup);

  for (const el of FORBIDDEN_ELEMENTS) {
    const before = out;
    out = out
      .replace(new RegExp(`<${el}\\b[^>]*>[\\s\\S]*?</${el}\\s*>`, "gi"), "")
      .replace(new RegExp(`<${el}\\b[^>]*/>`, "gi"), "");
    if (before !== out) report?.warnings.push(`removed <${el}> element(s)`);
  }

  // Nested <svg> elements bring their own viewport and coordinate system; flatten
  // them to plain groups so the sprite stays one drawing in cell coordinates.
  out = out.replace(/<svg\b[^>]*>/gi, "<g>").replace(/<\/svg\s*>/gi, "</g>");

  const ids = collectIds(out);
  const rename = (id: string) => `${idPrefix}-${id}`;

  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_all, css: string) =>
    `<style>${scopeCss(css, ids, rename, scopeSelector, report)}</style>`
  );

  out = out.replace(/<[^>]*>/g, (tag) => cleanTag(tag, ids, rename, report));

  return balanceTags(out, report);
}

function collectIds(markup: string): Set<string> {
  const ids = new Set<string>();
  const re = /\sid\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const id = (m[2] ?? m[3] ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

function cleanTag(
  tag: string,
  ids: Set<string>,
  rename: (id: string) => string,
  report?: SanitizeReport
): string {
  // Event handlers: any attribute named on*.
  let out = tag.replace(/\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/g, () => {
    report?.warnings.push("removed inline event handler");
    return "";
  });

  // Identifier declarations.
  out = out.replace(/(\sid\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_all, lead: string, _q, dq?: string, sq?: string) => {
    const id = (dq ?? sq ?? "").trim();
    return id ? `${lead}"${rename(id)}"` : "";
  });

  // References: same-document fragments are rewritten, everything else dropped.
  out = out.replace(
    /(\s(?:xlink:href|href)\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (all, lead: string, _q, dq?: string, sq?: string) => {
      const value = (dq ?? sq ?? "").trim();
      if (value.startsWith("#")) {
        const id = value.slice(1);
        return ids.has(id) ? `${lead}"#${rename(id)}"` : all;
      }
      if (ALLOWED_URI.test(value)) return all;
      report?.warnings.push(`removed external reference: ${truncate(value)}`);
      return "";
    }
  );

  return rewriteUrlRefs(out, ids, rename, report);
}

/** Rewrites `url(#id)` inside paint and style attributes; drops remote `url()`. */
function rewriteUrlRefs(
  text: string,
  ids: Set<string>,
  rename: (id: string) => string,
  report?: SanitizeReport
): string {
  return text.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (all, _q, target: string) => {
    const value = target.trim();
    if (value.startsWith("#")) {
      const id = value.slice(1);
      return ids.has(id) ? `url(#${rename(id)})` : all;
    }
    if (ALLOWED_URI.test(value)) return all;
    report?.warnings.push(`removed external url(): ${truncate(value)}`);
    return "none";
  });
}

/**
 * Scopes a sprite's CSS under `scopeSelector` and renames the ids it references.
 * At-rules are left alone — they cannot be scoped by prefixing — and reported so
 * a theme author knows their keyframes are shared with the whole document.
 */
function scopeCss(
  css: string,
  ids: Set<string>,
  rename: (id: string) => string,
  scopeSelector: string | undefined,
  report?: SanitizeReport
): string {
  // Angle brackets inside CSS would be read as markup by the tag passes that
  // follow, so they are neutralized — which does change a child combinator into a
  // descendant one, hence the warning rather than a silent rewrite.
  let out = css;
  if (/[<>]/.test(out)) {
    report?.warnings.push("angle brackets in a <style> block were removed (use descendant selectors)");
    out = out.replace(/[<>]/g, " ");
  }
  out = rewriteUrlRefs(out, ids, rename, report);
  out = out.replace(/#([A-Za-z_][\w:.-]*)/g, (all, id: string) => (ids.has(id) ? `#${rename(id)}` : all));

  if (!scopeSelector) return out;

  return out.replace(/(^|})([^{}]+)(\{)/g, (all, close: string, selectors: string, brace: string) => {
    const trimmed = selectors.trim();
    if (!trimmed) return all;
    if (trimmed.startsWith("@")) {
      report?.warnings.push(`at-rule left unscoped: ${truncate(trimmed)}`);
      return all;
    }
    const scoped = trimmed
      .split(",")
      .map((s) => `${scopeSelector} ${s.trim()}`)
      .join(", ");
    return `${close}${scoped} ${brace}`;
  });
}

/**
 * Drops closing tags with no matching open tag and closes anything left open, so
 * a malformed sprite can never leak its nesting into the surrounding document.
 *
 * SVG is XML, which has no void elements: a tag either self-closes with `/>` or
 * has a closing tag. `<circle>…</circle>` wrapping an `<animate>` is ordinary and
 * must survive untouched.
 */
function balanceTags(markup: string, report?: SanitizeReport): string {
  const stack: string[] = [];
  let stray = 0;

  const out = markup.replace(/<\/?([a-zA-Z][\w:.-]*)\b[^>]*>/g, (tag, name: string) => {
    if (tag.startsWith("</")) {
      const at = stack.lastIndexOf(name);
      if (at === -1) {
        stray++;
        return "";
      }
      stack.length = at;
      return tag;
    }
    if (!/\/>$/.test(tag)) stack.push(name);
    return tag;
  });

  if (stray > 0) report?.warnings.push(`dropped ${stray} unmatched closing tag(s)`);
  if (stack.length > 0) report?.warnings.push(`closed ${stack.length} unclosed element(s)`);

  return out + stack.reverse().map((name) => `</${name}>`).join("");
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}
