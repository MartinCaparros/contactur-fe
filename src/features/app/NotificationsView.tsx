"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { intlLocale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import type { Translate } from "@/lib/i18n/translate";
import { REALTIME_EVENTS, payloadProfileId, profileChannel } from "@/lib/realtime/channels";
import { useInvalidationRefresh } from "@/lib/realtime/RealtimeProvider";

import {
  ApiRequestError,
  type AppNotification,
  type CurrentAccount,
  type NotificationPreference,
  type Profile,
  firstFieldError,
  getBrowserJson,
  isCurrentAccountResponse,
  isNotificationResponse,
  isNotificationsResponse,
  mutateBrowserJson,
  notificationReadPath,
  notificationsPath,
} from "./api";
import {
  ESSENTIAL_EMAILS,
  FILTER_LABELS,
  IN_APP_ONLY,
  type NotificationFilter,
  OPTIONAL_EMAIL_LABELS,
  OPTIONAL_EMAIL_TYPES,
  type OptionalEmailType,
  type PreferenceState,
  describeNotification,
  filterFromSearch,
  notificationDateText,
  notificationsQuery,
  preferenceState,
  preferencesBody,
} from "./notificationsModel";
import { referencesHref } from "./referencesModel";
import { ownAccessText } from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./Notifications.module.css";

const NOTIFICATION_EVENTS = [REALTIME_EVENTS.notificationCreated] as const;
const FILTERS: readonly NotificationFilter[] = ["all", "unread"];

/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type ListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; items: readonly AppNotification[]; nextCursor: string | null }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "error"; message: string | null }>;

type Loaded = Readonly<{ key: string; state: ListState }>;

type MoreState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>;

/** Anuncio para lectores de pantalla; se guarda el hecho y se redacta al mostrarlo. */
type Announcement =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "replaced" }>
  | Readonly<{ kind: "added"; count: number }>;

const NO_ANNOUNCEMENT: Announcement = { kind: "none" };

function announcementText(announcement: Announcement, t: Translate): string {
  switch (announcement.kind) {
    case "replaced":
      return t("Actualizamos la lista con las notificaciones más recientes.");
    case "added":
      return announcement.count === 1
        ? t("Llegó 1 notificación nueva.")
        : t("Llegaron {count} notificaciones nuevas.", { count: announcement.count });
    default:
      return "";
  }
}

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
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

function initialFilter(): NotificationFilter {
  return typeof window === "undefined" ? "all" : filterFromSearch(window.location.search);
}

/** `unread=true` en la URL (recargable); "Todas" lo quita. El cursor nunca va a la URL. */
function writeFilterToUrl(filter: NotificationFilter): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("cursor");
  if (filter === "unread") url.searchParams.set("unread", "true");
  else url.searchParams.delete("unread");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Une una primera página nueva con lo ya cargado sin perder "Cargar más": las nuevas
 * van arriba y las conocidas se actualizan (salvo las que tienen una lectura en vuelo).
 * El cursor keyset (`id < cursor`) sigue siendo válido. Si la página nueva no se
 * solapa con lo cargado y hay más páginas, puede haber un hueco: se reemplaza la lista.
 */
function mergeFirstPage(
  previous: readonly AppNotification[],
  previousCursor: string | null,
  page: readonly AppNotification[],
  pageCursor: string | null,
  pending: ReadonlySet<string>,
): Readonly<{ items: readonly AppNotification[]; nextCursor: string | null; added: number; replaced: boolean }> {
  const known = new Set(previous.map((item) => item.id));
  const overlap = page.some((item) => known.has(item.id));
  if (previous.length > 0 && !overlap && pageCursor !== null) {
    return { items: page, nextCursor: pageCursor, added: page.length, replaced: true };
  }
  const fresh = page.filter((item) => !known.has(item.id));
  const byId = new Map(page.map((item) => [item.id, item]));
  const updated = previous.map((item) => (pending.has(item.id) ? item : byId.get(item.id) ?? item));
  return {
    items: [...fresh, ...updated],
    nextCursor: previous.length === 0 ? pageCursor : previousCursor,
    added: fresh.length,
    replaced: false,
  };
}

