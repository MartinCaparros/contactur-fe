/**
 * Idiomas de la interfaz. Español es el idioma por defecto y la fuente de los textos:
 * cada texto se escribe en español en el código y `en/` guarda su traducción (estilo
 * gettext). La elección viaja en la cookie `contactur_locale` (visitantes) y, con
 * sesión, también en la cuenta (`PATCH /me { locale }`), que manda al volver a entrar.
 * Este módulo no depende de React ni de Next: lo usan el layout (servidor), el BFF y
 * los componentes.
 */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "contactur_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Formato de fechas y números. `en-GB` conserva el orden día/mes del mercado argentino. */
export const INTL_LOCALES: Readonly<Record<Locale, string>> = { es: "es-AR", en: "en-GB" };

/** Valor guardado en `users.locale` (contrato: `es-AR` | `en`). */
export const ACCOUNT_LOCALES: Readonly<Record<Locale, "es-AR" | "en">> = { es: "es-AR", en: "en" };

/** Nombre de cada idioma en su propio idioma (para el selector y lectores de pantalla). */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { es: "Español", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return value === "es" || value === "en";
}

/** Cualquier variante de inglés (`en`, `en-GB`, `en-US`) es inglés; el resto, español. */
export function normalizeLocale(value: string | null | undefined): Locale {
  return typeof value === "string" && /^en(?:[-_]|$)/i.test(value.trim()) ? "en" : DEFAULT_LOCALE;
}

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}

/** Cookie del idioma en un header `Cookie` crudo (BFF y layout). */
export function localeFromCookieHeader(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) return normalizeLocale(decodeURIComponent(rest.join("=")));
  }
  return DEFAULT_LOCALE;
}
