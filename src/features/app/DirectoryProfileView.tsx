"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import type { Translate } from "@/lib/i18n/translate";
import { DIRECTORY_CHANNEL, REALTIME_EVENTS, payloadProfileId, profileChannel } from "@/lib/realtime/channels";
import { useInvalidationRefresh, useRealtimeEvents } from "@/lib/realtime/RealtimeProvider";

import {
  type AccessEvaluation,
  ApiRequestError,
  type City,
  type DirectoryProfile,
  type Profile,
  type PublicAvailability,
  type SafeProfile,
  directoryAvailabilityPath,
  directoryProfilePath,
  getBrowserJson,
  isDirectoryProfileResponse,
  isPublicAvailabilityResponse,
  isPublicProfileId,
} from "./api";
import {
  addMonths,
  businessToday,
  cityCodes,
  longDateLabel,
  mondayIndex,
  monthDates,
  monthInSentence,
  monthOf,
  monthTitle,
  weekdayShortNames,
} from "./availabilityModel";
import {
  CATEGORY_LABELS,
  LAST_SEARCH_KEY,
  documentStatusLabel,
  documentStatusMark,
  forbiddenText,
  formatBusinessDate,
} from "./directoryModel";
import { ContactRequestForm, QuotaExhausted } from "./ContactRequestForm";
import { formatArgentinaDate } from "./referencesModel";
import { quotaExhausted } from "./requestsModel";
import styles from "./Directory.module.css";

/** `message: null` = sin mensaje propio del error: se muestra el texto genérico traducido al render. */
type DirectoryState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; data: DirectoryProfile }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "error"; message: string | null }>;

type MonthState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; data: PublicAvailability }>
  | Readonly<{ status: "error"; message: string | null }>;

/** Meses navegables hacia adelante desde el mes de negocio actual. */
const MONTHS_AHEAD = 11;

const DIRECTORY_EVENTS = [REALTIME_EVENTS.availabilityChanged, REALTIME_EVENTS.directoryChanged] as const;
const ACCESS_EVENTS = [REALTIME_EVENTS.accessChanged] as const;

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

