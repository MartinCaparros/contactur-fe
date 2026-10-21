import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

import type { AvailabilityDayInput, City, ProfileCategory } from "./api";

/**
 * Modelo puro del calendario: fechas de negocio, etiquetas y borrador explícito.
 *
 * Las fechas de negocio son strings `YYYY-MM-DD` en America/Argentina/Buenos_Aires
 * (D12). Nunca se convierten a `Date` local del navegador: la aritmética usa UTC
 * sobre la fecha "desnuda", así un navegador en otra zona no corre un día.
 */
export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Nombres en español (por defecto). Para otro idioma: `weekdayNames(locale)`. */
export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
export const WEEKDAY_SHORT = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"] as const;
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/**
 * Nombres de días y meses por idioma. Son listas fijas (no `Intl`) para que el texto
 * sea idéntico en cualquier navegador y en el servidor; la semana empieza en lunes.
 */
const CALENDAR_NAMES: Readonly<Record<Locale, Readonly<{
  weekdays: readonly string[];
  weekdaysShort: readonly string[];
  months: readonly string[];
}>>> = {
  es: { weekdays: WEEKDAY_NAMES, weekdaysShort: WEEKDAY_SHORT, months: MONTH_NAMES },
  en: {
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    weekdaysShort: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    months: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
  },
};

/** Días de la semana completos, de lunes a domingo. */
export function weekdayNames(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return CALENDAR_NAMES[locale].weekdays;
}

/** Abreviaturas de dos letras, de lunes a domingo (encabezados de la grilla). */
export function weekdayShortNames(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return CALENDAR_NAMES[locale].weekdaysShort;
}

/** Solo las categorías receptoras tienen calendario; la empresa turística no. */
export function hasAvailabilityCalendar(category: ProfileCategory): boolean {
  return category !== "tourism_company";
}

/** "Hoy" es la fecha local de negocio, no la fecha UTC ni la del navegador. */
export function businessToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function toUtc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, amount: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + amount);
  return fromUtc(date);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return fromUtc(new Date(Date.UTC(year, monthNumber - 1 + amount, 1))).slice(0, 7);
}

export function monthDates(month: string): string[] {
  const first = `${month}-01`;
  const dates: string[] = [];
  for (let date = first; monthOf(date) === month; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** 0 = lunes … 6 = domingo: la semana del calendario empieza en lunes. */
export function mondayIndex(iso: string): number {
  return (toUtc(iso).getUTCDay() + 6) % 7;
}

export function dateRange(from: string, to: string): string[] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** "lunes 5 de enero" · "Monday 5 January". */
export function longDateLabel(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const [, month, day] = iso.split("-").map(Number);
  const names = CALENDAR_NAMES[locale];
  const weekday = names.weekdays[mondayIndex(iso)];
  const monthName = names.months[month - 1];
  return locale === "en" ? `${weekday} ${day} ${monthName}` : `${weekday} ${day} de ${monthName}`;
}

/** "5 ene" · "5 Jan". */
export function shortDateLabel(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${CALENDAR_NAMES[locale].months[month - 1].slice(0, 3)}`;
}

/** Título del mes: "Enero 2027" · "January 2027". */
export function monthTitle(month: string, locale: Locale = DEFAULT_LOCALE): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const name = CALENDAR_NAMES[locale].months[monthNumber - 1];
  return `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)} ${year}`;
}

/** El mes dentro de una oración: "enero 2027" en español, "January 2027" en inglés. */
export function monthInSentence(month: string, locale: Locale = DEFAULT_LOCALE): string {
  const title = monthTitle(month, locale);
  return locale === "es" ? title.toLocaleLowerCase("es") : title;
}

/** Estado confirmado por el servidor para una fecha. Sin fila = bloqueado. */
export type ServerDay = Readonly<{ available: boolean; city: City | null }>;

/** Estado explícito que el usuario eligió para una fecha. Nunca un toggle. */
export type DraftDay = Readonly<{ available: true; cityId: number }> | Readonly<{ available: false }>;

export type Draft = ReadonlyMap<string, DraftDay>;

function matchesServer(server: ServerDay | undefined, target: DraftDay): boolean {
  // Sin estado conocido se conserva el borrador: el servidor decide si es un no-op.
  if (!server) return false;
  if (!target.available) return !server.available;
  return server.available && server.city?.id === target.cityId;
}

/**
 * Aplica un estado explícito a varias fechas. Si el destino coincide con lo que ya
 * confirmó el servidor, la fecha sale del borrador: así el lote lleva solo cambios.
 */
export function applyToDates(
  draft: Draft,
  dates: Iterable<string>,
  target: DraftDay,
  serverOf: (date: string) => ServerDay | undefined,
): Map<string, DraftDay> {
  const next = new Map(draft);
  for (const date of dates) {
    if (matchesServer(serverOf(date), target)) next.delete(date);
    else next.set(date, target);
  }
  return next;
}

/** Descarta del borrador lo que el servidor ya refleja (tras recargar un mes). */
export function pruneDraft(draft: Draft, serverOf: (date: string) => ServerDay | undefined): Map<string, DraftDay> {
  const next = new Map<string, DraftDay>();
  for (const [date, target] of draft) {
    if (!matchesServer(serverOf(date), target)) next.set(date, target);
  }
  return next;
}

/** Lote ordenado por fecha. `available:false` no lleva `city_id` (contrato T12). */
export function draftToBatch(draft: Draft): AvailabilityDayInput[] {
  return [...draft.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, target]) => target.available
      ? { date, available: true, city_id: target.cityId }
      : { date, available: false });
}

export type BatchErrors = Readonly<{
  byDate: Readonly<Record<string, readonly string[]>>;
  general: readonly string[];
}>;

/**
 * Traduce `error.fields` del 422 a errores por fecha. El backend usa el índice del
 * ítem enviado (`days.N.date`, `days.N.city_id`), así que se resuelve contra el
 * mismo lote que se mandó; lo que no apunta a un ítem queda como error general.
 */
export function batchErrors(
  fields: Readonly<Record<string, readonly string[]>>,
  batch: readonly AvailabilityDayInput[],
): BatchErrors {
  const byDate: Record<string, string[]> = {};
  const general: string[] = [];
  for (const [field, messages] of Object.entries(fields)) {
    const match = /^days\.(\d+)(?:\.|$)/.exec(field);
    const item = match ? batch[Number(match[1])] : undefined;
    if (item) {
      byDate[item.date] = [...(byDate[item.date] ?? []), ...messages];
    } else {
      general.push(...messages);
    }
  }
  return { byDate, general };
}

const CITY_STOPWORDS = new Set(["de", "del", "la", "las", "los", "el", "y"]);

function plain(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es");
}

/**
 * Código corto y único por ciudad para la celda del calendario: identifica la ciudad
 * sin depender del color. "Ushuaia" → USH, "San Carlos de Bariloche" → SCB.
 */
export function cityCodes(cities: readonly City[]): Map<number, string> {
  const codes = new Map<number, string>();
  const used = new Set<string>();
  for (const city of cities) {
    const words = plain(city.name).split(/[^A-Z0-9]+/).filter((word) => word && !CITY_STOPWORDS.has(word.toLowerCase()));
    let code = words.length > 1
      ? words.map((word) => word[0]).join("").slice(0, 3)
      : (words[0] ?? "C").slice(0, 3);
    for (let suffix = 2; used.has(code); suffix += 1) code = `${code.slice(0, 2)}${suffix}`;
    used.add(code);
    codes.set(city.id, code);
  }
  return codes;
}
