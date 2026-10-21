import type { Locale } from "@/lib/i18n/config";
import { type Translate, tk, translate, translator } from "@/lib/i18n/translate";

import {
  ApiRequestError,
  type ContactQuota,
  type ContactRequest,
  type ContactRequestDirection,
  type ContactRequestStatus,
  type ProfileCategory,
  isContactRequestStatus,
} from "./api";
import { BUSINESS_TIME_ZONE } from "./availabilityModel";
import { formatBusinessDate } from "./directoryModel";

/**
 * Modelo puro de solicitudes de contacto (T18): textos de estado, fechas en hora de
 * Argentina y mensajes por `code`. Las reglas (quién puede qué, cuotas, cooldown,
 * vencimiento) las decide Laravel; acá solo se explica lo que respondió.
 *
 * Los textos se escriben en español (texto fuente). Las funciones que arman texto
 * reciben `t` o `locale` como último parámetro opcional (por defecto español); los
 * mapas de rótulos se traducen donde se muestran: `t(STATUS_LABELS[status])`.
 */

export const STATUS_LABELS: Readonly<Record<ContactRequestStatus, string>> = {
  pending: tk("Pendiente"),
  accepted: tk("Aceptada"),
  rejected: tk("Rechazada"),
  expired: tk("Vencida"),
  cancelled: tk("Cancelada"),
};

export const STATUS_FILTER_LABELS: Readonly<Record<ContactRequestStatus, string>> = {
  pending: tk("Pendientes"),
  accepted: tk("Aceptadas"),
  rejected: tk("Rechazadas"),
  expired: tk("Vencidas"),
  cancelled: tk("Canceladas"),
};

/** Marca textual por estado: acompaña al color, nunca lo reemplaza. */
export const STATUS_MARKS: Readonly<Record<ContactRequestStatus, string>> = {
  pending: "…",
  accepted: "✓",
  rejected: "✕",
  expired: "!",
  cancelled: "—",
};

export const DIRECTION_LABELS: Readonly<Record<ContactRequestDirection, string>> = {
  sent: tk("Enviadas"),
  received: tk("Recibidas"),
};

/**
 * Hoy solo la empresa turística envía y solo las categorías receptoras reciben, así
 * que cada categoría ve una única bandeja. Si el negocio habilitara otra dirección,
 * se agrega acá y la UI ya la presenta como pestaña.
 */
export function directionsFor(category: ProfileCategory): readonly ContactRequestDirection[] {
  return category === "tourism_company" ? ["sent"] : ["received"];
}

export function statusFromSearch(search: string): ContactRequestStatus | "" {
  const value = new URLSearchParams(search).get("status");
  return isContactRequestStatus(value) ? value : "";
}

export function listQuery(direction: ContactRequestDirection, status: ContactRequestStatus | "", cursor?: string): string {
  const params = new URLSearchParams();
  params.set("direction", direction);
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

const DATE_TIME_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function argentinaParts(iso: string): Readonly<Record<string, string>> | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Object.fromEntries(DATE_TIME_PARTS.formatToParts(parsed).map((part) => [part.type, part.value]));
}

/**
 * `17/11/2026 a las 12:00` (`17/11/2026 at 12:00`), siempre en America/Argentina/Buenos_Aires.
 * El orden día/mes es el mismo en `es-AR` y `en-GB`: solo cambia el conector.
 */
