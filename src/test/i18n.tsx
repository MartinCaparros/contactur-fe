import type { ReactNode } from "react";

import type { Locale } from "@/lib/i18n/config";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * Envuelve un árbol en un idioma para tests. Sin wrapper los componentes renderizan en
 * español (contexto por defecto), que es lo que esperan los tests existentes.
 */
export function inLocale(locale: Locale, ui: ReactNode) {
  return <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>;
}

/** Cookie del idioma para el código que lo lee fuera del render (clientes de API). */
export function setLocaleCookie(locale: Locale | null): void {
  document.cookie = locale
    ? `contactur_locale=${locale}; Path=/`
    : "contactur_locale=; Max-Age=0; Path=/";
}
