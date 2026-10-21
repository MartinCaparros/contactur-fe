"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/lib/brand/BrandMark";
import { browserMutation } from "@/lib/browser/auth";
import { browserTranslate } from "@/lib/i18n/browser";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { LanguageSwitch } from "@/lib/i18n/LanguageSwitch";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { tk, type Translate } from "@/lib/i18n/translate";
import { REALTIME_EVENTS, profileChannel } from "@/lib/realtime/channels";
import { RealtimeProvider, useRealtimeEvents } from "@/lib/realtime/RealtimeProvider";

import {
  ACCOUNT_SUSPENDED_EVENT,
  ApiRequestError,
  type AccessEvaluation,
  type CurrentAccount,
  type OwnedProfileSummary,
  type Profile,
  type ProfileCategory,
  getBrowserJson,
  isAccessResponse,
  isCurrentAccountResponse,
  isProfileResponse,
  isPublicProfileId,
} from "./api";
import { useAccountLocale } from "./accountLocale";
import { AvailabilityView } from "./AvailabilityCalendar";
import { AvailabilityMiniCalendar } from "./AvailabilityMiniCalendar";
import { hasAvailabilityCalendar } from "./availabilityModel";
import { DashboardMetrics } from "./DashboardMetrics";
import { DirectoryProfileView } from "./DirectoryProfileView";
import { unreadAccessibleName, unreadBadgeText } from "./notificationsModel";
import { NotificationsView, useUnreadNotifications } from "./NotificationsView";
import { ProfileEditor } from "./ProfileEditor";
import { ReferencesView } from "./ReferencesView";
import { RequestDetailView } from "./RequestDetailView";
import { RequestsView } from "./RequestsView";
import { SearchView } from "./SearchView";
import { ACTIVE_PROFILE_KEY, ONBOARDING_PROFILE_KEY } from "./session";
import { SettingsView } from "./SettingsView";
import styles from "./AppShell.module.css";
import notificationStyles from "./Notifications.module.css";

export { ACTIVE_PROFILE_KEY, ONBOARDING_PROFILE_KEY } from "./session";

type AppView =
  | "dashboard"
  | "access"
  | "profile"
  | "availability"
  | "search"
  | "directory"
  | "requests"
  | "request"
  | "notifications"
  | "references"
  | "settings";
type AccountState =
  | { status: "loading" }
  | { status: "ready"; account: CurrentAccount }
  | { status: "error"; message: string };
type SelectionState =
  | { status: "idle" }
  | { status: "loading"; profileId: string }
  | { status: "ready"; profileId: string; profile: Profile; access: AccessEvaluation }
  | { status: "access-unavailable"; profileId: string; profile: Profile; message: string }
  | { status: "error"; profileId: string; message: string };

/** `label` es el texto fuente en español (marcado con `tk`); se traduce al mostrarlo. */
type NavigationItem = Readonly<{ label: string; href: string }>;

const CATEGORY_LABELS: Record<ProfileCategory, string> = {
  tourism_company: tk("Empresa turística"),
  guide: tk("Guía"),
  driver: tk("Conductor"),
  instructor: tk("Instructor"),
  transport_company: tk("Empresa de transporte"),
};

// T21: todos los destinos están implementados contra endpoints reales (R19).
const SHARED_NAVIGATION: readonly NavigationItem[] = [
  { label: tk("Perfil"), href: "/app/profile" },
  // T20: recibidas y escritas para todas las categorías.
  { label: tk("Referencias"), href: "/app/references" },
  { label: tk("Acceso"), href: "/app/access" },
  // T21: ajustes de la cuenta (nombre, email, contraseña y preferencias de correo).
  { label: tk("Ajustes"), href: "/app/settings" },
  // T19: el centro de notificaciones existe para todas las categorías (R19).
  { label: tk("Notificaciones"), href: "/app/notifications" },
];

const NOTIFICATIONS_HREF = "/app/notifications";

/**
 * D21/P27: con el perfil suspendido el menú solo ofrece consultar el perfil, el
 * estado de acceso, las notificaciones y los ajustes de la cuenta. El resto de los
 * destinos son operativos y el backend los rechaza igual (403 `profile_suspended`).
 */
const SUSPENDED_PROFILE_HREFS: ReadonlySet<string> = new Set([
  "/app/profile",
  "/app/access",
  "/app/settings",
  NOTIFICATIONS_HREF,
]);

/** Vistas que no se montan con el perfil suspendido: se explica el estado en su lugar. */
const SUSPENDED_BLOCKED_VIEWS: ReadonlySet<AppView> = new Set([
  "availability",
  "search",
  "directory",
  "requests",
  "request",
  "references",
]);

