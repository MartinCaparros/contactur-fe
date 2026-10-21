"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import type { Translate } from "@/lib/i18n/translate";
import { REALTIME_EVENTS, payloadVersion, profileChannel } from "@/lib/realtime/channels";
import { useInvalidationRefresh } from "@/lib/realtime/RealtimeProvider";

import {
  ApiRequestError,
  type AccessEvaluation,
  type AvailabilityData,
  type Profile,
  type UpdateAvailabilityInput,
  availabilityPath,
  getBrowserJson,
  isAvailabilityResponse,
  mutateBrowserJson,
} from "./api";
import {
  type BatchErrors,
  type Draft,
  type DraftDay,
  type ServerDay,
  addDays,
  addMonths,
  applyToDates,
  batchErrors,
  businessToday,
  cityCodes,
  dateRange,
  draftToBatch,
  hasAvailabilityCalendar,
  longDateLabel,
  mondayIndex,
  monthDates,
  monthInSentence,
  monthOf,
  monthTitle,
  pruneDraft,
  shortDateLabel,
  weekdayNames,
  weekdayShortNames,
} from "./availabilityModel";
import styles from "./AvailabilityCalendar.module.css";

/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type MonthEntry =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; days: ReadonlyMap<string, ServerDay> }>
  | Readonly<{ status: "error"; message: string | null }>;

/**
 * Resultado del último guardado. Ningún estado de error toca el borrador ni el
 * estado confirmado: el lote es atómico en el backend, así que la vista nunca
 * muestra un guardado "a medias".
 */
type SaveState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "saving" }>
  | Readonly<{ status: "saved"; count: number; version: number }>
  | Readonly<{ status: "invalid"; message: string; errors: BatchErrors }>
  | Readonly<{ status: "conflict"; message: string }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "failed"; message: string }>;

const NO_ERRORS: BatchErrors = { byDate: {}, general: [] };
const AVAILABILITY_EVENTS = [REALTIME_EVENTS.availabilityChanged] as const;

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

