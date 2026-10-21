"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "./config";
import { translator, type Translate } from "./translate";

type LocaleState = Readonly<{
  locale: Locale;
  /** Cambia el idioma de toda la interfaz al instante (sin recargar) y lo recuerda en la cookie. */
  setLocale: (locale: Locale) => void;
}>;

/**
 * Sin provider (tests unitarios de un componente suelto) la interfaz queda en español y
 * `setLocale` no hace nada: los tests existentes siguen leyendo los textos fuente.
 */
const LocaleContext = createContext<LocaleState>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function LocaleProvider({ initialLocale, children }: Readonly<{ initialLocale: Locale; children: ReactNode }>) {
  const [locale, setState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    writeLocaleCookie(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
    setState(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useContext(LocaleContext).setLocale;
}

/** `t("Texto en español", { param })` en el idioma activo. */
export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
