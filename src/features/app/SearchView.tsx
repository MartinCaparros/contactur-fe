"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";
import { DIRECTORY_CHANNEL, REALTIME_EVENTS, profileChannel } from "@/lib/realtime/channels";
import { useInvalidationRefresh, useRealtimeEvents } from "@/lib/realtime/RealtimeProvider";

import {
  type AccessEvaluation,
  ApiRequestError,
  type City,
  type Profile,
  RECEIVER_CATEGORIES,
  type SearchResult,
  getBrowserJson,
  isCatalogsResponse,
  isSearchResponse,
  searchPath,
} from "./api";
import {
  CATEGORY_LABELS,
  EMPTY_FILTERS,
  LAST_SEARCH_KEY,
  type MatchMode,
  type SearchFilters,
  type VerifiedFilter,
  availabilityText,
  filtersFromSearch,
  filtersToQuery,
  forbiddenText,
  hasFullRange,
  searchUrlFor,
  summarizeNames,
  withCursor,
} from "./directoryModel";
import styles from "./Directory.module.css";

type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** `message: null` = sin mensaje propio del error: se muestra el texto genérico traducido al render. */
type ResultsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; items: readonly SearchResult[]; nextCursor: string | null }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "invalid"; fields: FieldErrors; message: string }>
  | Readonly<{ status: "error"; message: string | null }>;

type MoreState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string | null }>;

type CitiesState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; cities: readonly City[] }>
  | Readonly<{ status: "error" }>;

/** Campos del filtro que pueden traer error 422 propio; el resto se muestra como general. */
const FILTER_FIELDS = ["type", "name", "city_id", "date_from", "date_to", "match_mode", "verified"] as const;

const DIRECTORY_EVENTS = [REALTIME_EVENTS.availabilityChanged, REALTIME_EVENTS.directoryChanged] as const;
const ACCESS_EVENTS = [REALTIME_EVENTS.accessChanged] as const;
/** Cuánto queda visible el aviso breve de "resultados actualizados". */
const LIVE_MESSAGE_MS = 6000;

function sameResults(previous: readonly SearchResult[], next: readonly SearchResult[]): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

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

/**
 * El cursor es opaco y ligado a los filtros: 409 `search_cursor_mismatch` (otros
 * filtros) o 422 en `cursor` (adulterado) significan que la página siguiente ya no
 * vale. La respuesta correcta es volver a la primera página, no reintentar.
 */
function isCursorRejected(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError)) return false;
  if (reason.status === 409 && reason.code === "search_cursor_mismatch") return true;
  return reason.status === 422 && Boolean(reason.fields.cursor?.length);
}

function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Volver a la búsqueda sin filtros sigue funcionando si sessionStorage no está disponible.
  }
}

function initialFilters(): SearchFilters {
  return typeof window === "undefined" ? EMPTY_FILTERS : filtersFromSearch(window.location.search);
}

/**
 * `/app/search`. El buscador es de empresas turísticas (R19): un perfil receptor que
 * llega por URL ve la explicación y no se hace ninguna consulta de búsqueda. Laravel
 * igual valida `can_search` en cada request; este corte es solo de experiencia.
 */
export function SearchView({
  profile,
  access = null,
}: Readonly<{ profile: Profile; access?: AccessEvaluation | null }>) {
  const t = useT();
  const locale = useLocale();
  if (profile.category !== "tourism_company") {
    return (
      <section className={styles.panel} aria-labelledby="search-title">
        <p className={styles.eyebrow}>{t("Buscar")}</p>
        <h1 id="search-title">{t("La búsqueda es para empresas turísticas")}</h1>
        <p className={styles.lead}>
          {t(
            "Los perfiles de {category} reciben solicitudes de contacto; las empresas turísticas son quienes buscan y las inician. Mantené tu perfil y tu disponibilidad al día para aparecer en sus resultados.",
            { category: t(CATEGORY_LABELS[profile.category]).toLocaleLowerCase(locale) },
          )}
        </p>
        <div className={styles.actionsRow}>
          <Link className={styles.primaryAction} href={profileUrl("/app", profile.id)}>{t("Volver al resumen")}</Link>
          <Link className={styles.secondaryAction} href={profileUrl("/app/availability", profile.id)}>{t("Ver mi disponibilidad")}</Link>
        </div>
      </section>
    );
  }
  return <CompanySearch profile={profile} access={access} />;
}