/** Mensaje propio del error (ya traducido por la API) o `null` para usar el genérico. */
function errorMessage(reason: unknown): string | null {
  return reason instanceof Error && reason.message ? reason.message : null;
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

export function serverDaysFrom(data: AvailabilityData): Map<string, ServerDay> {
  return new Map(data.days.map((day) => [day.date, { available: day.available, city: day.city }]));
}

function sameDayInMonth(date: string, delta: number): string {
  const month = addMonths(monthOf(date), delta);
  const days = monthDates(month);
  const day = Number(date.slice(8, 10));
  return days[Math.min(day, days.length) - 1];
}

/** Foco inicial del mes: mañana si está en el mes, si no hoy, si no el día 1. */
function initialFocus(month: string, today: string): string {
  const tomorrow = addDays(today, 1);
  if (monthOf(tomorrow) === month) return tomorrow;
  if (monthOf(today) === month) return today;
  return `${month}-01`;
}

function readOnlyReason(access: AccessEvaluation | null, t: Translate): string | null {
  if (!access) return t("No pudimos consultar el estado de acceso, así que el calendario queda en solo lectura.");
  if (access.capabilities.can_publish_availability) return null;
  switch (access.denial_code) {
    case "subscription_expired":
      return t("La vigencia de tu habilitación finalizó.");
    case "profile_suspended":
    case "account_suspended":
      return t("El perfil está suspendido.");
    case "subscription_required":
      return t("Tu perfil todavía no tiene una habilitación vigente.");
    default:
      return t("La habilitación actual no permite publicar disponibilidad.");
  }
}

function forbiddenReason(code: string | null, message: string, t: Translate): string {
  switch (code) {
    case "subscription_required": return t("Tu perfil todavía no tiene una habilitación vigente.");
    case "subscription_expired": return t("La vigencia de tu habilitación finalizó.");
    case "profile_suspended": return t("El perfil está suspendido.");
    case "capability_not_available": return t("Esta categoría de perfil no tiene calendario de disponibilidad.");
    default: return message;
  }
}

/** Vista de `/app/availability`: la empresa turística no tiene calendario. */
export function AvailabilityView({ profile, access }: Readonly<{ profile: Profile; access: AccessEvaluation | null }>) {
  const t = useT();
  if (!hasAvailabilityCalendar(profile.category)) {
    return (
      <section className={styles.panel} aria-labelledby="availability-title">
        <p className={styles.eyebrow}>{t("Disponibilidad")}</p>
        <h1 id="availability-title">{t("Sin calendario para este perfil")}</h1>
        <p className={styles.lead}>
          {t("Las empresas turísticas buscan profesionales; no publican disponibilidad propia.")}
        </p>
        <Link className={styles.primaryButton} href={profileUrl("/app", profile.id)}>{t("Volver al resumen")}</Link>
      </section>
    );
  }
  return <AvailabilityCalendar profile={profile} access={access} />;
}

export function AvailabilityCalendar({ profile, access }: Readonly<{ profile: Profile; access: AccessEvaluation | null }>) {
  const t = useT();
  const locale = useLocale();
  const [today] = useState(() => businessToday());
  // Abre en el mes real de hoy, aunque hoy sea el último día y no quede nada editable.
  const [month, setMonth] = useState(() => monthOf(today));
  const [months, setMonths] = useState<Readonly<Record<string, MonthEntry>>>(() => ({
    [monthOf(today)]: { status: "loading" },
  }));
  const [fetchKey, setFetchKey] = useState(0);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [versionDrift, setVersionDrift] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => new Map());
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState(() => initialFocus(monthOf(today), today));
  const [cityId, setCityId] = useState<number | null>(profile.cities[0]?.id ?? null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const draftRef = useRef<Draft>(draft);
  const versionRef = useRef<number | null>(baseVersion);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusPending = useRef(false);
  const titleId = useId();
  const helpId = useId();

  const monthRef = useRef(month);
  const savingRef = useRef(false);
  const silentController = useRef<AbortController | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    versionRef.current = baseVersion;
  }, [baseVersion]);
  useEffect(() => {
    monthRef.current = month;
  }, [month]);
  useEffect(() => {
    savingRef.current = save.status === "saving";
  }, [save.status]);
  useEffect(() => () => silentController.current?.abort(), []);

  /**
   * Otra sesión (u otra pestaña) cambió el calendario. Sin borrador se recarga el mes
   * visible en silencio y se adopta la versión nueva; con borrador se conserva todo y
   * se avisa: el guardado sigue protegido por `expected_version` (409).
   */
  const refreshFromServer = useCallback(() => {
    if (savingRef.current || versionRef.current === null) return;
    silentController.current?.abort();
    const controller = new AbortController();
    silentController.current = controller;
    const known = versionRef.current;
    void getBrowserJson(availabilityPath(profile.id, monthRef.current), isAvailabilityResponse, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted || savingRef.current) return;
        if (versionRef.current !== known || data.version === known) return;
        if (draftRef.current.size > 0) {
          setVersionDrift(true);
          return;
        }
        versionRef.current = data.version;
        setBaseVersion(data.version);
        setVersionDrift(false);
        // Los otros meses en caché pueden estar desactualizados: se vuelven a pedir al navegarlos.
        setMonths({ [data.month]: { status: "ready", days: serverDaysFrom(data) } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        redirectIfUnauthorized(reason);
        // Otros fallos conservan el calendario visible; el próximo aviso o el polling reintenta.
      });
  }, [profile.id]);

  // Solo interesa un aviso con una versión posterior a la cargada (los propios guardados
  // llegan con la misma versión que devolvió el PUT y se ignoran).
  const isNewerVersion = useCallback((_eventName: string, payload: unknown) => {
    const version = payloadVersion(payload);
    return version !== null && versionRef.current !== null && version > versionRef.current;
  }, []);
  const { mode: realtimeMode } = useInvalidationRefresh({
    channel: profileChannel(profile.id),
    events: AVAILABILITY_EVENTS,
    filter: isNewerVersion,
    refresh: refreshFromServer,
  });

  const entry = months[month];
  const needsFetch = entry === undefined || entry.status === "loading";

  useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();
    void getBrowserJson(availabilityPath(profile.id, month), isAvailabilityResponse, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const days = serverDaysFrom(data);
        const known = versionRef.current;
        if (known !== null && known !== data.version && draftRef.current.size > 0) {
          // Otra sesión cambió el calendario mientras había un borrador: se conserva la
          // versión sobre la que se armó, así el guardado da 409 en lugar de pisar cambios.
          setVersionDrift(true);
          setMonths((current) => ({ ...current, [data.month]: { status: "ready", days } }));
        } else if (known !== null && known !== data.version) {
          // Sin borrador se adopta la versión nueva y se descartan los meses en caché,
          // que pueden estar desactualizados; se vuelven a pedir al navegarlos.
          setBaseVersion(data.version);
          setMonths({ [data.month]: { status: "ready", days } });
        } else {
          setBaseVersion(data.version);
          setMonths((current) => ({ ...current, [data.month]: { status: "ready", days } }));
        }
        setDraft((current) => pruneDraft(current, (date) => days.get(date)));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        setMonths((current) => ({
          ...current,
          [month]: { status: "error", message: errorMessage(reason) },
        }));
      });
    return () => controller.abort();
  }, [month, needsFetch, fetchKey, profile.id]);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    buttons.current.get(focusDate)?.focus();
  }, [focusDate, month]);

  const accessReason = readOnlyReason(access, t);
  const noCities = profile.cities.length === 0;
  const forbidden = save.status === "forbidden" ? save : null;
  const canEdit = accessReason === null && !noCities && forbidden === null;
  const saving = save.status === "saving";
  const errors = save.status === "invalid" ? save.errors : NO_ERRORS;
  const codes = cityCodes(profile.cities);
  const selectedCity = profile.cities.find((city) => city.id === cityId) ?? profile.cities[0] ?? null;
  const dates = monthDates(month);
  const rovingDate = monthOf(focusDate) === month ? focusDate : dates[0];
  const readyDays = entry?.status === "ready" ? entry.days : null;

  const serverOf = (date: string): ServerDay | undefined => {
    const cached = months[monthOf(date)];
    return cached?.status === "ready" ? cached.days.get(date) : undefined;
  };
  const isEditable = (date: string) => canEdit && date > today && serverOf(date) !== undefined && !saving;

  const goToMonth = (next: string, focus?: string) => {
    setMonth(next);
    setMonths((current) => current[next]?.status === "ready" ? current : { ...current, [next]: { status: "loading" } });
    setFocusDate(focus ?? initialFocus(next, today));
  };

  const moveFocus = (target: string) => {
    focusPending.current = true;
    if (monthOf(target) !== month) goToMonth(monthOf(target), target);
    else setFocusDate(target);
  };

  const toggleDate = (date: string, extend: boolean) => {
    setFocusDate(date);
    if (!isEditable(date)) return;
    if (extend && anchor) {
      // Rango inclusivo desde el último día elegido; hoy y el pasado quedan afuera.
      const range = dateRange(anchor, date).filter((candidate) => candidate > today);
      setSelection((current) => new Set([...current, ...range]));
      return;
    }
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    setAnchor(date);
  };

  const onDayClick = (event: MouseEvent<HTMLButtonElement>, date: string) => {
    toggleDate(date, event.shiftKey);
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    let target: string;
    switch (event.key) {
      case "ArrowLeft": target = addDays(date, -1); break;
      case "ArrowRight": target = addDays(date, 1); break;
      case "ArrowUp": target = addDays(date, -7); break;
      case "ArrowDown": target = addDays(date, 7); break;
      case "Home": target = addDays(date, -mondayIndex(date)); break;
      case "End": target = addDays(date, 6 - mondayIndex(date)); break;
      case "PageUp": target = sameDayInMonth(date, -1); break;
      case "PageDown": target = sameDayInMonth(date, 1); break;
      case "Enter":
      case " ":
        // Se maneja acá (y no con el click nativo) para leer Shift de forma confiable.
        event.preventDefault();
        toggleDate(date, event.shiftKey);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(target);
  };

  const applyTarget = (target: DraftDay) => {
    if (selection.size === 0 || !canEdit) return;
    const changed = [...selection];
    setDraft((current) => applyToDates(current, changed, target, serverOf));
    setSelection(new Set());
    setSave((current) => {
      if (current.status === "invalid") {
        const byDate = Object.fromEntries(
          Object.entries(current.errors.byDate).filter(([date]) => !changed.includes(date)),
        );
        return { ...current, errors: { byDate, general: current.errors.general } };
      }
      return current.status === "saved" ? { status: "idle" } : current;
    });
  };

  const selectMonth = () => {
    if (!canEdit || !readyDays) return;
    setSelection((current) => new Set([...current, ...dates.filter((date) => date > today)]));
  };

  const discardDraft = () => {
    setDraft(new Map());
    setSelection(new Set());
    setSave({ status: "idle" });
  };

  const reloadAfterConflict = () => {
    // Recargar nunca reenvía: trae el estado actual, adopta su versión y deja el
    // borrador para que la persona lo revise y decida si vuelve a guardar.
    versionRef.current = null;
    setBaseVersion(null);
    setVersionDrift(false);
    setMonths({ [month]: { status: "loading" } });
    setFetchKey((key) => key + 1);
    setSave({ status: "idle" });
  };

  const retryMonth = () => {
    setMonths((current) => ({ ...current, [month]: { status: "loading" } }));
    setFetchKey((key) => key + 1);
  };

  const saveDraft = async () => {
    if (baseVersion === null || draft.size === 0 || !canEdit || saving) return;
    const batch = draftToBatch(draft);
    const body: UpdateAvailabilityInput = { expected_version: baseVersion, days: batch };
    setSave({ status: "saving" });
    try {
      const { data } = await mutateBrowserJson(availabilityPath(profile.id), "PUT", body, isAvailabilityResponse);
      const cityById = new Map(profile.cities.map((city) => [city.id, city]));
      // El lote se aplicó completo: cada fecha enviada pasa a ser estado confirmado y
      // el mes devuelto (el de la fecha más temprana) reemplaza al de la caché.
      setMonths((current) => {
        const next: Record<string, MonthEntry> = { ...current };
        for (const [key, cached] of Object.entries(current)) {
          if (cached.status !== "ready") continue;
          const items = batch.filter((item) => monthOf(item.date) === key);
          if (items.length === 0) continue;
          const days = new Map(cached.days);
          for (const item of items) {
            days.set(item.date, item.available
              ? { available: true, city: cityById.get(item.city_id) ?? null }
              : { available: false, city: null });
          }
          next[key] = { status: "ready", days };
        }
        next[data.month] = { status: "ready", days: serverDaysFrom(data) };
        return next;
      });
      versionRef.current = data.version;
      setBaseVersion(data.version);
      setVersionDrift(false);
      setDraft(new Map());
      setSelection(new Set());
      setSave({ status: "saved", count: batch.length, version: data.version });
    } catch (reason: unknown) {
      if (redirectIfUnauthorized(reason)) return;
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setSave({ status: "conflict", message: reason.message });
      } else if (reason instanceof ApiRequestError && reason.status === 422) {
        setSave({ status: "invalid", message: reason.message, errors: batchErrors(reason.fields, batch) });
      } else if (reason instanceof ApiRequestError && reason.status === 403) {
        setSave({ status: "forbidden", code: reason.code, message: reason.message });
      } else if (reason instanceof ApiRequestError) {
        setSave({ status: "failed", message: reason.message });
      } else {
        setSave({ status: "failed", message: t("No pudimos conectar con el servidor.") });
      }
    }
  };

  const dayView = (date: string) => {
    const server = readyDays?.get(date);
    const pending = draft.get(date);
    const available = pending ? pending.available : server?.available ?? false;
    const city = pending
      ? pending.available ? profile.cities.find((candidate) => candidate.id === pending.cityId) ?? null : null
      : server?.city ?? null;
    const dayErrors = errors.byDate[date] ?? [];
    const isToday = date === today;
    const isPast = date < today;
    const loading = server === undefined;
    const editable = isEditable(date);
    const selected = selection.has(date);

    // Nombre accesible: la fecha y una lista de estados separados por coma.
    const parts = [longDateLabel(date, locale)];
    if (isToday) parts.push(t("hoy"));
    if (loading) parts.push(t("cargando"));
    else parts.push(available ? city ? t("disponible en {city}", { city: city.name }) : t("disponible") : t("bloqueado"));
    if (isToday || isPast) parts.push(t("no editable"));
    else if (!canEdit) parts.push(t("solo lectura"));
    if (pending) parts.push(t("cambio sin guardar"));
    if (dayErrors.length > 0) parts.push(t("error: {errors}", { errors: dayErrors.join(" ") }));

    const mark = loading
      ? "…"
      : isToday
        ? t("HOY")
        : available
          ? city ? codes.get(city.id) ?? city.name.slice(0, 3).toLocaleUpperCase("es") : "✓"
          : "—";

    return { available, city, dayErrors, isToday, isPast, loading, editable, selected, pending, label: parts.join(", "), mark };
  };

  const leading = dates.length > 0 ? mondayIndex(dates[0]) : 0;
  const cells: Array<string | null> = [...Array.from({ length: leading }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));

  const monthHasAvailability = readyDays
    ? dates.some((date) => (draft.get(date)?.available ?? readyDays.get(date)?.available) === true)
    : false;
  const pendingChanges = draftToBatch(draft);
  const monthLabel = monthTitle(month, locale);
  const weekdays = weekdayNames(locale);

  return (
    <section className={styles.panel} aria-labelledby="availability-title">
      <p className={styles.eyebrow}>{t("Calendario del perfil")}</p>
      <h1 id="availability-title">{t("Disponibilidad")}</h1>
      <p className={styles.lead}>
        {t("Todos los días están bloqueados por defecto. Habilitá los días en que estás disponible y elegí la ciudad de cada uno. Hoy y los días pasados no se editan.")}
      </p>

      <div role="status" data-realtime={realtimeMode}>
        {realtimeMode === "polling" ? (
          <p className={styles.lockedNotice}>
            {t("Sin conexión en tiempo real: revisamos cada 30 segundos si tu calendario cambió en otra sesión.")}
          </p>
        ) : null}
      </div>

      {noCities ? (
        <div className={styles.lockedNotice} role="status">
          <strong>{t("Primero cargá tus ciudades")}</strong>
          <p>{t("Cada día disponible necesita una de las ciudades de tu perfil. Todavía no elegiste ninguna.")}</p>
          <Link className={styles.secondaryLink} href={profileUrl("/app/profile", profile.id)}>{t("Cargar ciudades en el perfil")}</Link>
        </div>
      ) : null}

      {accessReason !== null || forbidden !== null ? (
        <div className={styles.lockedNotice} role={forbidden ? "alert" : "status"}>
          <strong>{t("Calendario en solo lectura")}</strong>
          <p>
            {forbidden ? forbiddenReason(forbidden.code, forbidden.message, t) : accessReason}{" "}
            {t("Podés ver tu calendario, pero no publicar cambios.")}
            {forbidden && draft.size > 0 ? ` ${t("Tu borrador no se guardó y sigue en esta pantalla.")}` : ""}
          </p>
          <Link className={styles.secondaryLink} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
        </div>
      ) : null}

      <div className={styles.calendarCard}>
        <div className={styles.monthNavigation}>
          <button
            type="button"
            onClick={() => goToMonth(addMonths(month, -1))}
            aria-label={t("Mes anterior, {month}", { month: monthTitle(addMonths(month, -1), locale) })}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <h2 id={titleId} aria-live="polite">{monthLabel}</h2>
          <button
            type="button"
            onClick={() => goToMonth(addMonths(month, 1))}
            aria-label={t("Mes siguiente, {month}", { month: monthTitle(addMonths(month, 1), locale) })}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <ul className={styles.legend} aria-label={t("Referencias del calendario")}>
          {profile.cities.map((city) => (
            <li key={city.id}><span className={styles.legendAvailable} aria-hidden="true">{codes.get(city.id)}</span>{t("Disponible en {city}", { city: city.name })}</li>
          ))}
          <li><span className={styles.legendBlocked} aria-hidden="true">—</span>{t("Bloqueado (por defecto)")}</li>
          <li><span className={styles.legendToday} aria-hidden="true">{t("HOY")}</span>{t("Hoy, no editable")}</li>
          <li><span className={styles.legendSelected} aria-hidden="true">✓</span>{t("Seleccionado")}</li>
          <li><span className={styles.legendDraft} aria-hidden="true">•</span>{t("Cambio sin guardar")}</li>
        </ul>

        {entry?.status === "error" ? (
          <div className={styles.errorNotice} role="alert">
            <strong>{t("No pudimos cargar {month}", { month: monthLabel })}</strong>
            <p>{entry.message ?? t("No pudimos cargar la disponibilidad.")}</p>
            <button type="button" className={styles.secondaryButton} onClick={retryMonth}>{t("Reintentar")}</button>
          </div>
        ) : (
          <table
            className={styles.grid}
            role="grid"
            aria-labelledby={titleId}
            aria-describedby={helpId}
            aria-busy={entry?.status === "loading" || undefined}
          >
            <thead>
              <tr>
                {weekdayShortNames(locale).map((short, index) => (
                  <th key={short} scope="col">
                    <span aria-hidden="true">{short}</span>
                    <span className={styles.srOnly}>{weekdays[index]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, weekIndex) => (
                <tr key={`${month}-${weekIndex}`}>
                  {week.map((date, dayIndex) => {
                    if (!date) return <td key={`empty-${weekIndex}-${dayIndex}`} />;
                    const view = dayView(date);
                    return (
                      <td key={date}>
                        <button
                          type="button"
                          ref={(node) => {
                            if (node) buttons.current.set(date, node);
                            else buttons.current.delete(date);
                          }}
                          className={styles.day}
                          tabIndex={date === rovingDate ? 0 : -1}
                          aria-label={view.label}
                          aria-pressed={view.editable || view.selected ? view.selected : undefined}
                          aria-disabled={view.editable ? undefined : true}
                          data-date={date}
                          data-state={view.loading ? "loading" : view.available ? "available" : "blocked"}
                          data-today={view.isToday || undefined}
                          data-past={view.isPast || undefined}
                          data-draft={view.pending ? true : undefined}
                          data-error={view.dayErrors.length > 0 || undefined}
                          onClick={(event) => onDayClick(event, date)}
                          onKeyDown={(event) => onDayKeyDown(event, date)}
                          onKeyUp={(event) => {
                            if (event.key === " ") event.preventDefault();
                          }}
                        >
                          <span className={styles.dayNumber} aria-hidden="true">{Number(date.slice(8, 10))}</span>
                          <span className={styles.dayMark} aria-hidden="true">
                            {view.dayErrors.length > 0 ? `!${view.mark}` : view.mark}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p id={helpId} className={styles.help}>
          {t("Clic, Enter o Espacio seleccionan un día futuro. Con Shift se selecciona el rango inclusivo desde el último día elegido. Las flechas mueven el foco; Re Pág y Av Pág cambian de mes.")}
        </p>

        {readyDays && !monthHasAvailability ? (
          <p className={styles.empty}>{t("Sin disponibilidad publicada en {month}.", { month: monthInSentence(month, locale) })}</p>
        ) : null}
      </div>

      {canEdit ? (
        <div className={styles.toolbar} role="group" aria-label={t("Acciones sobre los días seleccionados")}>
          <p className={styles.selectionCount} aria-live="polite">
            {selection.size === 0
              ? t("Ningún día seleccionado.")
              : selection.size === 1
                ? t("{count} día seleccionado.", { count: selection.size })
                : t("{count} días seleccionados.", { count: selection.size })}
          </p>
          <label className={styles.cityField}>
            <span>{t("Ciudad")}</span>
            <select value={selectedCity?.id ?? ""} onChange={(event) => setCityId(Number(event.target.value))}>
              {profile.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={selection.size === 0 || !selectedCity}
            onClick={() => selectedCity && applyTarget({ available: true, cityId: selectedCity.id })}
          >
            {t("Disponible en {city}", { city: selectedCity?.name ?? "" })}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={selection.size === 0}
            onClick={() => applyTarget({ available: false })}
          >
            {t("Bloquear")}
          </button>
          <button type="button" className={styles.ghostButton} disabled={!readyDays} onClick={selectMonth}>
            {t("Seleccionar días futuros del mes")}
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={selection.size === 0}
            onClick={() => setSelection(new Set())}
          >
            {t("Limpiar selección")}
          </button>
        </div>
      ) : null}

      {versionDrift ? (
        <div className={styles.lockedNotice} role="status">
          <strong>{t("El calendario cambió en otra sesión")}</strong>
          <p>{t("Tus cambios se armaron sobre una versión anterior. Al guardar vas a tener que recargar.")}</p>
        </div>
      ) : null}

      {save.status === "saved" ? (
        <div className={styles.successNotice} role="status">
          {save.count === 1
            ? t("Guardamos {count} día. Versión del calendario: {version}.", { count: save.count, version: save.version })
            : t("Guardamos {count} días. Versión del calendario: {version}.", { count: save.count, version: save.version })}
        </div>
      ) : null}

      {save.status === "conflict" ? (
        <div className={styles.errorNotice} role="alert">
          <strong>{t("Otra sesión cambió el calendario")}</strong>
          <p>
            {t("No guardamos ni reenviamos tus cambios. Recargá para ver el estado actual: tu borrador se conserva para que lo revises antes de volver a guardar.")}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={reloadAfterConflict}>{t("Recargar calendario")}</button>
        </div>
      ) : null}

      {save.status === "invalid" ? (
        <div className={styles.errorNotice} role="alert">
          <strong>{t("No se guardó ningún día")}</strong>
          <p>{save.message} {t("Corregí los días marcados; tu borrador sigue intacto.")}</p>
          {save.errors.general.length > 0 ? (
            <ul>{save.errors.general.map((message) => <li key={message}>{message}</li>)}</ul>
          ) : null}
        </div>
      ) : null}

      {save.status === "failed" ? (
        <div className={styles.errorNotice} role="alert">
          <strong>{t("No se guardó ningún día")}</strong>
          <p>{save.message} {t("Tu borrador sigue intacto: podés reintentar.")}</p>
        </div>
      ) : null}

      {pendingChanges.length > 0 ? (
        <section className={styles.pending} aria-labelledby="availability-pending-title">
          <h2 id="availability-pending-title">
            {pendingChanges.length === 1
              ? t("{count} cambio sin guardar", { count: pendingChanges.length })
              : t("{count} cambios sin guardar", { count: pendingChanges.length })}
          </h2>
          <ul>
            {pendingChanges.map((item) => {
              const itemErrors = errors.byDate[item.date] ?? [];
              const city = item.available ? profile.cities.find((candidate) => candidate.id === item.city_id) : undefined;
              return (
                <li key={item.date} data-date={item.date} data-error={itemErrors.length > 0 || undefined}>
                  <span>{shortDateLabel(item.date, locale)}</span>
                  <span>{item.available ? t("Disponible en {city}", { city: city?.name ?? t("ciudad del perfil") }) : t("Bloqueado")}</span>
                  {itemErrors.length > 0 ? <strong className={styles.fieldError}>{itemErrors.join(" ")}</strong> : null}
                </li>
              );
            })}
          </ul>
          {canEdit ? (
            <div className={styles.saveActions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={saving || save.status === "conflict" || baseVersion === null}
                onClick={() => void saveDraft()}
              >
                {saving ? t("Guardando…") : save.status === "failed" ? t("Reintentar guardado") : t("Guardar cambios")}
              </button>
              <button type="button" className={styles.ghostButton} disabled={saving} onClick={discardDraft}>
                {t("Descartar cambios")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