/**
 * Insignia del menú: cantidad de no leídas en la primera página (`per_page=20`), con
 * "20+" si hay más. Se re-consulta con `notification.created` del perfil activo (en
 * vivo, o cada 30 s si el socket o el canal están degradados), cuando el centro marca
 * una como leída (`refreshKey`) y al cambiar de perfil (el menú se vuelve a montar).
 * Un fallo conserva el último valor: la insignia nunca bloquea la navegación.
 */
export function useUnreadNotifications(
  profileId: string,
  refreshKey: number,
): Readonly<{ count: number; more: boolean }> | null {
  const [run, setRun] = useState(0);
  const [badge, setBadge] = useState<Readonly<{ profileId: string; count: number; more: boolean }> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson(notificationsPath(profileId, notificationsQuery("unread")), isNotificationsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setBadge({ profileId, count: response.data.length, more: response.meta.next_cursor !== null });
      })
      .catch(() => {
        // Secundaria: el 401 lo resuelve la vista principal y un error no muestra un número inventado.
      });
    return () => controller.abort();
  }, [profileId, refreshKey, run]);

  const refresh = useCallback(() => setRun((value) => value + 1), []);
  const filter = useCallback((_eventName: string, payload: unknown) => payloadProfileId(payload) === profileId, [profileId]);
  useInvalidationRefresh({ channel: profileChannel(profileId), events: NOTIFICATION_EVENTS, filter, refresh });

  return badge && badge.profileId === profileId ? badge : null;
}

/**
 * `/app/notifications`: centro del perfil activo. Lista las del perfil más las de
 * cuenta del titular (nunca las de otro perfil, R05). El componente se monta con
 * `key={profile.id}`: cambiar de perfil descarta el estado y aborta lo que esté en vuelo.
 */
