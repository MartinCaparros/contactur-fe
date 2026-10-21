import {
  type AppNotification,
  NOTIFICATIONS_PER_PAGE,
  type NotificationPreference,
  type NotificationType,
  type ProfileCategory,
  PROFILE_CATEGORIES,
  type ReferenceDirection,
  isPublicProfileId,
} from "./api";
import { DEFAULT_LOCALE, type Locale, intlLocale } from "@/lib/i18n/config";
import { type Translate, tk, translate, translator } from "@/lib/i18n/translate";

import { CATEGORY_LABELS } from "./directoryModel";
import { formatArgentinaDateTime } from "./requestsModel";

/**
 * Modelo puro del centro de notificaciones (T19). `safe_data` llega del backend pero
 * se trata como no confiable: solo se leen claves conocidas, solo como texto, y un
 * tipo o cambio desconocido recibe un texto genérico. Nada se interpreta como HTML.
 *
 * Los textos se escriben en español; las funciones que los arman reciben `t` o
 * `locale` como último parámetro opcional (por defecto español). Los mapas de rótulos
 * guardan el texto fuente (`tk`) y se traducen al mostrarlos: `t(FILTER_LABELS[filter])`.
 */

export type NotificationFilter = "all" | "unread";

export const FILTER_LABELS: Readonly<Record<NotificationFilter, string>> = {
  all: tk("Todas"),
  unread: tk("No leídas"),
};

/** El filtro vive en la URL (`unread=true`); el cursor nunca, igual que en Solicitudes. */
export function filterFromSearch(search: string): NotificationFilter {
  return new URLSearchParams(search).get("unread") === "true" ? "unread" : "all";
}

