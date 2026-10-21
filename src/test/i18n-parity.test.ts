import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { EN, EN_AREAS } from "@/lib/i18n/en";

/**
 * Paridad del inglés: cada texto fuente en español que el código pasa por la capa de
 * idioma tiene que tener su traducción, con los mismos `{placeholders}`. Recorre todo
 * `src/` (sin tests ni tipos generados) y junta los literales de:
 * `t("…")`, `tk("…")`, `translate(locale, "…")`, `browserTranslate("…")`,
 * `new ApiRequestError("…"` y `apiError(response, "…")`.
 */
// Vitest corre desde la raíz del frontend; en jsdom `import.meta.url` no es `file:`.
const SRC = join(process.cwd(), "src");
const SKIP = [/[/\\]test[/\\]/, /[/\\]lib[/\\]api[/\\]generated\.ts$/, /[/\\]lib[/\\]i18n[/\\]en[/\\]/];
const CALLS = [
  /\b(?:t|tk|browserTranslate)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
  /\btranslate\(\s*[\w.]+\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
  /\bnew ApiRequestError\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
  /\bapiError\(\s*\w+\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !SKIP.some((pattern) => pattern.test(path)) ? [path] : [];
  });
}

function decode(literal: string): string {
  if (literal.startsWith("'")) {
    return JSON.parse(`"${literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string;
  }
  return JSON.parse(literal) as string;
}

/** Blanquea comentarios (ejemplos en JSDoc) sin mover los números de línea. */
function withoutComments(content: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return content.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function collect(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const content = withoutComments(readFileSync(file, "utf8"));
    for (const pattern of CALLS) {
      for (const match of content.matchAll(pattern)) {
        const source = decode(match[1]);
        const where = `${relative(SRC, file)}:${content.slice(0, match.index).split("\n").length}`;
        found.set(source, [...(found.get(source) ?? []), where]);
      }
    }
  }
  return found;
}

describe("i18n — paridad del inglés", () => {
  const used = collect();

  it("encuentra los textos fuente del código", () => {
    expect(used.size).toBeGreaterThan(10);
  });

  it("cada texto fuente tiene traducción al inglés", () => {
    const missing = [...used.entries()]
      .filter(([source]) => !Object.prototype.hasOwnProperty.call(EN, source))
      .map(([source, where]) => `${JSON.stringify(source)}  ← ${where[0]}`);
    expect(missing, `Faltan ${missing.length} traducciones en src/lib/i18n/en/*.ts`).toEqual([]);
  });

  it("un mismo texto repetido en dos áreas se traduce igual en ambas", () => {
    const seen = new Map<string, readonly [string, string]>();
    const conflicts: string[] = [];
    for (const [area, dictionary] of Object.entries(EN_AREAS)) {
      for (const [source, english] of Object.entries(dictionary)) {
        const previous = seen.get(source);
        if (previous && previous[1] !== english) {
          conflicts.push(`${JSON.stringify(source)}: ${previous[0]}=${JSON.stringify(previous[1])} ≠ ${area}=${JSON.stringify(english)}`);
        }
        if (!previous) seen.set(source, [area, english]);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("las traducciones conservan los mismos {placeholders} y no están vacías", () => {
    const broken = Object.entries(EN)
      .filter(([source, english]) => !english.trim() || placeholders(source).join() !== placeholders(english).join())
      .map(([source, english]) => `${JSON.stringify(source)} → ${JSON.stringify(english)}`);
    expect(broken).toEqual([]);
  });
});