export function formatArgentinaDateTime(iso: string, locale: Locale = "es"): string {
  const parts = argentinaParts(iso);
  if (!parts) return iso;
  return translate(locale, "{date} a las {time}", {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute}`,
  });
}

export function requestedDatesText(from: string | null, to: string | null, t: Translate = translator()): string {
  if (!from || !to) return t("Sin fechas indicadas");
  return from === to
    ? formatBusinessDate(from)
    : t("{from} al {to}", { from: formatBusinessDate(from), to: formatBusinessDate(to) });
}

export function summarize(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

/** Explica `availability_status`, que es una foto informativa del momento del envío. */
export function availabilityStatusText(status: ContactRequest["availability_status"], t: Translate = translator()): string {
  switch (status) {
    case "available":
      return t("Al enviarse, el perfil tenía disponibilidad publicada para todas las fechas pedidas.");
    case "unavailable":
      return t("Al enviarse, el perfil no tenía disponibilidad publicada para todas las fechas pedidas.");
    case "changed":
      return t("La disponibilidad publicada cambió después del envío.");
    case "unspecified":
      return t("La solicitud no indica fechas, así que no se comparó con el calendario.");
  }
}

export type RequestRole = "sender" | "recipient";

export function roleIn(request: ContactRequest, actorProfileId: string): RequestRole | null {
  if (request.sender.id === actorProfileId) return "sender";
  if (request.recipient.id === actorProfileId) return "recipient";
  return null;
}

export function quotaExhausted(quota: ContactQuota | null | undefined): boolean {
  return Boolean(quota && quota.limit !== null && quota.used >= quota.limit);
}

export function quotaText(quota: ContactQuota, t: Translate = translator()): string {
  const month = formatBusinessDate(quota.month_start);
  return quota.limit === null
    ? t("Usaste {used} solicitudes en el mes iniciado el {month}, sin límite definido.", { used: quota.used, month })
    : t("Usaste {used} de {limit} solicitudes de contacto del mes iniciado el {month}.", {
        used: quota.used,
        limit: quota.limit,
        month,
      });
}

/** 403 por el estado del propio perfil; nunca describe a la contraparte. */
export function ownAccessText(code: string | null, t: Translate = translator()): string | null {
  switch (code) {
    case "subscription_required":
      return t("Tu perfil todavía no tiene una habilitación vigente para esta acción.");
    case "subscription_expired":
      return t("La habilitación de tu perfil venció. Tus datos y tu historial se conservan, pero esta acción queda bloqueada hasta que se actualice.");
    case "profile_suspended":
      return t("Tu perfil está suspendido y no puede realizar esta acción.");
    case "account_suspended":
      return t("Tu cuenta está suspendida y no puede realizar esta acción.");
    default:
      return null;
  }
}

/** `retry_after` del cooldown, ya formateado en hora de Argentina. */
export function retryAfterText(reason: ApiRequestError, locale: Locale = "es"): string | null {
  const value = reason.fields.retry_after?.[0];
  return value ? formatArgentinaDateTime(value, locale) : null;
}

/** Mensaje general del envío según `code`. Un 422 se explica además junto a cada campo. */
export function createErrorText(reason: unknown, locale: Locale = "es"): string {
  const t = translator(locale);
  if (!(reason instanceof ApiRequestError)) {
    return t("No pudimos confirmar el envío por un problema de conexión. Podés reintentar: se usa el mismo intento, así que no se duplica la solicitud ni se descuenta otra vez del cupo.");
  }
  const own = reason.status === 403 ? ownAccessText(reason.code, t) : null;
  if (own) return own;
  switch (reason.code) {
    case "capability_not_available":
      return t("Tu categoría de perfil no envía solicitudes de contacto: las inician las empresas turísticas.");
    case "capability_limit_reached":
      return t("Alcanzaste el límite mensual de solicitudes de contacto de tu habilitación.");
    case "contact_request_pending":
      return t("Ya tenés una solicitud pendiente con este perfil. Esperá su respuesta o cancelala desde Solicitudes.");
    case "contact_request_already_accepted":
      return t("Este perfil ya aceptó una solicitud tuya: el contacto está habilitado desde Solicitudes y no hace falta otra.");
    case "contact_request_cooldown": {
      const when = retryAfterText(reason, locale);
      return when
        ? t("Una solicitud reciente con este perfil terminó hace poco. Vas a poder enviar otra desde el {date} (hora de Argentina).", { date: when })
        : t("Una solicitud reciente con este perfil terminó hace poco. Todavía no podés enviar otra.");
    }
    case "idempotency_conflict":
      return t("Este intento de envío ya se había usado con otros datos. Revisá el formulario y enviá de nuevo: se generará un intento nuevo.");
    case "forbidden":
      return t("No tenés permiso para enviar esta solicitud desde el perfil activo.");
    case "not_found":
      return t("Este perfil ya no está disponible para recibir solicitudes.");
    case "validation_failed":
      return t("Revisá los datos marcados en el formulario.");
    default:
      if (reason.status === 429) return t("Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.");
      return reason.message || t("No pudimos enviar la solicitud.");
  }
}

/** Mensaje de una decisión (aceptar/rechazar/cancelar) que no prosperó. */
export function decisionErrorText(reason: unknown, t: Translate = translator()): string {
  if (!(reason instanceof ApiRequestError)) {
    return t("No pudimos confirmar la acción por un problema de conexión. Revisá el estado de la solicitud antes de reintentar.");
  }
  const own = reason.status === 403 ? ownAccessText(reason.code, t) : null;
  if (own) return own;
  switch (reason.code) {
    case "contact_request_not_pending":
      return t("La solicitud ya no está pendiente: otra acción o su vencimiento cambiaron el estado mientras la mirabas. Actualizamos el detalle con el estado vigente.");
    case "counterpart_access_unavailable":
      return t("La otra parte no puede concretar el contacto en este momento, así que la solicitud no se pudo aceptar.");
    case "forbidden":
      return t("Tu perfil no puede realizar esta acción sobre la solicitud.");
    case "not_found":
      return t("La solicitud ya no está disponible para este perfil.");
    default:
      if (reason.status === 429) return t("Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.");
      return reason.message || t("No pudimos completar la acción.");
  }
}

/** Mensaje del pedido de contacto; nunca revela por qué la otra parte no está disponible. */
export function contactErrorText(reason: unknown, t: Translate = translator()): string {
  if (!(reason instanceof ApiRequestError)) {
    return t("No pudimos obtener los datos de contacto por un problema de conexión. Podés reintentar.");
  }
  if (reason.code === "counterpart_access_unavailable") {
    return t("Los datos de contacto no están disponibles en este momento porque la otra parte no puede concretar el contacto. Probá más adelante.");
  }
  const own = reason.status === 403 ? ownAccessText(reason.code, t) : null;
  if (own) return t("{message} Mientras tanto no se muestran datos de contacto.", { message: own });
  switch (reason.code) {
    case "contact_request_not_accepted":
      return t("La solicitud no está aceptada, así que no hay datos de contacto para mostrar.");
    case "forbidden":
      return t("Tu perfil no puede ver los datos de contacto de esta solicitud.");
    case "not_found":
      return t("La solicitud ya no está disponible para este perfil.");
    default:
      if (reason.status === 429) return t("Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.");
      return reason.message || t("No pudimos obtener los datos de contacto.");
  }
}