export function notificationsQuery(filter: NotificationFilter, cursor?: string | null, perPage = NOTIFICATIONS_PER_PAGE): string {
  const params = new URLSearchParams();
  params.set("unread", filter === "unread" ? "true" : "false");
  params.set("per_page", String(perPage));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

type SafeData = AppNotification["safe_data"];

/** Texto de una clave conocida; cualquier otro tipo de valor se descarta. */
function safeText(data: SafeData, key: string, max = 160): string | null {
  const value = data[key];
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

function safeCategory(data: SafeData): ProfileCategory | null {
  const value = data.counterpart_category;
  return PROFILE_CATEGORIES.find((category) => category === value) ?? null;
}

export type NotificationScope = "account" | "profile";

export type NotificationDescription = Readonly<{
  title: string;
  description: string | null;
  /** Categoría de la contraparte, solo si es una categoría conocida. */
  counterpartCategory: string | null;
  scope: NotificationScope;
  /** Solo para `contact_request_*` con un ID público válido. */
  requestId: string | null;
  /**
   * T20: pestaña de Referencias a abrir, solo para la moderación de una referencia con
   * `reference_id` válido. `author` abre las escritas; `subject`, las recibidas.
   */
  referencesDirection: ReferenceDirection | null;
}>;

const REQUEST_TYPES: readonly NotificationType[] = [
  "contact_request_received",
  "contact_request_accepted",
  "contact_request_rejected",
  "contact_request_expired",
];

function requestTitle(type: NotificationType, data: SafeData, t: Translate): Readonly<{ title: string; description: string | null }> {
  const name = safeText(data, "counterpart_display_name", 120);
  const recipient = data.role === "recipient";
  switch (type) {
    case "contact_request_received":
      return {
        title: name ? t("Nueva solicitud de {name}", { name }) : t("Nueva solicitud de contacto"),
        description: t("Respondé desde Solicitudes. Aceptar habilita el contacto, pero no confirma una contratación."),
      };
    case "contact_request_accepted":
      return {
        title: name ? t("Tu solicitud a {name} fue aceptada", { name }) : t("Tu solicitud fue aceptada"),
        description: t("Los datos de contacto están disponibles en el detalle de la solicitud."),
      };
    case "contact_request_rejected":
      return {
        title: name ? t("Tu solicitud a {name} fue rechazada", { name }) : t("Tu solicitud fue rechazada"),
        description: null,
      };
    default:
      return {
        title: recipient
          ? name ? t("Venció la solicitud de {name}", { name }) : t("Venció una solicitud que recibiste")
          : name ? t("Venció tu solicitud a {name}", { name }) : t("Venció una solicitud que enviaste"),
        description: t("La solicitud venció sin respuesta."),
      };
  }
}

function administrativeTitle(data: SafeData, t: Translate): Readonly<{ title: string; description: string | null }> {
  const documentType = safeText(data, "document_type", 80);
  switch (data.change) {
    case "access_updated":
      return {
        title: t("Administración actualizó tu acceso"),
        description: t("Revisá el estado y las capacidades vigentes en la pantalla de Acceso."),
      };
    case "profile_suspended":
      return {
        title: t("Administración suspendió tu perfil"),
        description: t("Mientras siga suspendido no aparece en el directorio ni puede operar solicitudes."),
      };
    case "profile_restored":
      return { title: t("Administración restauró tu perfil"), description: null };
    case "account_suspended":
      return {
        title: t("Administración suspendió tu cuenta"),
        description: t("Si creés que se trata de un error, escribinos desde el formulario de contacto."),
      };
    case "account_reactivated":
      return { title: t("Administración reactivó tu cuenta"), description: null };
    case "document_approved":
      return {
        title: documentType ? t("Documento aprobado: {documentType}", { documentType }) : t("Documento aprobado"),
        description: null,
      };
    case "document_rejected": {
      const reason = safeText(data, "rejection_reason", 500);
      return {
        title: documentType ? t("Documento rechazado: {documentType}", { documentType }) : t("Documento rechazado"),
        description: reason
          ? t("Motivo: {reason}. Podés volver a cargarlo desde tu perfil.", { reason })
          : t("Podés volver a cargarlo desde tu perfil."),
      };
    }
    // T20: el aviso nunca trae el texto de la referencia ni el motivo; se leen en Referencias.
    case "reference_hidden":
      return {
        title: data.role === "author"
          ? t("Administración ocultó una referencia que escribiste")
          : t("Administración ocultó una referencia sobre tu perfil"),
        description: t("Mientras siga moderada no se muestra en ninguna ficha. El motivo está en Referencias."),
      };
    case "reference_restored":
      return {
        title: data.role === "author"
          ? t("Administración restauró una referencia que escribiste")
          : t("Administración restauró una referencia sobre tu perfil"),
        description: data.role === "author"
          ? t("Vuelve a mostrarse solo si quien la recibió la tiene publicada.")
          : t("Se muestra en tu ficha solo si la tenés publicada."),
      };
    default:
      return {
        title: t("Administración registró un cambio"),
        description: t("Revisá tu perfil y tu estado de acceso."),
      };
  }
}

function referencesDirectionOf(data: SafeData): ReferenceDirection | null {
  if (data.change !== "reference_hidden" && data.change !== "reference_restored") return null;
  if (!isPublicProfileId(data.reference_id)) return null;
  return data.role === "author" ? "authored" : "received";
}

export function describeNotification(notification: AppNotification, t: Translate = translator()): NotificationDescription {
  const data = notification.safe_data;
  // Las notificaciones de cuenta (bienvenida, verificación, suspensión de cuenta) no
  // traen `profile_id`: se muestran en todos los perfiles con la etiqueta "Cuenta".
  const scope: NotificationScope = typeof data.profile_id === "string" ? "profile" : "account";
  const base = { scope, counterpartCategory: null, requestId: null, referencesDirection: null } as const;

  if (REQUEST_TYPES.includes(notification.type)) {
    const category = safeCategory(data);
    const requestId = isPublicProfileId(data.contact_request_id) ? data.contact_request_id : null;
    return {
      ...base,
      ...requestTitle(notification.type, data, t),
      // Rótulo del glosario compartido (common): mismo texto fuente que el directorio.
      counterpartCategory: category ? t(CATEGORY_LABELS[category]) : null,
      requestId,
    };
  }
  switch (notification.type) {
    case "welcome":
      return {
        ...base,
        title: t("Te damos la bienvenida a Contactur"),
        description: t("Completá tu perfil para presentarte ante la red profesional."),
      };
    case "email_verified":
      return {
        ...base,
        title: data.source === "email_change" ? t("Confirmaste tu nuevo correo") : t("Verificaste tu correo"),
        description: null,
      };
    case "administrative_change":
      return { ...base, ...administrativeTitle(data, t), referencesDirection: referencesDirectionOf(data) };
    default:
      return { ...base, title: t("Nueva notificación"), description: null };
  }
}

/** Un formateador relativo por idioma (se crea al primer uso). */
const RELATIVE_FORMATS = new Map<Locale, Intl.RelativeTimeFormat>();

function relativeFormat(locale: Locale): Intl.RelativeTimeFormat {
  let format = RELATIVE_FORMATS.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
    RELATIVE_FORMATS.set(locale, format);
  }
  return format;
}

/** "hace 5 minutos" para la última semana; después solo la fecha absoluta. */
export function relativeTimeText(iso: string, now: number = Date.now(), locale: Locale = DEFAULT_LOCALE): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  const format = relativeFormat(locale);
  if (abs < 60) return translate(locale, "hace un momento");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return format.format(Math.round(seconds / 86400), "day");
  return null;
}

