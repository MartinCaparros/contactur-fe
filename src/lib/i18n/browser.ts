import { DEFAULT_LOCALE, localeFromCookieHeader, type Locale } from "./config";
import { translate, type TranslateParams } from "./translate";

/**
 * Idioma activo leído de la cookie, para código del navegador que corre fuera del render
 * (clientes de API, handlers). En el render usar `useT()`/`useLocale()`: en el servidor
 * no hay `document` y leer la cookie acá rompería la hidratación.
 */
export function browserLocale(): Locale {
  return typeof document === "undefined" ? DEFAULT_LOCALE : localeFromCookieHeader(document.cookie);
}

export function browserTranslate(source: string, params?: TranslateParams): string {
  return translate(browserLocale(), source, params);
}
