import { ADMIN } from "./admin";
import { APP_CORE } from "./app-core";
import { APP_MATCH } from "./app-match";
import { APP_PROFILE } from "./app-profile";
import { COMMON } from "./common";
import { LANDING } from "./landing";
import type { Dictionary } from "./types";

export type { Dictionary } from "./types";

/**
 * Un archivo por área para que cada pantalla mantenga el suyo. Si dos áreas traducen el
 * mismo texto, la traducción tiene que coincidir (lo verifica `i18n-parity.test.ts`).
 */
export const EN_AREAS: Readonly<Record<string, Dictionary>> = {
  common: COMMON,
  landing: LANDING,
  "app-core": APP_CORE,
  "app-match": APP_MATCH,
  "app-profile": APP_PROFILE,
  admin: ADMIN,
};

/** Traducciones al inglés, indexadas por el texto fuente en español. */
export const EN: Dictionary = Object.assign({}, ...Object.values(EN_AREAS)) as Dictionary;
