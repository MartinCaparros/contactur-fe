import { DEFAULT_LOCALE, type Locale } from "./config";
import { EN } from "./en";

export type TranslateParams = Readonly<Record<string, string | number>>;
/** Traduce un texto fuente en español; `{nombre}` se reemplaza por `params.nombre`. */
export type Translate = (source: string, params?: TranslateParams) => string;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match);
}

/**
 * Texto en el idioma pedido. Si falta la traducción inglesa se muestra el español (no
 * se rompe la pantalla) y `i18n-parity.test.ts` lo detecta antes de llegar a CI.
 */
export function translate(locale: Locale, source: string, params?: TranslateParams): string {
  const template = locale === "en" ? EN[source] ?? source : source;
  return interpolate(template, params);
}

export function translator(locale: Locale = DEFAULT_LOCALE): Translate {
  return (source, params) => translate(locale, source, params);
}

/**
 * Marca un texto fuente definido fuera de un render (mapas de etiquetas, constantes):
 * devuelve el mismo español y deja el literal visible para el test de paridad. Se
 * traduce donde se muestra: `t(STATUS_LABELS[status])`.
 */
export function tk(source: string): string {
  return source;
}
