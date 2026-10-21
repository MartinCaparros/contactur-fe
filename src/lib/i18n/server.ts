import { cookies } from "next/headers";

import { LOCALE_COOKIE, normalizeLocale, type Locale } from "./config";

/** Idioma de la request en el servidor (layout y metadata): la cookie o español. */
export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}
