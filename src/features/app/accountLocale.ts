"use client";

import { useCallback, useEffect, useRef } from "react";

import { ACCOUNT_LOCALES, normalizeLocale, type Locale } from "@/lib/i18n/config";
import { useLocale, useSetLocale } from "@/lib/i18n/LocaleProvider";

import { isCurrentAccountResponse, mutateBrowserJson, type CurrentAccount } from "./api";

type AccountUser = Pick<CurrentAccount["user"], "id" | "locale">;

/**
 * Idioma de la cuenta en los shells con sesión (app, backoffice, alta):
 * - al cargar `/me`, el idioma guardado en la cuenta manda (una vez por cuenta), así la
 *   elección sigue a la persona entre dispositivos;
 * - el selector del header lo guarda con `PATCH /me { locale }`. Si falla (p. ej. cuenta
 *   suspendida), la interfaz igual cambia: el idioma no es un permiso.
 */
export function useAccountLocale(user: AccountUser | null): (locale: Locale) => void {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!user || applied.current === user.id) return;
    applied.current = user.id;
    if (user.locale && normalizeLocale(user.locale) !== locale) setLocale(normalizeLocale(user.locale));
  }, [user, locale, setLocale]);

  return useCallback((next: Locale) => {
    void mutateBrowserJson("/api/backend/v1/me", "PATCH", { locale: ACCOUNT_LOCALES[next] }, isCurrentAccountResponse)
      .catch(() => undefined);
  }, []);
}