function isProfileSuspended(access: AccessEvaluation | null | undefined): boolean {
  return access?.effective_state === "suspended";
}

export function navigationFor(
  category: ProfileCategory,
  access: AccessEvaluation | null = null,
): readonly NavigationItem[] {
  const roleNavigation: readonly NavigationItem[] = category === "tourism_company"
    ? [
        // Solo la empresa turística busca (R19); un receptor que entra por URL ve la explicación.
        { label: tk("Buscar"), href: "/app/search" },
        // T18: la empresa ve sus enviadas; el receptor, sus recibidas.
        { label: tk("Solicitudes"), href: "/app/requests" },
      ]
    : [
        { label: tk("Disponibilidad"), href: "/app/availability" },
        { label: tk("Solicitudes"), href: "/app/requests" },
      ];
  const items = [...roleNavigation, ...SHARED_NAVIGATION];
  return isProfileSuspended(access) ? items.filter((item) => SUSPENDED_PROFILE_HREFS.has(item.href)) : items;
}

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // La selección sigue funcionando en memoria si el navegador bloquea sessionStorage.
  }
}

function sessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // No hay estado persistente que limpiar si sessionStorage no está disponible.
  }
}

function selectionFromBrowser(profiles: readonly OwnedProfileSummary[]): string | null {
  const fromUrl = new URL(window.location.href).searchParams.get("profile");
  if (isPublicProfileId(fromUrl) && profiles.some((profile) => profile.id === fromUrl)) return fromUrl;
  const fromSession = sessionGet(ACTIVE_PROFILE_KEY);
  if (isPublicProfileId(fromSession) && profiles.some((profile) => profile.id === fromSession)) return fromSession;
  return profiles[0]?.id ?? null;
}

