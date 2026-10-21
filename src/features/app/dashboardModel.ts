import { intlLocale, type Locale } from "@/lib/i18n/config";
import { tk, translator, type Translate } from "@/lib/i18n/translate";

import type { DashboardMetricKey } from "./api";
import { referencesHref } from "./referencesModel";

/**
 * Modelo puro del Resumen (T21): etiquetas y destinos de cada KPI. Los valores los
 * calcula Laravel acotados al perfil activo; acá solo se ordenan y se explican. No
 * hay rankings ni "contratos realizados": un match aceptado solo libera el contacto.
 */

/** Los textos de la definición son fuente en español (`tk`); la vista los trae traducidos. */
export type MetricDefinition = Readonly<{
  key: DashboardMetricKey;
  label: string;
  hint: string;
  linkLabel: string;
  href: (profileId: string) => string;
}>;

export type MetricView = Readonly<{
  key: DashboardMetricKey;
  label: string;
  hint: string;
  linkLabel: string;
  href: string;
  value: number;
}>;

function profileQuery(path: string, profileId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ profile: profileId, ...extra });
  return `${path}?${params.toString()}`;
}

/** Orden de presentación. Solo se muestran las que el backend devuelve para el perfil. */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: "pending_contact_requests",
    label: tk("Solicitudes pendientes"),
    hint: tk("Esperan una respuesta."),
    linkLabel: tk("Ver solicitudes pendientes"),
    href: (profileId) => profileQuery("/app/requests", profileId, { status: "pending" }),
  },
  {
    key: "accepted_contact_requests",
    label: tk("Solicitudes aceptadas"),
    hint: tk("Contacto liberado entre las partes. No implica una contratación."),
    linkLabel: tk("Ver solicitudes aceptadas"),
    href: (profileId) => profileQuery("/app/requests", profileId, { status: "accepted" }),
  },
  {
    key: "rejected_contact_requests",
    label: tk("Solicitudes rechazadas"),
    hint: tk("Se respondieron sin liberar el contacto."),
    linkLabel: tk("Ver solicitudes rechazadas"),
    href: (profileId) => profileQuery("/app/requests", profileId, { status: "rejected" }),
  },
  {
    key: "expired_contact_requests",
    label: tk("Solicitudes vencidas"),
    hint: tk("Vencieron sin respuesta."),
    linkLabel: tk("Ver solicitudes vencidas"),
    href: (profileId) => profileQuery("/app/requests", profileId, { status: "expired" }),
  },
  {
    key: "unread_notifications",
    label: tk("Notificaciones sin leer"),
    hint: tk("Del perfil y de tu cuenta."),
    linkLabel: tk("Ver notificaciones sin leer"),
    href: (profileId) => profileQuery("/app/notifications", profileId, { unread: "true" }),
  },
  {
    key: "visible_references",
    label: tk("Referencias publicadas"),
    hint: tk("Recibidas y visibles en tu ficha."),
    linkLabel: tk("Ver referencias recibidas"),
    href: (profileId) => referencesHref(profileId, "received"),
  },
  {
    key: "available_future_days",
    label: tk("Días disponibles a futuro"),
    hint: tk("Fechas publicadas desde mañana."),
    linkLabel: tk("Ver disponibilidad"),
    href: (profileId) => profileQuery("/app/availability", profileId),
  },
];

/**
 * Cruza la respuesta con las definiciones: respeta el orden de presentación, ignora
 * claves desconocidas y no inventa las ausentes (la empresa turística no recibe
 * `available_future_days`, así que no se muestra un 0). Los textos salen en el
 * idioma de `t` (español por defecto).
 */
export function dashboardMetricViews(
  metrics: ReadonlyArray<Readonly<{ key: string; value: number }>>,
  profileId: string,
  t: Translate = translator(),
): readonly MetricView[] {
  const values = new Map<string, number>();
  for (const metric of metrics) {
    if (!values.has(metric.key)) values.set(metric.key, metric.value);
  }
  return METRIC_DEFINITIONS.flatMap((definition) => {
    const value = values.get(definition.key);
    return value === undefined
      ? []
      : [{
          key: definition.key,
          label: t(definition.label),
          hint: t(definition.hint),
          linkLabel: t(definition.linkLabel),
          href: definition.href(profileId),
          value,
        }];
  });
}

const NUMBER_FORMATS = new Map<Locale, Intl.NumberFormat>();

/** Un formateador por idioma (se crean una vez): `es-AR` usa punto de miles, `en-GB` coma. */
export function formatMetricValue(value: number, locale: Locale = "es"): string {
  let format = NUMBER_FORMATS.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(locale));
    NUMBER_FORMATS.set(locale, format);
  }
  return format.format(value);
}