export function NotificationsView({
  profile,
  preferences,
  onUnreadChanged,
  onAccountChange,
}: Readonly<{
  profile: Profile;
  preferences: readonly NotificationPreference[];
  onUnreadChanged: () => void;
  onAccountChange: (account: CurrentAccount) => void;
}>) {
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState<NotificationFilter>(initialFilter);
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState<MoreState>({ status: "idle" });
  const [itemErrors, setItemErrors] = useState<Readonly<Record<string, string>>>({});
  const [announcement, setAnnouncement] = useState<Announcement>(NO_ANNOUNCEMENT);
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const silentController = useRef<AbortController | null>(null);
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  const loadedRef = useRef<Loaded | null>(null);

  const query = notificationsQuery(filter);
  const requestKey = `${query}#${run}`;
  const state: ListState = loaded?.key === requestKey ? loaded.state : { status: "loading" };

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    writeFilterToUrl(filter);
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    moreController.current?.abort();
    silentController.current?.abort();
    const key = requestKey;

    void getBrowserJson(notificationsPath(profile.id, query), isNotificationsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key, state: { status: "ready", items: response.data, nextCursor: response.meta.next_cursor } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setLoaded({ key, state: { status: "forbidden", code: reason.code, message: reason.message } });
          return;
        }
        if (reason instanceof ApiRequestError && reason.status === 404) {
          setLoaded({ key, state: { status: "not-found" } });
          return;
        }
        setLoaded({ key, state: { status: "error", message: errorMessage(reason) } });
      });

    return () => {
      controller.abort();
      moreController.current?.abort();
      silentController.current?.abort();
    };
  }, [profile.id, query, requestKey]);

  /** `notification.created`: re-consulta la primera página sin pasar por "cargando". */
  const refreshSilently = () => {
    const snapshot = loadedRef.current;
    if (!snapshot || snapshot.key !== requestKey || snapshot.state.status !== "ready") return;
    const current = generation.current;
    const key = requestKey;
    silentController.current?.abort();
    const controller = new AbortController();
    silentController.current = controller;
    void getBrowserJson(notificationsPath(profile.id, query), isNotificationsResponse, controller.signal)
      .then((response) => {
        const latest = loadedRef.current;
        if (controller.signal.aborted || current !== generation.current) return;
        if (!latest || latest.key !== key || latest.state.status !== "ready") return;
        const pendingIds: ReadonlySet<string> = new Set(pending.current);
        const page = response.data;
        const pageCursor = response.meta.next_cursor;
        // El texto del anuncio sale de la última foto confirmada; la unión real se hace
        // en el updater para no pisar una lectura optimista aplicada en el medio.
        const merged = mergeFirstPage(latest.state.items, latest.state.nextCursor, page, pageCursor, pendingIds);
        setLoaded((previous) => {
          if (!previous || previous.key !== key || previous.state.status !== "ready") return previous;
          const result = mergeFirstPage(previous.state.items, previous.state.nextCursor, page, pageCursor, pendingIds);
          return { key, state: { status: "ready", items: result.items, nextCursor: result.nextCursor } };
        });
        if (merged.replaced) setAnnouncement({ kind: "replaced" });
        else if (merged.added > 0) setAnnouncement({ kind: "added", count: merged.added });
      })
      .catch((reason: unknown) => {
        // Silenciosa: un fallo conserva la lista visible; el próximo aviso o el polling reintentan.
        if (controller.signal.aborted) return;
        redirectIfUnauthorized(reason);
      });
  };

  const eventFilter = useCallback(
    (_eventName: string, payload: unknown) => payloadProfileId(payload) === profile.id,
    [profile.id],
  );
  useInvalidationRefresh({
    channel: profileChannel(profile.id),
    events: NOTIFICATION_EVENTS,
    filter: eventFilter,
    refresh: refreshSilently,
  });

  const patchItem = (id: string, change: (item: AppNotification) => AppNotification) => {
    setLoaded((previous) => {
      if (!previous || previous.state.status !== "ready") return previous;
      return {
        key: previous.key,
        state: { ...previous.state, items: previous.state.items.map((item) => (item.id === id ? change(item) : item)) },
      };
    });
  };

  const setItemError = (id: string, message: string | null) => {
    setItemErrors((previous) => {
      if (message === null) {
        if (!(id in previous)) return previous;
        const rest = { ...previous };
        delete rest[id];
        return rest;
      }
      return { ...previous, [id]: message };
    });
  };

  /**
   * Optimista: se marca leída al instante y se revierte si el POST falla. Una ya leída
   * o con una lectura en vuelo no repite el POST (el backend es idempotente igual).
   */
  const markRead = async (notification: AppNotification) => {
    if (notification.read_at !== null || pending.current.has(notification.id)) return;
    const id = notification.id;
    pending.current.add(id);
    patchItem(id, (item) => ({ ...item, read_at: new Date().toISOString() }));
    setItemError(id, null);
    try {
      const response = await mutateBrowserJson(notificationReadPath(profile.id, id), "POST", undefined, isNotificationResponse);
      pending.current.delete(id);
      if (!mounted.current) return;
      if (response.data.id === id) patchItem(id, () => response.data);
      onUnreadChanged();
    } catch (reason) {
      pending.current.delete(id);
      if (!mounted.current) return;
      if (redirectIfUnauthorized(reason)) return;
      patchItem(id, (item) => ({ ...item, read_at: null }));
      setItemError(
        id,
        reason instanceof ApiRequestError
          ? t("No pudimos marcarla como leída. Probá de nuevo.")
          : t("No pudimos marcarla como leída por un problema de conexión. Probá de nuevo."),
      );
    }
  };

  const loadMore = async () => {
    if (state.status !== "ready" || state.nextCursor === null || more.status === "loading") return;
    const current = generation.current;
    const key = requestKey;
    const cursor = state.nextCursor;
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ status: "loading" });
    try {
      const response = await getBrowserJson(
        notificationsPath(profile.id, notificationsQuery(filter, cursor)),
        isNotificationsResponse,
        controller.signal,
      );
      if (controller.signal.aborted || current !== generation.current) return;
      setLoaded((previous) => {
        if (!previous || previous.key !== key || previous.state.status !== "ready") return previous;
        const known = new Set(previous.state.items.map((item) => item.id));
        return {
          key,
          state: {
            status: "ready",
            items: [...previous.state.items, ...response.data.filter((item) => !known.has(item.id))],
            nextCursor: response.meta.next_cursor,
          },
        };
      });
      setMore({ status: "idle" });
    } catch (reason) {
      if (controller.signal.aborted || current !== generation.current) return;
      if (redirectIfUnauthorized(reason)) return;
      setMore({ status: "error", message: messageFrom(reason, t("No pudimos cargar más notificaciones.")) });
    }
  };

  const changeFilter = (value: NotificationFilter) => {
    if (value === filter) return;
    setMore({ status: "idle" });
    setAnnouncement(NO_ANNOUNCEMENT);
    setFilter(value);
  };

  return (
    <section className={directoryStyles.panel} aria-labelledby="notifications-title">
      <p className={directoryStyles.eyebrow}>{t("Centro de notificaciones")}</p>
      <h1 id="notifications-title">{t("Notificaciones")}</h1>
      <p className={directoryStyles.lead}>
        {t("Avisos de {name} y de tu cuenta. Los de tus otros perfiles se ven al cambiar el perfil activo.", { name: profile.display_name })}
      </p>

      <div className={styles.filters} role="group" aria-label={t("Filtrar notificaciones")}>
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            className={styles.filterButton}
            aria-pressed={item === filter}
            onClick={() => changeFilter(item)}
          >
            {t(FILTER_LABELS[item])}
          </button>
        ))}
      </div>

      <p className={directoryStyles.srOnly} role="status" aria-live="polite" data-testid="notifications-live">
        {announcementText(announcement, t)}
      </p>

      <div aria-busy={state.status === "loading"}>
        {state.status === "loading" ? <p className={directoryStyles.muted} role="status">{t("Cargando notificaciones…")}</p> : null}

        {state.status === "forbidden" ? (
          <div className={directoryStyles.blocked} role="alert">
            <h2>{t("No podés ver las notificaciones en este momento")}</h2>
            <p>{ownAccessText(state.code, t) ?? state.message}</p>
            <Link className={directoryStyles.primaryAction} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        ) : null}

        {state.status === "not-found" ? (
          <div className={directoryStyles.errorBox} role="alert">
            <h2>{t("Este perfil no está disponible")}</h2>
            <p>{t("No encontramos el perfil activo en tu cuenta. Elegí otro perfil desde el selector.")}</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={directoryStyles.errorBox} role="alert">
            <h2>{t("No pudimos cargar las notificaciones")}</h2>
            <p>{state.message ?? t("No pudimos cargar las notificaciones.")}</p>
            <button type="button" className={directoryStyles.secondaryButton} onClick={() => setRun((value) => value + 1)}>
              {t("Reintentar")}
            </button>
          </div>
        ) : null}

        {state.status === "ready" && state.items.length === 0 ? (
          <div className={directoryStyles.empty} role="status">
            {filter === "unread" ? (
              <>
                <h2>{t("No tenés notificaciones sin leer")}</h2>
                <p>{t("Las que ya leíste siguen disponibles en “Todas”.")}</p>
                <button type="button" className={directoryStyles.secondaryButton} onClick={() => changeFilter("all")}>
                  {t("Ver todas")}
                </button>
              </>
            ) : (
              <>
                <h2>{t("Todavía no tenés notificaciones")}</h2>
                <p>{t("Te avisamos acá cuando haya novedades de tus solicitudes, tu acceso o tu cuenta.")}</p>
              </>
            )}
          </div>
        ) : null}

        {state.status === "ready" && state.items.length > 0 ? (
          <>
            <p className={directoryStyles.muted}>
              {state.items.length === 1
                ? t("1 notificación cargada")
                : t("{count} notificaciones cargadas", { count: state.items.length })}
              {state.nextCursor ? ` · ${t("hay más")}` : ""}
            </p>
            <ul
              className={styles.list}
              aria-label={t("Notificaciones: {filter}", { filter: t(FILTER_LABELS[filter]).toLocaleLowerCase(intlLocale(locale)) })}
            >
              {state.items.map((item) => (
                <NotificationRow
                  key={item.id}
                  notification={item}
                  profileId={profile.id}
                  error={itemErrors[item.id] ?? null}
                  onMarkRead={(value) => void markRead(value)}
                />
              ))}
            </ul>
            {state.nextCursor ? (
              <div className={directoryStyles.moreRow}>
                <button
                  type="button"
                  className={directoryStyles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={more.status === "loading"}
                >
                  {more.status === "loading" ? t("Cargando…") : t("Cargar más")}
                </button>
                {more.status === "error" ? <p className={directoryStyles.fieldError} role="alert">{more.message}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <EmailPreferences preferences={preferences} onAccountChange={onAccountChange} />
    </section>
  );
}

function NotificationRow({
  notification,
  profileId,
  error,
  onMarkRead,
}: Readonly<{
  notification: AppNotification;
  profileId: string;
  error: string | null;
  onMarkRead: (notification: AppNotification) => void;
}>) {
  const t = useT();
  const locale = useLocale();
  const view = describeNotification(notification, t);
  const read = notification.read_at !== null;
  const titleId = `notification-${notification.id}`;
  const errorId = `notification-error-${notification.id}`;
  return (
    <li>
      <article
        className={styles.item}
        aria-labelledby={titleId}
        data-notification-id={notification.id}
        data-read={read ? "true" : "false"}
      >
        <div className={styles.itemHeader}>
          <p className={styles.scope}>{view.scope === "account" ? t("Cuenta") : t("Perfil")}</p>
          <p className={styles.readState} data-read={read ? "true" : "false"}>
            <span aria-hidden="true">{read ? "✓" : "●"}</span>
            {read ? t("Leída") : t("No leída")}
          </p>
        </div>
        <h2 id={titleId} className={styles.title}>{view.title}</h2>
        {view.counterpartCategory ? <p className={styles.meta}>{view.counterpartCategory}</p> : null}
        {view.description ? <p className={styles.description}>{view.description}</p> : null}
        <p className={styles.meta}>
          <time dateTime={notification.created_at}>{notificationDateText(notification.created_at, undefined, locale)}</time>
        </p>
        {view.requestId || view.referencesDirection || !read ? (
          <div className={styles.actions}>
            {view.requestId ? (
              <Link
                className={directoryStyles.secondaryAction}
                href={profileUrl(`/app/requests/${view.requestId}`, profileId)}
                onClick={() => onMarkRead(notification)}
              >
                {t("Ver solicitud")}
              </Link>
            ) : null}
            {view.referencesDirection ? (
              <Link
                className={directoryStyles.secondaryAction}
                href={referencesHref(profileId, view.referencesDirection)}
                onClick={() => onMarkRead(notification)}
              >
                {t("Ver referencias")}
              </Link>
            ) : null}
            {!read ? (
              <button
                type="button"
                className={directoryStyles.secondaryButton}
                aria-describedby={error ? `${titleId} ${errorId}` : titleId}
                onClick={() => onMarkRead(notification)}
              >
                {t("Marcar como leída")}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p id={errorId} className={directoryStyles.fieldError} role="alert">{error}</p> : null}
      </article>
    </li>
  );
}

type SaveState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "saving" }>
  | Readonly<{ status: "saved" }>
  | Readonly<{ status: "error"; message: string; fields: Readonly<Record<string, readonly string[]>> }>;

function saveErrorText(reason: unknown, t: Translate): string {
  if (!(reason instanceof ApiRequestError)) return t("No pudimos guardar las preferencias por un problema de conexión. Probá de nuevo.");
  if (reason.status === 422) return t("Revisá las preferencias marcadas.");
  if (reason.status === 429) return t("Hiciste demasiados cambios seguidos. Esperá un momento y volvé a probar.");
  return reason.message || t("No pudimos guardar las preferencias.");
}

/**
 * Preferencias de correo de la cuenta (PATCH /me). Solo los cuatro avisos de
 * solicitudes son opcionales; los esenciales y los que no tienen correo se explican
 * pero no se ofrecen como interruptores. El backend vuelve a validar todo. T21 lo
 * reutiliza en Ajustes.
 */
export function EmailPreferences({
  preferences,
  onAccountChange,
}: Readonly<{ preferences: readonly NotificationPreference[]; onAccountChange: (account: CurrentAccount) => void }>) {
  const t = useT();
  const [draft, setDraft] = useState<PreferenceState>(() => preferenceState(preferences));
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fields = save.status === "error" ? save.fields : {};
  const generalError = fields.notification_preferences?.[0];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.status === "saving") return;
    setSave({ status: "saving" });
    try {
      const response = await mutateBrowserJson("/api/backend/v1/me", "PATCH", preferencesBody(draft), isCurrentAccountResponse);
      if (!mounted.current) return;
      setDraft(preferenceState(response.data.notification_preferences));
      onAccountChange(response.data);
      setSave({ status: "saved" });
    } catch (reason) {
      if (!mounted.current) return;
      if (redirectIfUnauthorized(reason)) return;
      setSave({
        status: "error",
        message: saveErrorText(reason, t),
        fields: reason instanceof ApiRequestError ? reason.fields : {},
      });
    }
  };

  const toggle = (type: OptionalEmailType, value: boolean) => {
    setDraft((current) => ({ ...current, [type]: value }));
    if (save.status === "saved") setSave({ status: "idle" });
  };

  return (
    <section className={styles.preferences} aria-labelledby="email-preferences-title">
      <h2 id="email-preferences-title">{t("Preferencias de correo")}</h2>
      <p className={directoryStyles.muted}>
        {t("Son preferencias de tu cuenta: se aplican a todos tus perfiles. Las notificaciones dentro de la plataforma se muestran siempre.")}
      </p>
      <form className={styles.preferencesForm} onSubmit={(event) => void submit(event)} aria-label={t("Preferencias de correo")} noValidate>
        <fieldset className={styles.fieldset}>
          <legend>{t("Correos opcionales")}</legend>
          {OPTIONAL_EMAIL_TYPES.map((type, index) => {
            const error = firstFieldError(fields, `notification_preferences.${index}`);
            const id = `email-preference-${type}`;
            return (
              <div key={type} className={styles.toggleRow}>
                <label className={styles.toggle} htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    name={type}
                    checked={draft[type]}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(event) => toggle(type, event.target.checked)}
                  />
                  <span>{t(OPTIONAL_EMAIL_LABELS[type])}</span>
                </label>
                {error ? <p id={`${id}-error`} className={directoryStyles.fieldError}>{error}</p> : null}
              </div>
            );
          })}
        </fieldset>

        <div className={styles.fixedGroup}>
          <h3>{t("Siempre se envían")}</h3>
          <ul className={styles.fixedList}>
            {ESSENTIAL_EMAILS.map((item) => (
              <li key={item.type}>
                <strong>{t(item.label)}</strong>
                <span>{t(item.reason)}</span>
              </li>
            ))}
          </ul>
          <h3>{t("Solo en la plataforma")}</h3>
          <ul className={styles.fixedList}>
            {IN_APP_ONLY.map((item) => (
              <li key={item.type}>
                <strong>{t(item.label)}</strong>
                <span>{t(item.reason)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={directoryStyles.moreRow}>
          <button type="submit" className={directoryStyles.primaryButton} disabled={save.status === "saving"}>
            {save.status === "saving" ? t("Guardando…") : t("Guardar preferencias")}
          </button>
          <p className={directoryStyles.muted} role="status" aria-live="polite">
            {save.status === "saved" ? t("Preferencias guardadas.") : ""}
          </p>
        </div>
        {save.status === "error" ? (
          <p className={directoryStyles.fieldError} role="alert">{generalError ?? save.message}</p>
        ) : null}
      </form>
    </section>
  );
}