function CompanySearch({ profile, access }: Readonly<{ profile: Profile; access: AccessEvaluation | null }>) {
  const t = useT();
  const [applied, setApplied] = useState<SearchFilters>(initialFilters);
  const [draft, setDraft] = useState<SearchFilters>(applied);
  /** Cambia para forzar otra primera página con los mismos filtros (Buscar otra vez, 409). */
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Readonly<{ key: string; state: ResultsState }> | null>(null);
  const [more, setMore] = useState<MoreState>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [cities, setCities] = useState<CitiesState>({ status: "loading" });
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const silentController = useRef<AbortController | null>(null);
  const liveMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Páginas acumuladas con "Cargar más"; un refresco silencioso vuelve a la primera. */
  const pagesLoaded = useRef(1);

  const query = filtersToQuery(applied);
  const requestKey = `${query}#${run}`;
  const state: ResultsState = loaded?.key === requestKey ? loaded.state : { status: "loading" };
  const latest = useRef({ state, requestKey, query, moreLoading: more.status === "loading" });

  useEffect(() => {
    latest.current = { state, requestKey, query, moreLoading: more.status === "loading" };
  });

  useEffect(() => () => {
    silentController.current?.abort();
    if (liveMessageTimer.current !== null) clearTimeout(liveMessageTimer.current);
  }, []);

  const announce = useCallback((message: string) => {
    if (liveMessageTimer.current !== null) clearTimeout(liveMessageTimer.current);
    setLiveMessage(message);
    liveMessageTimer.current = setTimeout(() => {
      liveMessageTimer.current = null;
      setLiveMessage(null);
    }, LIVE_MESSAGE_MS);
  }, []);

  /**
   * Re-consulta la primera página con los mismos filtros sin pasar por "cargando": los
   * resultados actuales quedan visibles hasta que llega la respuesta y la generación
   * descarta respuestas viejas. El aviso de websocket nunca aporta datos; un 403 acá
   * significa que el acceso cambió y se muestra el bloqueo real.
   */
  const refreshSilently = useCallback(() => {
    const snapshot = latest.current;
    if (snapshot.state.status !== "ready") return;
    const previousItems = snapshot.state.items;
    const hadMorePages = pagesLoaded.current > 1;
    const key = snapshot.requestKey;
    silentController.current?.abort();
    if (snapshot.moreLoading) {
      moreController.current?.abort();
      setMore({ status: "idle" });
    }
    const controller = new AbortController();
    silentController.current = controller;
    const current = ++generation.current;

    void getBrowserJson(searchPath(profile.id, snapshot.query), isSearchResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        pagesLoaded.current = 1;
        setMore({ status: "idle" });
        setLoaded({ key, state: { status: "ready", items: response.data, nextCursor: response.meta.next_cursor } });
        // Se guarda el texto fuente y se traduce al render: el aviso sigue el idioma activo.
        if (hadMorePages) {
          announce(tk("Hubo cambios en el directorio: actualizamos los resultados y volvimos a la primera página con los mismos filtros."));
        } else if (!sameResults(previousItems, response.data)) {
          announce(tk("Resultados actualizados."));
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setMore({ status: "idle" });
          setLoaded({ key, state: { status: "forbidden", code: reason.code, message: reason.message } });
        }
        // Otros fallos conservan los resultados visibles; el próximo aviso o el polling reintenta.
      });
  }, [announce, profile.id]);

  // Sin `can_search` vigente no se escucha el directorio: el canal se libera solo.
  const directoryChannel = access && !access.capabilities.can_search ? null : DIRECTORY_CHANNEL;
  const { mode: realtimeMode } = useInvalidationRefresh({
    channel: directoryChannel,
    events: DIRECTORY_EVENTS,
    refresh: refreshSilently,
  });

  // Si cambió el acceso del perfil propio se vuelve a preguntar a la API; un bloqueo
  // anterior se reemplaza por una búsqueda nueva si ahora está permitido.
  const onAccessChanged = useCallback(() => {
    if (latest.current.state.status === "forbidden") {
      setRun((value) => value + 1);
      return;
    }
    refreshSilently();
  }, [refreshSilently]);
  useRealtimeEvents(profileChannel(profile.id), ACCESS_EVENTS, onAccessChanged);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson("/api/backend/v1/catalogs?per_page=50", isCatalogsResponse, controller.signal)
      .then(({ data }) => setCities({ status: "ready", cities: data.cities }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        setCities({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  // Filtros ⇄ URL: recargable y compartible. El cursor nunca se escribe.
  useEffect(() => {
    window.history.replaceState(window.history.state, "", searchUrlFor(window.location.href, applied));
    sessionSet(LAST_SEARCH_KEY, query);
  }, [applied, query]);

  // Primera página. Cada búsqueda tiene su generación: una respuesta tardía de filtros
  // anteriores (o un "Cargar más" en vuelo) nunca pisa los resultados vigentes.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    moreController.current?.abort();
    silentController.current?.abort();
    const key = requestKey;

    void getBrowserJson(searchPath(profile.id, query), isSearchResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        pagesLoaded.current = 1;
        setLoaded({ key, state: { status: "ready", items: response.data, nextCursor: response.meta.next_cursor } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setLoaded({ key, state: { status: "forbidden", code: reason.code, message: reason.message } });
          return;
        }
        if (reason instanceof ApiRequestError && reason.status === 422) {
          setLoaded({ key, state: { status: "invalid", fields: reason.fields, message: reason.message } });
          return;
        }
        setLoaded({ key, state: { status: "error", message: messageFrom(reason) } });
      });

    return () => controller.abort();
  }, [profile.id, query, requestKey]);

  const startSearch = (filters: SearchFilters) => {
    setNotice(null);
    setMore({ status: "idle" });
    setApplied(filters);
    setDraft(filters);
    setRun((value) => value + 1);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startSearch({ ...draft, name: draft.name.trim() });
  };

  const loadMore = async () => {
    if (state.status !== "ready" || state.nextCursor === null || more.status === "loading") return;
    const current = generation.current;
    const key = requestKey;
    const previous = state.items;
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ status: "loading" });
    try {
      const response = await getBrowserJson(
        searchPath(profile.id, withCursor(query, state.nextCursor)),
        isSearchResponse,
        controller.signal,
      );
      if (controller.signal.aborted || current !== generation.current) return;
      const known = new Set(previous.map((item) => item.safe_profile.id));
      const items = [...previous, ...response.data.filter((item) => !known.has(item.safe_profile.id))];
      pagesLoaded.current += 1;
      setLoaded({ key, state: { status: "ready", items, nextCursor: response.meta.next_cursor } });
      setMore({ status: "idle" });
    } catch (reason) {
      if (controller.signal.aborted || current !== generation.current) return;
      if (redirectIfUnauthorized(reason)) return;
      if (isCursorRejected(reason)) {
        setMore({ status: "idle" });
        setNotice(tk("Los resultados cambiaron y la página siguiente ya no es válida. Volvimos a la primera página con los mismos filtros."));
        setRun((value) => value + 1);
        return;
      }
      setMore({ status: "error", message: messageFrom(reason) });
    }
  };

  const fields: FieldErrors = state.status === "invalid" ? state.fields : {};
  const generalErrors = state.status === "invalid"
    ? Object.entries(state.fields)
        .filter(([field]) => !FILTER_FIELDS.some((name) => name === field))
        .flatMap(([, messages]) => messages)
    : [];
  const errorFor = (field: (typeof FILTER_FIELDS)[number]) => fields[field]?.[0];
  const describedBy = (field: (typeof FILTER_FIELDS)[number], hint?: string) => {
    const ids = [hint, errorFor(field) ? `search-${field}-error` : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  };
  const fieldError = (field: (typeof FILTER_FIELDS)[number]) => errorFor(field)
    ? <span className={styles.fieldError} id={`search-${field}-error`}>{errorFor(field)}</span>
    : null;

  const update = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const cityOptions = cities.status === "ready" ? cities.cities : [];

  return (
    <section className={styles.panel} aria-labelledby="search-title">
      <p className={styles.eyebrow}>{t("Directorio de miembros")}</p>
      <h1 id="search-title">{t("Buscar profesionales")}</h1>
      <p className={styles.lead}>
        {t("Filtrá por categoría, ciudad y fechas. Con un rango, “Todos los días” exige cada fecha en la misma ciudad; “Al menos un día” muestra coincidencias parciales con su conteo.")}
      </p>

      <form className={styles.filters} onSubmit={submit} aria-label={t("Filtros de búsqueda")} noValidate>
        <div className={styles.field}>
          <label htmlFor="search-type">{t("Categoría")}</label>
          <select
            id="search-type"
            name="type"
            value={draft.type}
            aria-invalid={errorFor("type") ? true : undefined}
            aria-describedby={describedBy("type")}
            onChange={(event) => {
              const value = event.target.value;
              update("type", RECEIVER_CATEGORIES.find((category) => category === value) ?? "");
            }}
          >
            <option value="">{t("Todas las categorías")}</option>
            {RECEIVER_CATEGORIES.map((category) => (
              <option key={category} value={category}>{t(CATEGORY_LABELS[category])}</option>
            ))}
          </select>
          {fieldError("type")}
        </div>

        <div className={styles.field}>
          <label htmlFor="search-name">{t("Nombre")}</label>
          <input
            id="search-name"
            name="name"
            type="search"
            maxLength={100}
            value={draft.name}
            autoComplete="off"
            aria-invalid={errorFor("name") ? true : undefined}
            aria-describedby={describedBy("name")}
            onChange={(event) => update("name", event.target.value)}
          />
          {fieldError("name")}
        </div>

        <div className={styles.field}>
          <label htmlFor="search-city_id">{t("Ciudad")}</label>
          <select
            id="search-city_id"
            name="city_id"
            value={draft.cityId}
            disabled={cities.status === "loading"}
            aria-invalid={errorFor("city_id") ? true : undefined}
            aria-describedby={describedBy("city_id", cities.status === "error" ? "search-cities-hint" : undefined)}
            onChange={(event) => update("cityId", event.target.value)}
          >
            <option value="">{cities.status === "loading" ? t("Cargando ciudades…") : t("Todas las ciudades")}</option>
            {cityOptions.map((city) => <option key={city.id} value={String(city.id)}>{city.name}</option>)}
            {draft.cityId && cities.status !== "loading" && !cityOptions.some((city) => String(city.id) === draft.cityId)
              ? <option value={draft.cityId}>{t("Ciudad {id}", { id: draft.cityId })}</option>
              : null}
          </select>
          {cities.status === "error" ? (
            <span className={styles.hint} id="search-cities-hint">{t("No pudimos cargar el catálogo de ciudades.")}</span>
          ) : null}
          {fieldError("city_id")}
        </div>

        <div className={styles.field}>
          <label htmlFor="search-date_from">{t("Desde")}</label>
          <input
            id="search-date_from"
            name="date_from"
            type="date"
            value={draft.dateFrom}
            aria-invalid={errorFor("date_from") ? true : undefined}
            aria-describedby={describedBy("date_from", "search-range-hint")}
            onChange={(event) => update("dateFrom", event.target.value)}
          />
          {fieldError("date_from")}
        </div>

        <div className={styles.field}>
          <label htmlFor="search-date_to">{t("Hasta")}</label>
          <input
            id="search-date_to"
            name="date_to"
            type="date"
            value={draft.dateTo}
            aria-invalid={errorFor("date_to") ? true : undefined}
            aria-describedby={describedBy("date_to", "search-range-hint")}
            onChange={(event) => update("dateTo", event.target.value)}
          />
          {fieldError("date_to")}
        </div>

        <div className={styles.field}>
          <label htmlFor="search-verified">{t("Verificación")}</label>
          <select
            id="search-verified"
            name="verified"
            value={draft.verified}
            aria-invalid={errorFor("verified") ? true : undefined}
            aria-describedby={describedBy("verified")}
            onChange={(event) => {
              const value = event.target.value;
              update("verified", (value === "true" || value === "false" ? value : "") satisfies VerifiedFilter);
            }}
          >
            <option value="">{t("Todos los perfiles")}</option>
            <option value="true">{t("Solo verificados")}</option>
            <option value="false">{t("Sin verificación")}</option>
          </select>
          {fieldError("verified")}
        </div>

        <fieldset className={styles.matchMode} aria-describedby={describedBy("match_mode", "search-range-hint")}>
          <legend>{t("Coincidencia de fechas")}</legend>
          {(["all", "any"] as const satisfies readonly MatchMode[]).map((mode) => (
            <label key={mode} className={styles.radio}>
              <input
                type="radio"
                name="match_mode"
                value={mode}
                checked={draft.matchMode === mode}
                onChange={() => update("matchMode", mode)}
              />
              <span>{mode === "all" ? t("Todos los días del rango") : t("Al menos un día del rango")}</span>
            </label>
          ))}
          {fieldError("match_mode")}
        </fieldset>

        <p className={styles.hint} id="search-range-hint">
          {t("El rango es inclusivo, de hasta 90 días. Para un solo día usá la misma fecha en ambos campos.")}
        </p>

        <div className={styles.filterActions}>
          <button type="submit" className={styles.primaryButton}>{t("Buscar perfiles")}</button>
          <button type="button" className={styles.secondaryButton} onClick={() => startSearch(EMPTY_FILTERS)}>
            {t("Limpiar filtros")}
          </button>
        </div>
      </form>

      {notice ? <div className={styles.notice} role="status">{t(notice)}</div> : null}

      {/* Región polite siempre presente: anuncia cambios sin mover el foco. Nunca muestra datos de un aviso. */}
      <div className={styles.realtimeStatus} role="status" data-realtime={realtimeMode}>
        {realtimeMode === "polling" ? (
          <p className={styles.notice}>
            {t("Sin conexión en tiempo real: actualizamos los resultados cada 30 segundos, así que los cambios pueden tardar en aparecer.")}
          </p>
        ) : null}
        {liveMessage ? <p className={styles.muted}>{t(liveMessage)}</p> : null}
      </div>

      <section className={styles.results} aria-labelledby="search-results-title" aria-busy={state.status === "loading"}>
        <h2 id="search-results-title" className={styles.resultsTitle}>{t("Resultados")}</h2>

        {state.status === "loading" ? (
          <p className={styles.muted} role="status">{t("Buscando perfiles…")}</p>
        ) : null}

        {state.status === "forbidden" ? (
          <div className={styles.blocked} role="alert">
            <h3>{t("No podés usar el buscador en este momento")}</h3>
            <p>{forbiddenText(state.code, state.message, t)}</p>
            <Link className={styles.primaryAction} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        ) : null}

        {state.status === "invalid" ? (
          <div className={styles.errorBox} role="alert">
            <h3>{t("Revisá los filtros")}</h3>
            <p>{generalErrors.length > 0 ? generalErrors.join(" ") : t("Hay filtros con valores que no podemos usar. El detalle está junto a cada campo.")}</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={styles.errorBox} role="alert">
            <h3>{t("No pudimos completar la búsqueda")}</h3>
            <p>{state.message ?? t("No pudimos completar la búsqueda.")}</p>
            <button type="button" className={styles.secondaryButton} onClick={() => setRun((value) => value + 1)}>{t("Reintentar")}</button>
          </div>
        ) : null}

        {state.status === "ready" && state.items.length === 0 ? (
          <div className={styles.empty} role="status">
            <h3>{t("Ningún perfil coincide con estos filtros")}</h3>
            {applied.matchMode === "all" && hasFullRange(applied) ? (
              <>
                <p>
                  {t("Con “Todos los días del rango” cada fecha tiene que estar disponible en la misma ciudad. Probá con “Al menos un día del rango” para ver coincidencias parciales.")}
                </p>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => startSearch({ ...applied, matchMode: "any" })}
                >
                  {t("Ver coincidencias parciales")}
                </button>
              </>
            ) : (
              <p>{t("Probá quitar algún filtro o ampliar el rango de fechas.")}</p>
            )}
          </div>
        ) : null}

        {state.status === "ready" && state.items.length > 0 ? (
          <>
            <p className={styles.muted} aria-live="polite">
              {loadedCountText(t, state.items.length, state.nextCursor !== null)}
            </p>
            <ul className={styles.cards}>
              {state.items.map((result) => (
                <ResultCard key={result.safe_profile.id} result={result} actorId={profile.id} />
              ))}
            </ul>
            {state.nextCursor ? (
              <div className={styles.moreRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={more.status === "loading"}
                >
                  {more.status === "loading" ? t("Cargando…") : t("Cargar más")}
                </button>
                {more.status === "error" ? (
                  <p className={styles.fieldError} role="alert">{more.message ?? t("No pudimos cargar más resultados.")}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}

/** Un literal por combinación (plural y "hay más") para que cada idioma ordene la frase. */
function loadedCountText(t: Translate, count: number, hasMore: boolean): string {
  if (count === 1) return hasMore ? t("{count} perfil cargado · hay más resultados", { count }) : t("{count} perfil cargado", { count });
  return hasMore ? t("{count} perfiles cargados · hay más resultados", { count }) : t("{count} perfiles cargados", { count });
}

function ResultCard({ result, actorId }: Readonly<{ result: SearchResult; actorId: string }>) {
  const t = useT();
  const safe = result.safe_profile;
  const availability = availabilityText(result, t);
  const languages = summarizeNames(safe.languages);
  const services = summarizeNames(safe.services);
  const titleId = `result-${safe.id}`;
  return (
    <li>
      <article className={styles.card} aria-labelledby={titleId} data-profile-id={safe.id}>
        <div className={styles.cardHeader}>
          <span className={styles.initial} aria-hidden="true">{safe.display_name.slice(0, 1).toLocaleUpperCase("es")}</span>
          <div>
            <h3 id={titleId}>{safe.display_name}</h3>
            <p>{t(CATEGORY_LABELS[safe.category])}</p>
          </div>
        </div>
        {safe.verified ? (
          <p className={styles.verified}><span aria-hidden="true">✓</span> {t("Verificado")}</p>
        ) : null}
        <dl className={styles.cardFacts}>
          <div><dt>{t("Ciudad principal")}</dt><dd>{safe.primary_city?.name ?? t("Sin ciudad principal")}</dd></div>
          <div><dt>{t("Idiomas")}</dt><dd>{languages ?? t("Sin idiomas cargados")}</dd></div>
          <div><dt>{t("Servicios")}</dt><dd>{services ?? t("Sin servicios cargados")}</dd></div>
        </dl>
        {availability ? (
          <p className={styles.availability} data-status={result.availability_status}>
            <span aria-hidden="true">{result.availability_status === "available" ? "●" : "◐"}</span>
            {availability}
          </p>
        ) : null}
        <Link
          className={styles.cardAction}
          href={`/app/profiles/${safe.id}?profile=${encodeURIComponent(actorId)}`}
          aria-label={t("Ver ficha de {name}", { name: safe.display_name })}
        >
          {t("Ver ficha")}
        </Link>
      </article>
    </li>
  );
}
