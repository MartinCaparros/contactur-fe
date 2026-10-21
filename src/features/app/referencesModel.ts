import { type Translate, tk, translator } from "@/lib/i18n/translate";

import { ApiRequestError, type Reference, type ReferenceDirection } from "./api";
import { BUSINESS_TIME_ZONE } from "./availabilityModel";
import { ownAccessText } from "./requestsModel";

/**
 * Modelo puro de referencias (T20): dirección ⇄ URL, textos de estado y mensajes por
 * `code`. Quién puede escribir, publicar u ocultar lo decide Laravel; acá solo se
 * explica lo que respondió. Las referencias son texto libre: no hay puntajes.
 * Los textos reciben `t` como último parámetro opcional (por defecto español).
 */

export const REFERENCE_DIRECTIONS = ["received", "authored"] as const satisfies readonly ReferenceDirection[];

/** Texto fuente; se traduce al mostrarlo: `t(REFERENCE_DIRECTION_LABELS[direction])`. */
export const REFERENCE_DIRECTION_LABELS: Readonly<Record<ReferenceDirection, string>> = {
  received: tk("Recibidas"),
  authored: tk("Escritas por vos"),
};

export const REFERENCES_PER_PAGE = 20;
/** Primera página de emitidas para saber si ya escribiste una en un match (tope del contrato). */
export const AUTHORED_LOOKUP_PER_PAGE = 50;

export const REFERENCE_BODY_MIN = 20;
export const REFERENCE_BODY_MAX = 2000;

export function isReferenceDirection(value: unknown): value is ReferenceDirection {
  return value === "received" || value === "authored";
}

/** La dirección vive en la URL; sin valor válido se abren las recibidas (enlace de los correos). */
export function directionFromSearch(search: string): ReferenceDirection {
  const value = new URLSearchParams(search).get("direction");
  return isReferenceDirection(value) ? value : "received";
}

export function referencesQuery(
  direction: ReferenceDirection,
  cursor?: string | null,
  perPage: number = REFERENCES_PER_PAGE,
): string {
  const params = new URLSearchParams();
  params.set("direction", direction);
  params.set("per_page", String(perPage));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function referencesHref(profileId: string, direction?: ReferenceDirection): string {
  const params = new URLSearchParams();
  params.set("profile", profileId);
  if (direction) params.set("direction", direction);
  return `/app/references?${params.toString()}`;
}

const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `17/11/2026` en hora de Argentina: un timestamp UTC de madrugada cae en el día anterior. */
export function formatArgentinaDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const parts = Object.fromEntries(DATE_PARTS.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** La contraparte de cada fila: quien la escribió (recibidas) o sobre quién (emitidas). */
export function counterpartOf(reference: Reference, direction: ReferenceDirection) {
  return direction === "received" ? reference.author : reference.subject;
}

export type ReferenceState = "moderated" | "visible" | "hidden";

export function referenceState(reference: Pick<Reference, "moderated" | "visibility">): ReferenceState {
  if (reference.moderated) return "moderated";
  return reference.visibility === "visible" ? "visible" : "hidden";
}

/** Estado en texto (nunca solo color): la moderación administrativa tiene prioridad. */
export function referenceStatusText(
  reference: Reference,
  direction: ReferenceDirection,
  t: Translate = translator(),
): string {
  if (reference.moderated) return t("Oculta por moderación");
  if (direction === "received") {
    return reference.visibility === "visible" ? t("Publicada en tu ficha") : t("Oculta en tu ficha");
  }
  const name = reference.subject.display_name;
  return reference.visibility === "visible"
    ? t("Publicada por {name}", { name })
    : t("Pendiente de publicación por {name}", { name });
}

/** El motivo de moderación es visible para ambas partes mientras siga vigente. */
export function moderationReasonText(reference: Reference, t: Translate = translator()): string | null {
  if (!reference.moderated) return null;
  const reason = reference.moderation_reason?.trim();
  return reason ? t("Motivo de moderación: {reason}", { reason }) : t("Administración no registró un motivo visible.");
}

/** Validación mínima antes de gastar un request: el backend vuelve a validar (20–2000 tras recortar). */
export function referenceBodyProblem(body: string, t: Translate = translator()): string | null {
  const length = body.trim().length;
  if (length < REFERENCE_BODY_MIN) {
    return t("Escribí al menos {min} caracteres (sin contar espacios al principio o al final).", { min: REFERENCE_BODY_MIN });
  }
  if (length > REFERENCE_BODY_MAX) return t("Usá como máximo {max} caracteres.", { max: REFERENCE_BODY_MAX });
  return null;
}

export function bodyCounterText(body: string, t: Translate = translator()): string {
  const length = body.trim().length;
  return t("{length} de {max} caracteres (mínimo {min}).", { length, max: REFERENCE_BODY_MAX, min: REFERENCE_BODY_MIN });
}

function genericText(reason: ApiRequestError, fallback: string, t: Translate): string {
  if (reason.status === 429) return t("Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.");
  return reason.message || fallback;
}

/** Mensaje general del alta. Un 422 se explica además junto al campo. */
export function createReferenceErrorText(reason: unknown, t: Translate = translator()): string {
  if (!(reason instanceof ApiRequestError)) {
    return t("No pudimos confirmar el envío por un problema de conexión. Revisá en Referencias si quedó registrada antes de reintentar.");
  }
  const own = reason.status === 403 ? ownAccessText(reason.code, t) : null;
  if (own) return own;
  switch (reason.code) {
    case "reference_already_exists":
      return t("Ya dejaste una referencia en este match. Cada parte puede dejar una sola y no se edita.");
    case "contact_request_not_accepted":
      return t("La solicitud ya no está aceptada, así que no admite referencias. Actualizamos el detalle con su estado vigente.");
    case "validation_failed":
      return t("Revisá el texto de la referencia.");
    case "forbidden":
      return t("Tu perfil no puede dejar una referencia en esta solicitud.");
    case "not_found":
      return t("La solicitud ya no está disponible para este perfil.");
    default:
      if (reason.status === 404) return t("La solicitud ya no está disponible para este perfil.");
      return genericText(reason, t("No pudimos guardar la referencia."), t);
  }
}

/** Mensaje de publicar/ocultar que no prosperó; la UI ya revirtió el cambio optimista. */
export function visibilityErrorText(reason: unknown, t: Translate = translator()): string {
  if (!(reason instanceof ApiRequestError)) {
    return t("No pudimos guardar el cambio por un problema de conexión. La referencia quedó como estaba.");
  }
  const own = reason.status === 403 ? ownAccessText(reason.code, t) : null;
  if (own) return own;
  switch (reason.code) {
    case "reference_moderated":
      return t("Administración ocultó esta referencia por moderación mientras la mirabas, así que no podés cambiar su visibilidad. Actualizamos el listado.");
    case "forbidden":
      return t("Solo quien recibió la referencia decide si se publica en su ficha.");
    case "not_found":
      return t("La referencia ya no está disponible para este perfil.");
    default:
      if (reason.status === 404) return t("La referencia ya no está disponible para este perfil.");
      return genericText(reason, t("No pudimos guardar el cambio."), t);
  }
}