function updateProfileUrl(profileId: string | null): void {
  const url = new URL(window.location.href);
  if (profileId) url.searchParams.set("profile", profileId);
  else url.searchParams.delete("profile");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function categoryLabel(category: ProfileCategory, t: Translate): string {
  return t(CATEGORY_LABELS[category]);
}

function accessLabel(state: AccessEvaluation["effective_state"], t: Translate): string {
  switch (state) {
    case "active": return t("Activo");
    case "expired": return t("Vencido");
    case "suspended": return t("Suspendido");
    case "inactive": return t("Inactivo");
  }
}

function profileStatusLabel(status: Profile["status"], t: Translate): string {
  switch (status) {
    case "draft": return t("Borrador");
    case "published": return t("Publicado");
    default: return t("Suspendido");
  }
}

function formatDateTime(value: string | null, t: Translate, locale: Locale): string {
  if (!value) return t("Sin fecha definida");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

const CAPABILITY_LABELS: ReadonlyArray<readonly [keyof AccessEvaluation["capabilities"], string]> = [
  ["can_search", tk("Buscar profesionales")],
  ["can_send_contact_requests", tk("Enviar solicitudes")],
  ["can_publish_availability", tk("Publicar disponibilidad")],
  ["can_receive_contact_requests", tk("Recibir solicitudes")],
  ["can_use_gallery", tk("Usar galería")],
  ["can_view_history", tk("Consultar historial")],
  ["can_reject_pending_requests", tk("Rechazar solicitudes pendientes")],
];

export function AccessPanel({ access }: Readonly<{ access: AccessEvaluation }>) {
  const t = useT();
  const locale = useLocale();
  const blocked = CAPABILITY_LABELS.filter(([key]) => !access.capabilities[key]);
  return (
    <section className={styles.panel} aria-labelledby="access-title">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>{t("Estado efectivo")}</p>
          <h1 id="access-title">{t("Acceso del perfil")}</h1>
        </div>
        <span className={`${styles.statusPill} ${styles[`state_${access.effective_state}`]}`}>
          {accessLabel(access.effective_state, t)}
        </span>
      </div>

      <div className={styles.accessGrid}>
        <article className={styles.infoCard}>
          <h2>{t("Vigencia")}</h2>
          <dl>
            <div><dt>{t("Desde")}</dt><dd>{formatDateTime(access.grant?.starts_at ?? null, t, locale)}</dd></div>
            <div>
              <dt>{t("Hasta")}</dt>
              <dd>
                {access.grant?.expires_at
                  ? formatDateTime(access.grant.expires_at, t, locale)
                  : t("Sin vencimiento definido")}
              </dd>
            </div>
            <div><dt>{t("Evaluado")}</dt><dd>{formatDateTime(access.evaluated_at, t, locale)}</dd></div>
          </dl>
        </article>
        <article className={styles.infoCard}>
          <h2>{t("Capacidades")}</h2>
          <ul className={styles.capabilityList}>
            {CAPABILITY_LABELS.map(([key, label]) => (
              <li key={key} data-enabled={access.capabilities[key]}>
                <span aria-hidden="true">{access.capabilities[key] ? "✓" : "—"}</span>{t(label)}
              </li>
            ))}
          </ul>
        </article>
      </div>

      {access.contact_quota ? (
        <article className={styles.quotaCard}>
          <h2>{t("Solicitudes del mes")}</h2>
          <p>
            {access.contact_quota.remaining === null
              ? t("{used} utilizadas · sin límite definido", { used: access.contact_quota.used })
              : t("{used} utilizadas · {remaining} disponibles", {
                  used: access.contact_quota.used,
                  remaining: access.contact_quota.remaining,
                })}
          </p>
        </article>
      ) : null}

      {!access.allowed ? (
        <div className={styles.blockedNotice} role="status">
          <div>
            <h2>{t("Funciones restringidas")}</h2>
            <p>
              {access.effective_state === "suspended"
                ? t("Este perfil está suspendido. Solo podés consultar este estado, contactar soporte y cerrar sesión.")
                : access.effective_state === "expired"
                  ? t("La vigencia finalizó. Los datos propios se conservan y las funciones habilitadas se indican arriba.")
                  : t("Este perfil todavía no tiene habilitación efectiva. Tus datos y el estado del proceso se conservan.")}
            </p>
            {blocked.length > 0
              ? <p>{t("{count} capacidades están bloqueadas en este momento.", { count: blocked.length })}</p>
              : null}
          </div>
          <Link className={styles.primaryAction} href="/#contacto">{t("Contactar soporte")}</Link>
        </div>
      ) : null}
    </section>
  );
}

function ProfileOverview({ profile, access }: Readonly<{ profile: Profile; access: AccessEvaluation | null }>) {
  const t = useT();
  return (
    <section className={styles.panel} aria-labelledby="overview-title">
      <p className={styles.eyebrow}>{categoryLabel(profile.category, t)}</p>
      <h1 id="overview-title">{profile.display_name}</h1>
      <p className={styles.lead}>
        {profile.description ?? t("Completá la información del perfil para presentarte ante la red profesional.")}
      </p>
      <div className={styles.summaryGrid}>
        <article className={styles.infoCard}>
          <span>{t("Perfil")}</span>
          <strong>{profileStatusLabel(profile.status, t)}</strong>
          <p>{t("Paso de alta {step} de 4", { step: profile.onboarding_step })}</p>
        </article>
        <article className={styles.infoCard}>
          <span>{t("Acceso")}</span>
          <strong>{access ? accessLabel(access.effective_state, t) : t("No disponible")}</strong>
          <p>
            {access?.allowed
              ? t("Funciones activas según capacidades.")
              : t("Consultá la pantalla de acceso para ver el detalle.")}
          </p>
        </article>
        <article className={styles.infoCard}>
          <span>{t("Ciudades")}</span>
          <strong>{profile.cities.length}</strong>
          <p>
            {profile.cities.length > 0
              ? profile.cities.map((city) => city.name).join(", ")
              : t("Todavía no seleccionaste ciudades.")}
          </p>
        </article>
      </div>
      {/* T21: KPIs reales del perfil activo; `key` evita mezclar valores al cambiar de perfil. */}
      <DashboardMetrics key={`metrics:${profile.id}`} profileId={profile.id} />
      {hasAvailabilityCalendar(profile.category) ? (
        <AvailabilityMiniCalendar key={profile.id} profileId={profile.id} cities={profile.cities} />
      ) : null}
      {profile.status === "draft" ? (
        <div className={styles.onboardingCallout}>
          <div><h2>{t("Tu perfil sigue en borrador")}</h2><p>{t("Retomá el alta desde el último paso guardado.")}</p></div>
          <Link className={styles.primaryAction} href={profileUrl("/app/onboarding", profile.id)}>{t("Retomar alta")}</Link>
        </div>
      ) : null}
    </section>
  );
}

function NotificationsLink({
  profileId,
  active,
  refreshKey,
}: Readonly<{ profileId: string; active: boolean; refreshKey: number }>) {
  const t = useT();
  const unread = useUnreadNotifications(profileId, refreshKey);
  const count = unread?.count ?? 0;
  const more = unread?.more ?? false;
  return (
    <Link
      className={active ? styles.activeLink : undefined}
      href={profileUrl(NOTIFICATIONS_HREF, profileId)}
      aria-label={unreadAccessibleName(count, more, t)}
      data-unread={unread ? unreadBadgeText(count, more) : undefined}
    >
      {t("Notificaciones")}
      {count > 0 || more ? (
        <span className={notificationStyles.badge} aria-hidden="true">{unreadBadgeText(count, more)}</span>
      ) : null}
    </Link>
  );
}

function Navigation({
  profile,
  access,
  view,
  notificationsRefreshKey,
}: Readonly<{ profile: Profile; access: AccessEvaluation | null; view: AppView; notificationsRefreshKey: number }>) {
  const t = useT();
  return (
    <aside className={styles.sidebar} aria-label={t("Navegación del perfil")}>
      <div className={styles.profileIdentity}>
        {/* La inicial es del nombre del perfil (dato en español), no del idioma de la interfaz. */}
        <span className={styles.avatar} aria-hidden="true">{profile.display_name.slice(0, 1).toLocaleUpperCase("es")}</span>
        <span><strong>{profile.display_name}</strong><small>{categoryLabel(profile.category, t)}</small></span>
      </div>
      <nav>
        <Link className={view === "dashboard" ? styles.activeLink : undefined} href={profileUrl("/app", profile.id)}>
          {t("Resumen")}
        </Link>
        {navigationFor(profile.category, access).map((item) => item.href === NOTIFICATIONS_HREF ? (
          <NotificationsLink
            key={item.href}
            profileId={profile.id}
            active={view === "notifications"}
            refreshKey={notificationsRefreshKey}
          />
        ) : (
          <Link
            className={item.href === `/app/${view === "request" ? "requests" : view}` ? styles.activeLink : undefined}
            href={profileUrl(item.href, profile.id)}
            key={item.href}
          >
            {t(item.label)}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

const ACCESS_EVENTS = [REALTIME_EVENTS.accessChanged] as const;

/**
 * Escucha `access.changed` del perfil activo (canal propio, permitido aunque el acceso
 * esté vencido). El aviso no trae datos: solo dispara la re-evaluación por la API.
 */
function ActiveProfileRealtime({
  profileId,
  onAccessChanged,
}: Readonly<{ profileId: string | null; onAccessChanged: (profileId: string) => void }>) {
  const handler = useCallback(() => {
    if (profileId) onAccessChanged(profileId);
  }, [onAccessChanged, profileId]);
  useRealtimeEvents(profileId ? profileChannel(profileId) : null, ACCESS_EVENTS, handler);
  return null;
}

/**
 * D21: un perfil suspendido no opera. En lugar de montar la vista (que el backend
 * rechazaría con 403) se explica el estado y se ofrecen los únicos caminos válidos.
 */
function SuspendedProfileNotice({ profileId }: Readonly<{ profileId: string }>) {
  const t = useT();
  return (
    <section className={styles.restrictedNotice} role="alert" aria-labelledby="suspended-profile-title">
      <p className={styles.eyebrow}>{t("Perfil suspendido")}</p>
      <h1 id="suspended-profile-title">{t("Esta sección no está disponible")}</h1>
      <p>
        {t("Mientras el perfil esté suspendido solo podés consultar su estado de acceso, tus notificaciones y los ajustes de la cuenta, contactar soporte o cerrar la sesión.")}
      </p>
      <Link className={styles.primaryAction} href={profileUrl("/app/access", profileId)}>{t("Ver estado de acceso")}</Link>
      {" "}
      <Link className={styles.primaryAction} href="/#contacto">{t("Contactar soporte")}</Link>
    </section>
  );
}

/**
 * T23: ante un fallo de carga (p. ej. 502 con el backend caído) la sesión se conserva
 * (el BFF solo la cierra ante un 401), así que reintentar es volver a cargar la vista.
 */
function RetryButton() {
  const t = useT();
  return (
    <button className={`${styles.primaryAction} ${styles.retryAction}`} type="button" onClick={() => window.location.reload()}>
      {t("Reintentar")}
    </button>
  );
}

function LoadingSelection() {
  const t = useT();
  return (
    <section className={styles.panel} aria-live="polite" aria-busy="true">
      <p className={styles.eyebrow}>{t("Cargando perfil")}</p>
      <div className={styles.skeleton} />
      <div className={styles.skeletonShort} />
    </section>
  );
}

export function PrivateApp({
  view = "dashboard",
  targetProfileId = "",
  requestId = "",
}: Readonly<{ view?: AppView; targetProfileId?: string; requestId?: string }>) {
  const t = useT();
  const [accountState, setAccountState] = useState<AccountState>({ status: "loading" });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectionState, setSelectionState] = useState<SelectionState>({ status: "idle" });
  const [logoutPending, setLogoutPending] = useState(false);
  // Sube cuando el centro marca una notificación como leída: la insignia re-consulta.
  const [notificationsRefreshKey, setNotificationsRefreshKey] = useState(0);
  const selectionGeneration = useRef(0);
  const logoutStarted = useRef(false);
  const accountRefresh = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson("/api/backend/v1/me", isCurrentAccountResponse, controller.signal)
      .then(({ data }) => {
        if (logoutStarted.current) return;
        setAccountState({ status: "ready", account: data });
        // Cuenta suspendida: vista restringida sin cargar ningún perfil ni datos operativos.
        if (data.user.status !== "active") return;
        const selected = selectionFromBrowser(data.profiles);
        setSelectionState(selected ? { status: "loading", profileId: selected } : { status: "idle" });
        setSelectedProfileId(selected);
        if (!selected) {
          sessionRemove(ACTIVE_PROFILE_KEY);
          updateProfileUrl(null);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || logoutStarted.current || redirectIfUnauthorized(reason)) return;
        setAccountState({ status: "error", message: messageFrom(reason, browserTranslate("No pudimos cargar tu cuenta.")) });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) return;

    const controller = new AbortController();
    const generation = ++selectionGeneration.current;
    sessionSet(ACTIVE_PROFILE_KEY, selectedProfileId);
    updateProfileUrl(selectedProfileId);
    window.dispatchEvent(new CustomEvent("contactur:profile-change", { detail: { profileId: selectedProfileId } }));

    const profileRequest = getBrowserJson(
      `/api/backend/v1/profiles/${selectedProfileId}`,
      isProfileResponse,
      controller.signal,
    );
    const accessRequest = getBrowserJson(
      `/api/backend/v1/profiles/${selectedProfileId}/access`,
      isAccessResponse,
      controller.signal,
    );

    void Promise.allSettled([profileRequest, accessRequest]).then(([profileResult, accessResult]) => {
      if (controller.signal.aborted || generation !== selectionGeneration.current || logoutStarted.current) return;
      if (profileResult.status === "rejected") {
        if (redirectIfUnauthorized(profileResult.reason)) return;
        setSelectionState({
          status: "error",
          profileId: selectedProfileId,
          message: messageFrom(profileResult.reason, browserTranslate("No pudimos cargar el perfil.")),
        });
        return;
      }
      if (accessResult.status === "rejected") {
        if (redirectIfUnauthorized(accessResult.reason)) return;
        setSelectionState({
          status: "access-unavailable",
          profileId: selectedProfileId,
          profile: profileResult.value.data,
          message: messageFrom(accessResult.reason, browserTranslate("La evaluación de acceso no está disponible.")),
        });
        return;
      }
      setSelectionState({
        status: "ready",
        profileId: selectedProfileId,
        profile: profileResult.value.data,
        access: accessResult.value.data,
      });
    });

    return () => controller.abort();
  }, [selectedProfileId]);

  /**
   * P27: suspensión de la cuenta en vigor. Se dispara con un 403 `account_suspended`
   * de cualquier consulta (evento de ventana desde `apiError`) o cuando la
   * re-evaluación de `access.changed` trae ese `denial_code`. Re-consulta `/me` (que
   * responde aunque la cuenta esté suspendida) y, si confirma la suspensión, pasa a
   * la vista restringida sin recargar: se descarta el perfil cargado, se abortan sus
   * consultas y se cierra el socket. Si `/me` falla, el backend ya informó la
   * suspensión, así que también se restringe (nunca se amplía un permiso).
   */
  const refreshAccount = useCallback(() => {
    if (logoutStarted.current) return;
    accountRefresh.current?.abort();
    const controller = new AbortController();
    accountRefresh.current = controller;
    const restrict = () => {
      selectionGeneration.current += 1;
      setSelectedProfileId(null);
      setSelectionState({ status: "idle" });
    };
    void getBrowserJson("/api/backend/v1/me", isCurrentAccountResponse, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted || logoutStarted.current) return;
        setAccountState({ status: "ready", account: data });
        if (data.user.status !== "active") restrict();
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || logoutStarted.current || redirectIfUnauthorized(reason)) return;
        setAccountState((current) => current.status === "ready"
          ? { status: "ready", account: { ...current.account, user: { ...current.account.user, status: "suspended" } } }
          : current);
        restrict();
      });
  }, []);

  useEffect(() => {
    const onSuspended = () => refreshAccount();
    window.addEventListener(ACCOUNT_SUSPENDED_EVENT, onSuspended);
    return () => {
      window.removeEventListener(ACCOUNT_SUSPENDED_EVENT, onSuspended);
      accountRefresh.current?.abort();
    };
  }, [refreshAccount]);

  /**
   * `access.changed`: re-evalúa el acceso del perfil por la API (que es la fuente de
   * verdad) sin pasar por la carga completa. Menú, formulario de envío y canales que
   * dependen de capacidades se recalculan con la evaluación nueva; si la consulta
   * falla no se infiere ningún permiso y se pasa al estado "acceso no disponible".
   * Si la evaluación trae `account_suspended`, se confirma la cuenta con `/me` (P27).
   */
  const reloadAccess = useCallback((profileId: string) => {
    const generation = selectionGeneration.current;
    void getBrowserJson(`/api/backend/v1/profiles/${profileId}/access`, isAccessResponse)
      .then(({ data }) => {
        if (generation !== selectionGeneration.current || logoutStarted.current) return;
        if (data.denial_code === "account_suspended") refreshAccount();
        setSelectionState((current) => (current.status === "ready" || current.status === "access-unavailable") &&
          current.profileId === profileId
          ? { status: "ready", profileId, profile: current.profile, access: data }
          : current);
        setAccountState((current) => current.status === "ready"
          ? {
              status: "ready",
              account: {
                ...current.account,
                profiles: current.account.profiles.map((summary) => summary.id === profileId
                  ? { ...summary, access_state: data.effective_state, capabilities: data.capabilities }
                  : summary),
              },
            }
          : current);
      })
      .catch((reason: unknown) => {
        // Un fallo transitorio conserva la última evaluación del servidor: cambiar de
        // rama desmontaría las vistas (y un borrador del calendario). Cada acción
        // sensible vuelve a validarse en Laravel igual.
        if (generation !== selectionGeneration.current || logoutStarted.current) return;
        redirectIfUnauthorized(reason);
      });
  }, [refreshAccount]);

  /**
   * Cierra la sesión local por el BFF (que borra las cookies aunque la sesión remota
   * ya esté revocada). `redirectTo` fija el destino; sin él se usa el de siempre.
   */
  const endSession = async (redirectTo: string | null) => {
    logoutStarted.current = true;
    selectionGeneration.current += 1;
    accountRefresh.current?.abort();
    setLogoutPending(true);
    setSelectedProfileId(null);
    setSelectionState({ status: "idle" });
    sessionRemove(ACTIVE_PROFILE_KEY);
    sessionRemove(ONBOARDING_PROFILE_KEY);
    try {
      const response = await browserMutation("/api/auth/logout");
      window.location.replace(redirectTo ?? (response.ok ? "/" : "/?logout=local"));
    } catch {
      window.location.replace(redirectTo ?? "/?logout=local");
    }
  };

  const logout = () => endSession(null);
  // El cambio de contraseña revoca todas las sesiones, incluida esta: se vuelve a ingresar.
  const closeSessionAfterPasswordChange = () => endSession("/?auth=login");

  const account = accountState.status === "ready" ? accountState.account : null;
  const persistLocale = useAccountLocale(account?.user ?? null);
  const selectedSummary = account?.profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const loadedProfile = selectionState.status === "ready" || selectionState.status === "access-unavailable"
    ? selectionState.profile
    : null;
  // D21: con el perfil suspendido las vistas operativas no se montan (ni consultan).
  const blockedBySuspension = selectionState.status === "ready" &&
    isProfileSuspended(selectionState.access) &&
    SUSPENDED_BLOCKED_VIEWS.has(view);
  // El socket solo se abre para una cuenta activa con perfiles y se cierra al iniciar el logout.
  const realtimeEnabled = account !== null && account.user.status === "active" && account.profiles.length > 0 && !logoutPending;

  const applyProfileChange = (updated: Profile) => {
    setSelectionState((current) => {
      if (current.status === "ready" && current.profileId === updated.id) {
        return { ...current, profile: updated };
      }
      if (current.status === "access-unavailable" && current.profileId === updated.id) {
        return { ...current, profile: updated };
      }
      return current;
    });
    setAccountState((current) => current.status === "ready"
      ? {
          status: "ready",
          account: {
            ...current.account,
            profiles: current.account.profiles.map((summary) => summary.id === updated.id
              ? {
                  ...summary,
                  display_name: updated.display_name,
                  status: updated.status,
                  completed_at: updated.completed_at,
                }
              : summary),
          },
        }
      : current);
  };

  const refreshUnreadBadge = useCallback(() => setNotificationsRefreshKey((value) => value + 1), []);

  // PATCH /me devuelve la cuenta completa: se toman el usuario (nombre) y las
  // preferencias; los perfiles conservan la última evaluación de acceso del shell.
  const applyAccountChange = useCallback((updated: CurrentAccount) => {
    setAccountState((current) => current.status === "ready"
      ? {
          status: "ready",
          account: {
            ...current.account,
            user: updated.user,
            notification_preferences: updated.notification_preferences,
          },
        }
      : current);
  }, []);

  const settingsView = (value: CurrentAccount) => (
    <SettingsView
      account={value}
      onAccountChange={applyAccountChange}
      onPasswordChanged={closeSessionAfterPasswordChange}
    />
  );

  const notificationsView = (profile: Profile) => account ? (
    <NotificationsView
      key={profile.id}
      profile={profile}
      preferences={account.notification_preferences}
      onUnreadChanged={refreshUnreadBadge}
      onAccountChange={applyAccountChange}
    />
  ) : null;

  const shell = (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={t("Ir a Contactur")}>
          <BrandMark />{" "}
          {/* El nombre accesible lo da `aria-label`: en pantallas angostas la palabra se oculta. */}
          <span className={styles.brandWord}>Contactur</span>
        </Link>
        {/* Con la cuenta suspendida no se ofrece navegación entre perfiles (D21). */}
        {account && account.user.status === "active" && account.profiles.length > 0 ? (
          <label className={styles.profileSelector}>
            <span>{t("Perfil activo")}</span>
            <select
              aria-label={t("Perfil activo")}
              value={selectedProfileId ?? ""}
              onChange={(event) => {
                const profileId = event.target.value;
                setSelectionState({ status: "loading", profileId });
                setSelectedProfileId(profileId);
              }}
            >
              {account.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.display_name} · {categoryLabel(profile.category, t)}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className={styles.headerActions}>
          <LanguageSwitch onChange={account ? persistLocale : undefined} />
          {account ? <span className={styles.accountName}>{account.user.name}</span> : null}
          <button type="button" onClick={logout} disabled={logoutPending}>
            {logoutPending ? t("Cerrando…") : t("Cerrar sesión")}
          </button>
        </div>
      </header>

      {accountState.status === "loading" ? (
        <main className={styles.centerState} role="status">{t("Cargando tu cuenta…")}</main>
      ) : null}
      {accountState.status === "error" ? (
        <main className={styles.centerState}>
          <div className={styles.errorNotice} role="alert">
            <h1>{t("No pudimos abrir tu cuenta")}</h1>
            <p>{accountState.message}</p>
            <RetryButton />
          </div>
        </main>
      ) : null}

      {account && account.user.status === "suspended" ? (
        <main className={styles.centerState}>
          <div className={styles.restrictedNotice} role="alert">
            <p className={styles.eyebrow}>{t("Cuenta suspendida")}</p>
            <h1>{t("Tu navegación está restringida")}</h1>
            <p>{t("Podés contactar soporte o cerrar la sesión. No se muestran datos operativos del perfil.")}</p>
            <Link className={styles.primaryAction} href="/#contacto">{t("Contactar soporte")}</Link>
          </div>
        </main>
      ) : null}

      {/* Los ajustes son de la cuenta: también están disponibles antes del primer perfil. */}
      {account && account.user.status === "active" && account.profiles.length === 0 && view === "settings" ? (
        <main className={styles.mainContent}>{settingsView(account)}</main>
      ) : null}

      {account && account.user.status === "active" && account.profiles.length === 0 && view !== "settings" ? (
        <main className={styles.centerState}>
          <section className={styles.emptyState} aria-labelledby="empty-title">
            <p className={styles.eyebrow}>{t("Primer perfil")}</p>
            <h1 id="empty-title">{t("Creá tu perfil profesional")}</h1>
            <p>{t("Tu cuenta está lista. El alta guarda cada etapa y no concede habilitación automática.")}</p>
            <Link className={styles.primaryAction} href="/app/onboarding">{t("Crear perfil")}</Link>
          </section>
        </main>
      ) : null}

      {account && account.user.status === "active" && account.profiles.length > 0 ? (
        <div className={styles.appLayout}>
          {loadedProfile ? (
            <Navigation
              profile={loadedProfile}
              access={selectionState.status === "ready" ? selectionState.access : null}
              view={view}
              notificationsRefreshKey={notificationsRefreshKey}
            />
          ) : (
            <aside className={styles.sidebarPlaceholder} aria-hidden="true" />
          )}
          <main className={styles.mainContent} data-profile-id={selectedSummary?.id ?? undefined}>
            {/* Ajustes no dependen del perfil activo: no esperan ni muestran su carga. */}
            {view === "settings" ? settingsView(account) : null}
            {view !== "settings" && (selectionState.status === "loading" || selectionState.status === "idle") ? <LoadingSelection /> : null}
            {view !== "settings" && selectionState.status === "error" ? (
              <div className={styles.errorNotice} role="alert">
                <h1>{t("No pudimos cargar el perfil")}</h1>
                <p>{selectionState.message}</p>
                <RetryButton />
              </div>
            ) : null}
            {blockedBySuspension && selectionState.status === "ready" ? (
              <SuspendedProfileNotice profileId={selectionState.profile.id} />
            ) : null}
            {view !== "settings" && selectionState.status === "access-unavailable" ? (
              <>
                <div className={styles.dependencyNotice} role="status">
                  <strong>{t("No pudimos consultar el estado de acceso")}</strong>
                  <span>{selectionState.message}</span>
                </div>
                {view === "dashboard" ? <ProfileOverview profile={selectionState.profile} access={null} /> : null}
                {view === "access" ? (
                  <section className={styles.panel}>
                    <h1>{t("Acceso no disponible")}</h1>
                    <p>{t("Falló la consulta al endpoint integrado de acceso. No se infirió ningún permiso.")}</p>
                    <Link className={styles.primaryAction} href="/#contacto">{t("Contactar soporte")}</Link>
                  </section>
                ) : null}
                {view === "profile" ? (
                  <ProfileEditor
                    key={selectionState.profile.id}
                    profile={selectionState.profile}
                    access={null}
                    onProfileChange={applyProfileChange}
                  />
                ) : null}
                {view === "availability" ? (
                  <AvailabilityView key={selectionState.profile.id} profile={selectionState.profile} access={null} />
                ) : null}
                {view === "search" ? <SearchView key={selectionState.profile.id} profile={selectionState.profile} access={null} /> : null}
                {view === "directory" ? (
                  <DirectoryProfileView
                    key={`${selectionState.profile.id}:${targetProfileId}`}
                    actor={selectionState.profile}
                    access={null}
                    targetProfileId={targetProfileId}
                  />
                ) : null}
                {view === "requests" ? <RequestsView key={selectionState.profile.id} profile={selectionState.profile} /> : null}
                {view === "references" ? <ReferencesView key={selectionState.profile.id} profile={selectionState.profile} /> : null}
                {view === "notifications" ? notificationsView(selectionState.profile) : null}
                {view === "request" ? (
                  <RequestDetailView
                    key={`${selectionState.profile.id}:${requestId}`}
                    profile={selectionState.profile}
                    access={null}
                    requestId={requestId}
                  />
                ) : null}
              </>
            ) : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "requests" ? (
              <RequestsView key={selectionState.profile.id} profile={selectionState.profile} />
            ) : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "references" ? (
              <ReferencesView key={selectionState.profile.id} profile={selectionState.profile} />
            ) : null}
            {selectionState.status === "ready" && view === "notifications" ? notificationsView(selectionState.profile) : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "request" ? (
              <RequestDetailView
                key={`${selectionState.profile.id}:${requestId}`}
                profile={selectionState.profile}
                access={selectionState.access}
                requestId={requestId}
              />
            ) : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "availability" ? (
              <AvailabilityView key={selectionState.profile.id} profile={selectionState.profile} access={selectionState.access} />
            ) : null}
            {selectionState.status === "ready" && view === "dashboard" ? (
              <ProfileOverview profile={selectionState.profile} access={selectionState.access} />
            ) : null}
            {selectionState.status === "ready" && view === "access" ? <AccessPanel access={selectionState.access} /> : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "search" ? (
              <SearchView key={selectionState.profile.id} profile={selectionState.profile} access={selectionState.access} />
            ) : null}
            {selectionState.status === "ready" && !blockedBySuspension && view === "directory" ? (
              <DirectoryProfileView
                key={`${selectionState.profile.id}:${targetProfileId}`}
                actor={selectionState.profile}
                access={selectionState.access}
                targetProfileId={targetProfileId}
              />
            ) : null}
            {selectionState.status === "ready" && view === "profile" && isProfileSuspended(selectionState.access) ? (
              <div className={styles.dependencyNotice} role="status">
                <strong>{t("Perfil suspendido")}</strong>
                <span>{t("Podés consultar los datos del perfil, pero los cambios quedan bloqueados mientras dure la suspensión.")}</span>
              </div>
            ) : null}
            {selectionState.status === "ready" && view === "profile" ? (
              <ProfileEditor
                key={selectionState.profile.id}
                profile={selectionState.profile}
                access={selectionState.access}
                onProfileChange={applyProfileChange}
              />
            ) : null}
          </main>
        </div>
      ) : null}
    </div>
  );

  return (
    <RealtimeProvider enabled={realtimeEnabled}>
      <ActiveProfileRealtime profileId={loadedProfile?.id ?? null} onAccessChanged={reloadAccess} />
      {shell}
    </RealtimeProvider>
  );
}
