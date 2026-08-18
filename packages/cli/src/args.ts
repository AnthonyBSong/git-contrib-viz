/**
 * Argument parsing. Hand-rolled on purpose: the project ships as a bundled GitHub
 * Action, and a flag parser is not worth a dependency in that bundle.
 */

export interface FlagSpec {
  /** Long name, without the leading dashes. */
  name: string;
  /** Single-letter alias. */
  short?: string;
  /** A flag that takes no value. */
  boolean?: boolean;
  /** May be repeated; collects into an array. */
  repeatable?: boolean;
  /** Shown by `--help`. */
  help: string;
  /** Value placeholder for the help text, e.g. `<path>`. */
  value?: string;
}

export interface ParsedArgs {
  flags: Record<string, string | string[] | boolean>;
  /** Arguments that were not flags. */
  positional: string[];
}

export function parseArgs(argv: string[], specs: FlagSpec[]): ParsedArgs {
  const byName = new Map<string, FlagSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
    if (spec.short) byName.set(spec.short, spec);
  }

  const flags: Record<string, string | string[] | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    // Accept --name=value as well as --name value.
    const bare = arg.replace(/^--?/, "");
    const eq = bare.indexOf("=");
    const key = eq === -1 ? bare : bare.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : bare.slice(eq + 1);

    const spec = byName.get(key);
    if (!spec) throw new UsageError(`unknown option "${arg}"`);

    if (spec.boolean) {
      if (inlineValue !== undefined && !/^(true|false)$/i.test(inlineValue)) {
        throw new UsageError(`--${spec.name} does not take a value`);
      }
      flags[spec.name] = inlineValue === undefined ? true : inlineValue.toLowerCase() === "true";
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new UsageError(`--${spec.name} needs a value`);

    if (spec.repeatable) {
      const existing = flags[spec.name];
      flags[spec.name] = Array.isArray(existing) ? [...existing, value] : [value];
    } else {
      flags[spec.name] = value;
    }
  }

  return { flags, positional };
}

/** A mistake in how the command was invoked — reported with usage, not a stack. */
export class UsageError extends Error {}

/** Renders the flag list into aligned help text. */
export function formatFlags(specs: FlagSpec[]): string {
  const left = specs.map((spec) => {
    const short = spec.short ? `-${spec.short}, ` : "    ";
    const value = spec.boolean ? "" : ` ${spec.value ?? "<value>"}`;
    return `  ${short}--${spec.name}${value}`;
  });
  const width = Math.max(...left.map((l) => l.length));
  return specs.map((spec, i) => `${left[i].padEnd(width + 2)}${spec.help}`).join("\n");
}

/** Reads a flag that must be one of a fixed set of words. */
export function enumFlag<T extends string>(
  value: string | string[] | boolean | undefined,
  allowed: readonly T[],
  flagName: string
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new UsageError(`--${flagName} needs a value`);
  const match = allowed.find((a) => a === value.toLowerCase());
  if (!match) {
    throw new UsageError(`--${flagName} must be one of: ${allowed.join(", ")} (got "${value}")`);
  }
  return match;
}

export function stringFlag(value: string | string[] | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function listFlag(value: string | string[] | boolean | undefined): string[] | undefined {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : undefined;
}
