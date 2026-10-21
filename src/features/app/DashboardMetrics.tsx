"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { REALTIME_EVENTS, payloadProfileId, profileChannel } from "@/lib/realtime/channels";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { useInvalidationRefresh } from "@/lib/realtime/RealtimeProvider";

import { ApiRequestError, type Dashboard, dashboardPath, getBrowserJson, isDashboardResponse } from "./api";
import { dashboardMetricViews, formatMetricValue } from "./dashboardModel";
import { ownAccessText } from "./requestsModel";
import styles from "./Dashboard.module.css";

/** Avisos del canal propio que pueden mover algún KPI; solo disparan la re-consulta. */
const DASHBOARD_EVENTS = [
  REALTIME_EVENTS.notificationCreated,
  REALTIME_EVENTS.accessChanged,
  REALTIME_EVENTS.availabilityChanged,
] as const;

type MetricsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; dashboard: Dashboard; stale: boolean }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "error" }>;

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

/**
 * Indicadores del perfil activo (GET /profiles/{id}/dashboard). Se monta con
 * `key={profileId}`: cambiar de perfil desmonta, aborta lo que esté en vuelo y nunca
 * mezcla valores de dos perfiles (además se descarta una respuesta de otro perfil).
 * Un error nunca muestra ceros inventados; un fallo de la actualización silenciosa
 * conserva los últimos valores confirmados y lo avisa.
 */
export function DashboardMetrics({ profileId }: Readonly<{ profileId: string }>) {
  const t = useT();
  // `run` sube con "Reintentar": el estado de otra corrida se ve como "cargando".
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Readonly<{ run: number; state: MetricsState }> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(loaded);
  const state: MetricsState = loaded?.run === run ? loaded.state : { status: "loading" };

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  /**
   * Una sola consulta en vuelo: la nueva aborta a la anterior. `silent` conserva los
   * valores visibles si la re-consulta falla (se marcan como no actualizados).
   */
  const fetchDashboard = useCallback((key: number, silent: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const settle = (next: (current: MetricsState | null) => MetricsState) => {
      setLoaded((previous) => ({ run: key, state: next(previous?.run === key ? previous.state : null) }));
    };
    const keepOrFail = (current: MetricsState | null): MetricsState =>
      silent && current?.status === "ready" ? { ...current, stale: true } : { status: "error" };

    void getBrowserJson(dashboardPath(profileId), isDashboardResponse, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        // Respuesta de otro perfil: nunca se muestra en el perfil activo.
        if (data.profile_id !== profileId) settle(keepOrFail);
        else settle(() => ({ status: "ready", dashboard: data, stale: false }));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 403) {
          settle(() => ({ status: "forbidden", code: reason.code, message: reason.message }));
          return;
        }
        if (reason instanceof ApiRequestError && reason.status === 404) {
          settle(() => ({ status: "not-found" }));
          return;
        }
        settle(keepOrFail);
      });
  }, [profileId]);

  useEffect(() => {
    fetchDashboard(run, false);
    return () => controllerRef.current?.abort();
  }, [fetchDashboard, run]);

  /** Aviso en vivo o polling: re-consulta sin pasar por "cargando" si ya hay valores. */
  const refreshSilently = useCallback(() => {
    const snapshot = loadedRef.current;
    fetchDashboard(run, snapshot?.run === run && snapshot.state.status === "ready");
  }, [fetchDashboard, run]);
  const eventFilter = useCallback(
    (_eventName: string, payload: unknown) => payloadProfileId(payload) === profileId,
    [profileId],
  );
  useInvalidationRefresh({
    channel: profileChannel(profileId),
    events: DASHBOARD_EVENTS,
    filter: eventFilter,
    refresh: refreshSilently,
  });

  const retry = () => setRun((value) => value + 1);

  return (
    <section className={styles.metrics} aria-labelledby="dashboard-metrics-title" aria-busy={state.status === "loading"}>
      <div className={styles.heading}>
        <h2 id="dashboard-metrics-title">{t("Indicadores del perfil")}</h2>
        <p>{t("Datos reales de este perfil. No suman tus otros perfiles.")}</p>
      </div>

      {state.status === "loading" ? (
        <div className={styles.loading} role="status">
          <span className={styles.srOnly}>{t("Cargando indicadores…")}</span>
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className={styles.errorBox} role="alert">
          <h3>{t("No pudimos cargar los indicadores")}</h3>
          <p>{t("Probá de nuevo en unos segundos. El resto del resumen sigue disponible.")}</p>
          <button type="button" className={styles.retry} onClick={retry}>{t("Reintentar")}</button>
        </div>
      ) : null}

      {state.status === "forbidden" ? (
        <div className={styles.errorBox} role="alert">
          <h3>{t("No podés ver los indicadores en este momento")}</h3>
          <p>{ownAccessText(state.code, t) ?? state.message}</p>
        </div>
      ) : null}

      {state.status === "not-found" ? (
        <div className={styles.errorBox} role="alert">
          <h3>{t("Este perfil no está disponible")}</h3>
          <p>{t("No encontramos el perfil activo en tu cuenta. Elegí otro perfil desde el selector.")}</p>
        </div>
      ) : null}

      {state.status === "ready" ? <MetricList dashboard={state.dashboard} profileId={profileId} /> : null}

      {state.status === "ready" && state.stale ? (
        <p className={styles.staleNote} role="status">
          {t("No pudimos actualizar los indicadores. Mostramos los últimos datos confirmados.")}
          {" "}
          <button type="button" className={styles.inlineRetry} onClick={retry}>{t("Reintentar")}</button>
        </p>
      ) : null}
    </section>
  );
}

function MetricList({ dashboard, profileId }: Readonly<{ dashboard: Dashboard; profileId: string }>) {
  const t = useT();
  const locale = useLocale();
  const views = dashboardMetricViews(dashboard.metrics, profileId, t);
  if (views.length === 0) {
    return <p className={styles.empty} role="status">{t("Todavía no hay indicadores para este perfil.")}</p>;
  }
  return (
    <dl className={styles.grid}>
      {views.map((metric) => (
        <div key={metric.key} className={styles.card} data-metric={metric.key}>
          <dt>{metric.label}</dt>
          <dd className={styles.value}>{formatMetricValue(metric.value, locale)}</dd>
          <dd className={styles.hint}>{metric.hint}</dd>
          <dd><Link className={styles.link} href={metric.href}>{metric.linkLabel}</Link></dd>
        </div>
      ))}
    </dl>
  );
}
