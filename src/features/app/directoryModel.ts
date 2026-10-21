import { type Translate, tk, translator } from "@/lib/i18n/translate";

import {
  type ProfileCategory,
  type PublicDocumentSummary,
  type ReceiverCategory,
  type SearchResult,
  isReceiverCategory,
} from "./api";

/**
 * Modelo puro del buscador (T15): filtros ⇄ URL y textos de estado.
 *
 * Los filtros viven en la URL para que una búsqueda se pueda recargar y compartir.
 * El cursor NO viaja en la URL: es opaco, está firmado y ligado a los filtros, así
 * que pertenece a la sesión de resultados en memoria. Una URL vieja con `cursor`
 * se normaliza quitándolo y arranca desde la primera página.
 */
export type MatchMode = "all" | "any";
export type VerifiedFilter = "" | "true" | "false";

export type SearchFilters = Readonly<{
  type: ReceiverCategory | "";
  name: string;
  cityId: string;
  dateFrom: string;
  dateTo: string;
  matchMode: MatchMode;
  verified: VerifiedFilter;
}>;

export const EMPTY_FILTERS: SearchFilters = {
  type: "",
  name: "",
  cityId: "",
  dateFrom: "",
  dateTo: "",
  matchMode: "all",
  verified: "",
};

/** Parámetros que el buscador posee en la URL; cualquier otro (p. ej. `profile`) se respeta. */
export const SEARCH_URL_PARAMS = ["type", "name", "city_id", "date_from", "date_to", "match_mode", "verified", "cursor"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** Texto fuente en español; se traduce al mostrarlo: `t(CATEGORY_LABELS[category])`. */
export const CATEGORY_LABELS: Readonly<Record<ProfileCategory, string>> = {
  tourism_company: tk("Empresa turística"),
  guide: tk("Guía"),
  driver: tk("Conductor"),
  instructor: tk("Instructor"),
  transport_company: tk("Empresa de transporte"),
};

/** Lee filtros de un query string; descarta valores con forma imposible en vez de inventar defaults. */
export function filtersFromSearch(search: string): SearchFilters {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const cityId = params.get("city_id") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";
  const verified = params.get("verified");
  return {
    type: isReceiverCategory(type) ? type : "",
    name: (params.get("name") ?? "").slice(0, 100),
    cityId: POSITIVE_INTEGER.test(cityId) ? cityId : "",
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    matchMode: params.get("match_mode") === "any" ? "any" : "all",
    verified: verified === "true" || verified === "false" ? verified : "",
  };
}

export function hasDateFilter(filters: SearchFilters): boolean {
  return filters.dateFrom !== "" || filters.dateTo !== "";
}

export function hasFullRange(filters: SearchFilters): boolean {
  return filters.dateFrom !== "" && filters.dateTo !== "";
}

/**
 * Query string con orden fijo y solo filtros con valor. `match_mode` se envía solo
 * cuando hay fechas: sin rango no tiene efecto y el backend usa `all` por defecto.
 * Las validaciones (rango, máximo de días, ciudad existente) las decide Laravel.
 */
export function filtersToQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  const name = filters.name.trim();
  if (filters.type) params.set("type", filters.type);
  if (name) params.set("name", name);
  if (filters.cityId) params.set("city_id", filters.cityId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (hasDateFilter(filters)) params.set("match_mode", filters.matchMode);
  if (filters.verified) params.set("verified", filters.verified);
  return params.toString();
}

export function withCursor(query: string, cursor: string): string {
  const params = new URLSearchParams(query);
  params.set("cursor", cursor);
  return params.toString();
}

/** Reemplaza en `href` solo los parámetros del buscador, conservando el resto. */
export function searchUrlFor(href: string, filters: SearchFilters): string {
  const url = new URL(href);
  for (const key of SEARCH_URL_PARAMS) url.searchParams.delete(key);
  for (const [key, value] of new URLSearchParams(filtersToQuery(filters))) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Texto de disponibilidad de una tarjeta; `null` cuando no se pidió rango. */
export function availabilityText(
  result: Pick<SearchResult, "availability_status" | "matched_days" | "requested_days">,
  t: Translate = translator(),
): string | null {
  const params = { matched: result.matched_days, requested: result.requested_days };
  switch (result.availability_status) {
    case "available":
      return result.requested_days === 1
        ? t("Disponible el día buscado")
        : t("Disponible los {count} días", { count: result.requested_days });
    case "partial":
      return result.requested_days === 1
        ? t("Disponibilidad parcial: {matched} de {requested} día", params)
        : t("Disponibilidad parcial: {matched} de {requested} días", params);
    case "unspecified":
      return null;
  }
}

export function documentStatusLabel(status: PublicDocumentSummary["status"], t: Translate = translator()): string {
  switch (status) {
    case "approved": return t("Aprobado");
    case "pending": return t("En revisión");
    case "rejected": return t("Rechazado");
    case "expired": return t("Vencido");
    case "missing": return t("Sin cargar");
  }
}

/** Marca textual por estado documental: acompaña al color, nunca lo reemplaza. */
export function documentStatusMark(status: PublicDocumentSummary["status"]): string {
  switch (status) {
    case "approved": return "✓";
    case "pending": return "…";
    case "rejected": return "✕";
    case "expired": return "!";
    case "missing": return "—";
  }
}

export function formatBusinessDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/** Resumen corto para tarjetas: primeros nombres y "+N" con el resto. */
export function summarizeNames(items: readonly { name: string }[], limit = 3): string | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, limit).map((item) => item.name).join(", ");
  return items.length > limit ? `${shown} +${items.length - limit}` : shown;
}

/** Explica un 403 del directorio con el denial code real; el permiso lo decidió Laravel. */
export function forbiddenText(code: string | null, fallback: string, t: Translate = translator()): string {
  switch (code) {
    case "subscription_required":
      return t("Este perfil todavía no tiene una habilitación vigente para usar el directorio.");
    case "subscription_expired":
      return t("La habilitación de este perfil venció. Tus datos se conservan, pero el directorio queda bloqueado mientras no se actualice la habilitación.");
    case "profile_suspended":
      return t("Este perfil está suspendido y no puede consultar el directorio.");
    case "account_suspended":
      return t("La cuenta está suspendida y no puede consultar el directorio.");
    default:
      return fallback;
  }
}

/** Última búsqueda de la sesión, para volver desde la ficha con los mismos filtros. */
export const LAST_SEARCH_KEY = "contactur.search.last-query";