/** Mensaje del error (las ApiRequestError ya llegan traducidas); `null` usa el genérico de la vista. */
function messageFrom(reason: unknown): string | null {
  return reason instanceof Error && reason.message ? reason.message : null;
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function lastSearchHref(actorId: string): string {
  let query = "";
  try {
    query = window.sessionStorage.getItem(LAST_SEARCH_KEY) ?? "";
  } catch {
    query = "";
  }
  const params = new URLSearchParams(query);
  params.delete("profile");
  params.delete("cursor");
  const rest = params.toString();
  return `${profileUrl("/app/search", actorId)}${rest ? `&${rest}` : ""}`;
}

/**
 * `/app/profiles/[id]`: ficha read-only de un miembro receptor. `{actor}` es el perfil
 * activo propio; `{target}` solo identifica la ficha y nunca da autoridad (lo valida
 * Laravel con la misma visibilidad que la búsqueda, 404 si no es elegible). La
 * respuesta no trae email ni teléfono (R12): esta vista no los lee ni los pide.
 */
export function DirectoryProfileView({
  actor,
  access,
  targetProfileId,
}: Readonly<{ actor: Profile; access: AccessEvaluation | null; targetProfileId: string }>) {
  const t = useT();
  const validTarget = isPublicProfileId(targetProfileId);
  const [loaded, setLoaded] = useState<DirectoryState>({ status: "loading" });
  const [backHref] = useState(() => actor.category === "tourism_company"
    ? lastSearchHref(actor.id)
    : profileUrl("/app", actor.id));
  const state: DirectoryState = validTarget ? loaded : { status: "not-found" };
  /** Sube con cada aviso de invalidación: re-consulta ficha y mes visible sin pasar por "cargando". */
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const targetRef = useRef(targetProfileId);

  useEffect(() => {
    targetRef.current = targetProfileId;
  }, [targetProfileId]);

  // Solo importan los avisos de este perfil; el payload no se guarda ni se muestra.
  const isViewedProfile = useCallback(
    (_eventName: string, payload: unknown) => payloadProfileId(payload) === targetRef.current,
    [],
  );
  const directoryChannel = validTarget && !(access && !access.capabilities.can_search) ? DIRECTORY_CHANNEL : null;
  const { mode: realtimeMode } = useInvalidationRefresh({
    channel: directoryChannel,
    events: DIRECTORY_EVENTS,
    filter: isViewedProfile,
    refresh,
  });
  useRealtimeEvents(validTarget ? profileChannel(actor.id) : null, ACCESS_EVENTS, refresh);

  useEffect(() => {
    if (!validTarget) return;
    const controller = new AbortController();
    const silent = revision > 0;
    void getBrowserJson(directoryProfilePath(actor.id, targetProfileId), isDirectoryProfileResponse, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setLoaded({ status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 404) {
          setLoaded({ status: "not-found" });
          return;
        }
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setLoaded({ status: "forbidden", code: reason.code, message: reason.message });
          return;
        }
        const message = messageFrom(reason);
        // Un refresco silencioso que falla por red conserva la ficha visible.
        setLoaded((current) => silent && current.status === "ready" ? current : { status: "error", message });
      });
    return () => controller.abort();
  }, [actor.id, targetProfileId, validTarget, revision]);

  const backLabel = actor.category === "tourism_company" ? t("Volver a la búsqueda") : t("Volver al resumen");

  return (
    <section className={styles.panel} aria-labelledby="directory-title" aria-busy={state.status === "loading"}>
      <Link className={styles.backLink} href={backHref}>← {backLabel}</Link>

      <div className={styles.realtimeStatus} role="status" data-realtime={realtimeMode}>
        {realtimeMode === "polling" && state.status === "ready" ? (
          <p className={styles.notice}>
            {t("Sin conexión en tiempo real: actualizamos esta ficha cada 30 segundos, así que los cambios pueden tardar en aparecer.")}
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <>
          <p className={styles.eyebrow}>{t("Ficha de miembro")}</p>
          <h1 id="directory-title">{t("Cargando ficha…")}</h1>
        </>
      ) : null}

      {state.status === "not-found" ? (
        <>
          <p className={styles.eyebrow}>{t("Ficha de miembro")}</p>
          <h1 id="directory-title">{t("Perfil no disponible")}</h1>
          <p className={styles.lead}>
            {t("Este perfil no existe o no está visible en el directorio en este momento.")}
          </p>
        </>
      ) : null}

      {state.status === "forbidden" ? (
        <>
          <p className={styles.eyebrow}>{t("Ficha de miembro")}</p>
          <h1 id="directory-title">{t("No podés ver fichas en este momento")}</h1>
          <div className={styles.blocked} role="alert">
            <p>{forbiddenText(state.code, state.message, t)}</p>
            <Link className={styles.primaryAction} href={profileUrl("/app/access", actor.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        </>
      ) : null}

      {state.status === "error" ? (
        <>
          <p className={styles.eyebrow}>{t("Ficha de miembro")}</p>
          <h1 id="directory-title">{t("No pudimos cargar la ficha")}</h1>
          <div className={styles.errorBox} role="alert"><p>{state.message ?? t("No pudimos cargar la ficha.")}</p></div>
        </>
      ) : null}

      {state.status === "ready" ? (
        <DirectoryProfileDetails actor={actor} access={access} data={state.data} revision={revision} />
      ) : null}
    </section>
  );
}

function DirectoryProfileDetails({
  actor,
  access,
  data,
  revision,
}: Readonly<{ actor: Profile; access: AccessEvaluation | null; data: DirectoryProfile; revision: number }>) {
  const t = useT();
  const safe = data.profile;
  return (
    <>
      <header className={styles.profileHeader}>
        <span className={styles.initialLarge} aria-hidden="true">{safe.display_name.slice(0, 1).toLocaleUpperCase("es")}</span>
        <div>
          <p className={styles.eyebrow}>{t(CATEGORY_LABELS[safe.category])}</p>
          <h1 id="directory-title">{safe.display_name}</h1>
          <p className={styles.profileMeta}>
            {safe.primary_city
              ? <span>{t("Ciudad principal: {city}", { city: safe.primary_city.name })}</span>
              : <span>{t("Sin ciudad principal")}</span>}
            {safe.verified ? <span className={styles.verified}><span aria-hidden="true">✓</span> {t("Verificado")}</span> : null}
          </p>
        </div>
      </header>
      {safe.description ? <p className={styles.lead}>{safe.description}</p> : null}

      <ContactCallToAction actor={actor} access={access} target={safe} />

      <div className={styles.detailGrid}>
        <section className={styles.detailCard} aria-labelledby="directory-coverage">
          <h2 id="directory-coverage">{t("Cobertura y servicios")}</h2>
          <dl className={styles.facts}>
            <div><dt>{t("Ciudades")}</dt><dd>{namesOr(safe.cities, t("Sin ciudades cargadas"))}</dd></div>
            <div><dt>{t("Idiomas")}</dt><dd>{namesOr(safe.languages, t("Sin idiomas cargados"))}</dd></div>
            <div><dt>{t("Servicios")}</dt><dd>{namesOr(safe.services, t("Sin servicios cargados"))}</dd></div>
          </dl>
        </section>

        <CategorySection data={data} />

        <section className={styles.detailCard} aria-labelledby="directory-documents">
          <h2 id="directory-documents">{t("Documentación")}</h2>
          {data.document_statuses.length === 0 ? (
            <p className={styles.muted}>{t("No hay documentación requerida para esta categoría.")}</p>
          ) : (
            <ul className={styles.documentList}>
              {data.document_statuses.map((document) => (
                <li key={document.document_type.code} data-status={document.status}>
                  <span className={styles.documentMark} aria-hidden="true">{documentStatusMark(document.status)}</span>
                  <span>
                    <strong>{document.document_type.label}</strong>
                    <small>
                      {document.valid_until
                        ? t("{status} · vigente hasta {date}", {
                            status: documentStatusLabel(document.status, t),
                            date: formatBusinessDate(document.valid_until),
                          })
                        : documentStatusLabel(document.status, t)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>{t("Se muestra solo el estado de revisión; los archivos son privados.")}</p>
        </section>

        <section className={styles.detailCard} aria-labelledby="directory-references">
          <h2 id="directory-references">{t("Referencias")}</h2>
          {data.visible_references.length === 0 ? (
            <p className={styles.muted}>{t("Todavía no tiene referencias visibles.")}</p>
          ) : (
            <ul className={styles.referenceList}>
              {data.visible_references.map((reference) => (
                <li key={reference.id} data-reference-id={reference.id}>
                  {/* Texto plano del autor: se respetan los saltos de línea, nunca se interpreta HTML. */}
                  <blockquote>{reference.body}</blockquote>
                  <small>
                    {reference.author.display_name} · {t(CATEGORY_LABELS[reference.author.category])} ·{" "}
                    <time dateTime={reference.created_at}>{formatArgentinaDate(reference.created_at)}</time>
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <PublicCalendar actorId={actor.id} target={safe} revision={revision} />
    </>
  );
}

function namesOr(items: readonly { name: string }[], empty: string): string {
  return items.length > 0 ? items.map((item) => item.name).join(", ") : empty;
}

/**
 * R13: solo una `tourism_company` con `can_send_contact_requests` ve el formulario
 * de envío (T18). Con el cupo mensual agotado se explica el uso del mes en lugar del
 * formulario. Para cualquier categoría receptora no se renderiza ningún envío.
 * Laravel vuelve a validar todo en el POST; esto es solo experiencia.
 */
function ContactCallToAction({
  actor,
  access,
  target,
}: Readonly<{ actor: Profile; access: AccessEvaluation | null; target: SafeProfile }>) {
  const t = useT();
  if (actor.category !== "tourism_company") {
    return (
      <p className={styles.contactNote}>
        {t("Las solicitudes de contacto las inician las empresas turísticas. El contacto se comparte solo después de un match aceptado.")}
      </p>
    );
  }
  if (!access?.capabilities.can_send_contact_requests) {
    if (access && (access.denial_code === "capability_limit_reached" || (access.allowed && quotaExhausted(access.contact_quota)))) {
      return <QuotaExhausted actorId={actor.id} quota={access.contact_quota} />;
    }
    return (
      <div className={styles.contactBox}>
        <p>{t("Tu perfil no puede enviar solicitudes de contacto en este momento.")}</p>
        <Link className={styles.secondaryAction} href={profileUrl("/app/access", actor.id)}>{t("Ver estado de acceso")}</Link>
      </div>
    );
  }
  return <ContactRequestForm actor={actor} quota={access.contact_quota} target={target} />;
}

function categoryRows(details: SafeProfile["category_details"], t: Translate): Array<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [];
  const noData = t("Sin dato");
  if ("legal_name" in details) rows.push([t("Razón social"), details.legal_name || t("Sin razón social cargada")]);
  if ("years_active" in details) rows.push([t("Años de actividad"), details.years_active === null ? noData : String(details.years_active)]);
  if ("education_summary" in details) rows.push([t("Formación"), details.education_summary ?? t("Sin resumen de formación")]);
  if ("training_summary" in details) rows.push([t("Formación"), details.training_summary ?? t("Sin resumen de formación")]);
  if ("license_type" in details) rows.push([t("Licencia"), details.license_type ?? noData]);
  if ("vehicle_type" in details) rows.push([t("Vehículo"), details.vehicle_type ?? noData]);
  if ("vehicle_capacity" in details) {
    // Un solo literal: el español siempre dijo "N pasajeros" y no se cambia la copia.
    const capacity = details.vehicle_capacity;
    rows.push([t("Capacidad"), capacity === null ? noData : t("{count} pasajeros", { count: capacity })]);
  }
  if ("fleet_description" in details) rows.push([t("Flota"), details.fleet_description ?? t("Sin descripción de flota")]);
  return rows;
}

function CategorySection({ data }: Readonly<{ data: DirectoryProfile }>) {
  const t = useT();
  const safe = data.profile;
  const rows = categoryRows(safe.category_details, t);
  const hasQualifications = safe.category === "guide" || safe.category === "instructor";

  return (
    <section className={styles.detailCard} aria-labelledby="directory-category">
      <h2 id="directory-category">
        {safe.category === "transport_company" ? t("Empresa y flota") : hasQualifications ? t("Formación") : t("Datos de la categoría")}
      </h2>
      <dl className={styles.facts}>
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {safe.category === "instructor" ? (
          <div><dt>{t("Especialidades")}</dt><dd>{namesOr(data.specialties, t("Sin especialidades cargadas"))}</dd></div>
        ) : null}
      </dl>
      {hasQualifications ? (
        data.qualifications.length === 0 ? <p className={styles.muted}>{t("Sin certificaciones cargadas.")}</p> : (
          <ul className={styles.plainList} aria-label={t("Certificaciones")}>
            {data.qualifications.map((qualification) => (
              <li key={`${qualification.title}-${qualification.institution}-${qualification.completed_on}`}>
                <strong>{qualification.title}</strong>
                <small>
                  {qualification.expires_on
                    ? t("{institution} · {completed} · vence {expires}", {
                        institution: qualification.institution,
                        completed: formatBusinessDate(qualification.completed_on),
                        expires: formatBusinessDate(qualification.expires_on),
                      })
                    : `${qualification.institution} · ${formatBusinessDate(qualification.completed_on)}`}
                </small>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {safe.category === "transport_company" ? (
        data.fleet_vehicles.length === 0 ? <p className={styles.muted}>{t("Sin vehículos cargados.")}</p> : (
          <ul className={styles.plainList} aria-label={t("Vehículos de la flota")}>
            {data.fleet_vehicles.map((vehicle) => (
              <li key={`${vehicle.vehicle_type}-${vehicle.capacity}-${vehicle.quantity}`}>
                <strong>{vehicle.vehicle_type}</strong>
                <small>{fleetVehicleText(t, vehicle.quantity, vehicle.capacity)}</small>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/** "2 unidades · 15 plazas": un literal por forma de plural de las unidades. */
function fleetVehicleText(t: Translate, quantity: number, capacity: number): string {
  return quantity === 1
    ? t("{quantity} unidad · {capacity} plazas", { quantity, capacity })
    : t("{quantity} unidades · {capacity} plazas", { quantity, capacity });
}

/**
 * Calendario público read-only del target: el backend devuelve solo días disponibles
 * (con ciudad). Un día sin fila no es "ocupado": es "sin disponibilidad publicada".
 * Cada día disponible lleva un código de ciudad además del color.
 */
function PublicCalendar({
  actorId,
  target,
  revision,
}: Readonly<{ actorId: string; target: SafeProfile; revision: number }>) {
  const t = useT();
  const locale = useLocale();
  const [currentMonth] = useState(() => monthOf(businessToday()));
  const [month, setMonth] = useState(currentMonth);
  const [loaded, setLoaded] = useState<Readonly<{ month: string; state: MonthState }> | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${month}#${retry}`;
  const state: MonthState = loaded?.month === key ? loaded.state : { status: "loading" };
  const lastMonth = addMonths(currentMonth, MONTHS_AHEAD);
  const today = businessToday();

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson(directoryAvailabilityPath(actorId, target.id, month), isPublicAvailabilityResponse, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setLoaded({ month: key, state: { status: "ready", data } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        const message = messageFrom(reason);
        // `revision` no forma parte de la clave: si un refresco silencioso falla, el mes
        // ya mostrado queda visible en lugar de reemplazarse por un error.
        setLoaded((current) => current?.month === key && current.state.status === "ready"
          ? current
          : { month: key, state: { status: "error", message } });
      });
    return () => controller.abort();
  }, [actorId, target.id, key, month, revision]);

  const availableByDate = new Map<string, City>();
  if (state.status === "ready") {
    for (const day of state.data.available_days) availableByDate.set(day.date, day.city);
  }
  const knownCities = new Map<number, City>();
  for (const city of [...target.cities, ...availableByDate.values()]) knownCities.set(city.id, city);
  const codes = cityCodes([...knownCities.values()]);
  const usedCities = [...new Map([...availableByDate.values()].map((city) => [city.id, city])).values()];
  const dates = monthDates(month);
  const label = monthTitle(month, locale);
  const labelInSentence = monthInSentence(month, locale);
  const availableCount = [...availableByDate.keys()].filter((date) => date.startsWith(`${month}-`)).length;

  return (
    <section className={styles.calendarCard} aria-labelledby="public-calendar-title">
      <div className={styles.calendarHeading}>
        <div>
          <p className={styles.eyebrow}>{t("Calendario público")}</p>
          <h2 id="public-calendar-title">{t("Disponibilidad publicada")}</h2>
        </div>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={month <= currentMonth}
            onClick={() => setMonth((value) => addMonths(value, -1))}
            aria-label={t("Mes anterior: {month}", { month: monthTitle(addMonths(month, -1), locale) })}
          >
            ←
          </button>
          <strong aria-live="polite">{label}</strong>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={month >= lastMonth}
            onClick={() => setMonth((value) => addMonths(value, 1))}
            aria-label={t("Mes siguiente: {month}", { month: monthTitle(addMonths(month, 1), locale) })}
          >
            →
          </button>
        </div>
      </div>

      {state.status === "loading" ? <p className={styles.muted} role="status">{t("Cargando disponibilidad…")}</p> : null}
      {state.status === "error" ? (
        <div className={styles.errorBox} role="alert">
          <p>{state.message ?? t("No pudimos cargar la disponibilidad.")}</p>
          <button type="button" className={styles.secondaryButton} onClick={() => setRetry((value) => value + 1)}>{t("Reintentar")}</button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.calendarSummary}>
            {availableCount === 0
              ? t("Sin disponibilidad publicada en {month}.", { month: labelInSentence })
              : availableCount === 1
                ? t("{count} día disponible en {month}.", { count: availableCount, month: labelInSentence })
                : t("{count} días disponibles en {month}.", { count: availableCount, month: labelInSentence })}
          </p>
          <div className={styles.weekdays} aria-hidden="true">
            {weekdayShortNames(locale).map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <ol className={styles.calendarGrid} aria-label={t("Disponibilidad de {month}", { month: label })}>
            {Array.from({ length: mondayIndex(dates[0] ?? `${month}-01`) }, (_, index) => (
              <li key={`pad-${index}`} className={styles.padDay} aria-hidden="true" />
            ))}
            {dates.map((date) => {
              const city = availableByDate.get(date) ?? null;
              const isToday = date === today;
              return (
                <li
                  key={date}
                  className={styles.publicDay}
                  data-date={date}
                  data-state={city ? "available" : "unpublished"}
                  data-today={isToday || undefined}
                >
                  <span className={styles.dayNumber} aria-hidden="true">{Number(date.slice(8, 10))}</span>
                  <span className={styles.dayCode} aria-hidden="true">
                    {city ? codes.get(city.id) ?? city.name.slice(0, 3).toLocaleUpperCase("es") : isToday ? t("HOY") : "—"}
                  </span>
                  <span className={styles.srOnly}>{publicDayLabel(t, longDateLabel(date, locale), isToday, city)}</span>
                </li>
              );
            })}
          </ol>
          <ul className={styles.legend} aria-label={t("Referencias del calendario")}>
            {usedCities.map((city) => (
              <li key={city.id}>
                <span className={styles.legendAvailable} aria-hidden="true">{codes.get(city.id)}</span>
                {t("Disponible en {city}", { city: city.name })}
              </li>
            ))}
            <li><span className={styles.legendEmpty} aria-hidden="true">—</span>{t("Sin disponibilidad publicada")}</li>
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Texto para lectores de pantalla de un día: una frase completa por combinación. */
function publicDayLabel(t: Translate, date: string, isToday: boolean, city: City | null): string {
  if (city) {
    return isToday
      ? t("{date}, hoy, disponible en {city}", { date, city: city.name })
      : t("{date}, disponible en {city}", { date, city: city.name });
  }
  return isToday ? t("{date}, hoy, sin disponibilidad publicada", { date }) : t("{date}, sin disponibilidad publicada", { date });
}