/** `hace 1 hora · 10/11/2026 a las 11:00 (hora de Argentina)` · `1 hour ago · 10/11/2026 at 11:00 (Argentina time)`. */
export function notificationDateText(iso: string, now?: number, locale: Locale = DEFAULT_LOCALE): string {
  const relative = relativeTimeText(iso, now, locale);
  const absolute = translate(locale, "{date} (hora de Argentina)", { date: formatArgentinaDateTime(iso, locale) });
  return relative ? `${relative} · ${absolute}` : absolute;
}

// --- Insignia del menú -----------------------------------------------------------

/** La insignia cuenta la primera página de no leídas: con más páginas muestra "20+". */
export function unreadBadgeText(count: number, more: boolean): string {
  return more ? `${NOTIFICATIONS_PER_PAGE}+` : String(count);
}

export function unreadAccessibleName(count: number, more: boolean, t: Translate = translator()): string {
  if (more) return t("Notificaciones, más de {count} sin leer", { count: NOTIFICATIONS_PER_PAGE });
  if (count === 0) return t("Notificaciones");
  return t("Notificaciones, {count} sin leer", { count });
}

// --- Preferencias de correo ------------------------------------------------------

/** Correos opcionales: el titular decide (entrada ausente = habilitado). */
export const OPTIONAL_EMAIL_TYPES = [
  "contact_request_received",
  "contact_request_accepted",
  "contact_request_rejected",
  "contact_request_expired",
] as const satisfies readonly NotificationType[];

export type OptionalEmailType = (typeof OPTIONAL_EMAIL_TYPES)[number];

/** Texto fuente en español (`tk`): se traduce al mostrarlo con `t(OPTIONAL_EMAIL_LABELS[type])`. */
export const OPTIONAL_EMAIL_LABELS: Readonly<Record<OptionalEmailType, string>> = {
  contact_request_received: tk("Cuando recibís una solicitud de contacto"),
  contact_request_accepted: tk("Cuando aceptan una solicitud que enviaste"),
  contact_request_rejected: tk("Cuando rechazan una solicitud que enviaste"),
  contact_request_expired: tk("Cuando una solicitud vence sin respuesta"),
};

/** Esenciales: el correo sale siempre, el backend ignora el opt-out. `label`/`reason` son texto fuente (`tk`). */
export const ESSENTIAL_EMAILS: ReadonlyArray<Readonly<{ type: NotificationType; label: string; reason: string }>> = [
  {
    type: "administrative_change",
    label: tk("Cambios administrativos"),
    reason: tk("Una suspensión, un cambio de acceso o la revisión de un documento cambian lo que podés hacer en la plataforma."),
  },
  {
    type: "email_verified",
    label: tk("Verificación de correo"),
    reason: tk("Confirma un cambio de seguridad de tu cuenta."),
  },
];

/** Solo dentro de la plataforma: no hay correo que configurar. `label`/`reason` son texto fuente (`tk`). */
export const IN_APP_ONLY: ReadonlyArray<Readonly<{ type: NotificationType; label: string; reason: string }>> = [
  {
    type: "welcome",
    label: tk("Bienvenida"),
    reason: tk("El correo de verificación ya llega al registrarte; un segundo correo no agrega información."),
  },
];

export type PreferenceState = Readonly<Record<OptionalEmailType, boolean>>;

export function preferenceState(preferences: readonly NotificationPreference[]): PreferenceState {
  const enabled = (type: OptionalEmailType) =>
    preferences.find((preference) => preference.event_type === type)?.email_enabled ?? true;
  return {
    contact_request_received: enabled("contact_request_received"),
    contact_request_accepted: enabled("contact_request_accepted"),
    contact_request_rejected: enabled("contact_request_rejected"),
    contact_request_expired: enabled("contact_request_expired"),
  };
}

/** Body del PATCH /me: siempre la lista completa de los cuatro opcionales, con booleanos. */
export function preferencesBody(state: PreferenceState): { notification_preferences: NotificationPreference[] } {
  return {
    notification_preferences: OPTIONAL_EMAIL_TYPES.map((type) => ({ event_type: type, email_enabled: state[type] === true })),
  };
}
