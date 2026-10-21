"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { browserTranslate } from "@/lib/i18n/browser";
import { useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import { ListErrorNotice, PermissionNotice } from "./AdminFeedback";
import {
  type AdminMetrics,
  type MetricsRange,
  accessStateKeyLabel,
  adminMetricsPath,
  categoryKeyLabel,
  fieldErrorFrom,
  getBrowserJson,
  isAdminMetricsResponse,
  isStatus,
  messageFrom,
  redirectIfUnauthorized,
} from "./api";
import styles from "./AdminPanels.module.css";

type FieldErrors = Readonly<{ dateFrom: string | null; dateTo: string | null }>;

type LoadedState =
  | { status: "ready"; metrics: AdminMetrics }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string; fieldErrors: FieldErrors };

type MetricsState = LoadedState | { status: "loading" };

/** El resultado se guarda junto a la URL que lo produjo, así el estado de carga se
 * deriva del rango vigente en lugar de escribirse dentro del efecto. */
type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

const NO_FIELD_ERRORS: FieldErrors = { dateFrom: null, dateTo: null };

const EMPTY_RANGE: MetricsRange = { dateFrom: "", dateTo: "" };

/** Texto único para los dos KPI cuya fuente de datos todavía no existe. */
const NO_SOURCE_LABEL = tk("Sin fuente de datos todavía");

function countLabel(map: Readonly<Record<string, number>>, key: string): number {
  return map[key] ?? 0;
}

/** Estados de solicitud (texto fuente); una clave nueva del backend se muestra tal cual. */
const CONTACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: tk("Pendientes"),
  accepted: tk("Aceptadas"),
  rejected: tk("Rechazadas"),
  expired: tk("Vencidas"),
  cancelled: tk("Canceladas"),
};

function contactStatusLabel(key: string, t: Translate): string {
  const label = CONTACT_STATUS_LABELS[key];
  return label === undefined ? key.replaceAll("_", " ") : t(label);
}

export function MetricsPanel() {
  const t = useT();
  const [range, setRange] = useState<MetricsRange>(EMPTY_RANGE);
  const [draft, setDraft] = useState<MetricsRange>(EMPTY_RANGE);
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const generation = useRef(0);

  const requestPath = adminMetricsPath(range);
  const state: MetricsState = loaded?.key === requestPath ? loaded.state : { status: "loading" };
  const fieldErrors = state.status === "error" ? state.fieldErrors : NO_FIELD_ERRORS;

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAdminMetricsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key: requestPath, state: { status: "ready", metrics: response.data } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (isStatus(reason, 403)) {
          setLoaded({
            key: requestPath,
            state: { status: "forbidden", message: messageFrom(reason, browserTranslate("La consulta fue rechazada.")) },
          });
          return;
        }
        setLoaded({
          key: requestPath,
          state: {
            status: "error",
            message: messageFrom(reason, browserTranslate("No pudimos consultar las métricas.")),
            fieldErrors: isStatus(reason, 422)
              ? { dateFrom: fieldErrorFrom(reason, "date_from"), dateTo: fieldErrorFrom(reason, "date_to") }
              : NO_FIELD_ERRORS,
          },
        });
      });

    return () => controller.abort();
  }, [requestPath]);

  const applyRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRange({ dateFrom: draft.dateFrom, dateTo: draft.dateTo });
  };

  const clearRange = () => {
    setDraft(EMPTY_RANGE);
    setRange(EMPTY_RANGE);
  };

  const metrics = state.status === "ready" ? state.metrics : null;
  const busy = state.status === "loading";

  return (
    <section className={styles.panel} aria-labelledby="admin-metrics-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-metrics-title">{t("Panel administrativo")}</h1>
      <p className={styles.lead}>
        {t("Métricas agregadas de cuentas, perfiles y documentación. Los contadores reflejan lo que devuelve el backend: cuando una fuente de datos todavía no existe se informa como ausencia, nunca como cero.")}
      </p>

      <form onSubmit={applyRange} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Rango de fechas")}</legend>
          <label>
            {t("Desde")}
            <input
              type="date"
              name="date_from"
              value={draft.dateFrom}
              onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))}
              aria-invalid={fieldErrors.dateFrom ? true : undefined}
              aria-describedby={fieldErrors.dateFrom ? "admin-metrics-date-from-error" : undefined}
            />
            {fieldErrors.dateFrom ? (
              <span className={styles.fieldError} id="admin-metrics-date-from-error" role="alert">
                {fieldErrors.dateFrom}
              </span>
            ) : null}
          </label>
          <label>
            {t("Hasta")}
            <input
              type="date"
              name="date_to"
              value={draft.dateTo}
              onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))}
              aria-invalid={fieldErrors.dateTo ? true : undefined}
              aria-describedby={fieldErrors.dateTo ? "admin-metrics-date-to-error" : undefined}
            />
            {fieldErrors.dateTo ? (
              <span className={styles.fieldError} id="admin-metrics-date-to-error" role="alert">
                {fieldErrors.dateTo}
              </span>
            ) : null}
          </label>
          <div className={styles.filterActions}>
            <button type="submit" disabled={busy}>{t("Aplicar rango")}</button>
            <button type="button" data-variant="ghost" onClick={clearRange} disabled={busy}>
              {t("Quitar rango")}
            </button>
          </div>
        </fieldset>
      </form>

      {state.status === "loading" ? (
        <div aria-busy="true" role="status">
          <span>{t("Consultando métricas…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? (
        <ListErrorNotice title={t("No pudimos consultar las métricas")} message={state.message} />
      ) : null}

      {metrics ? (
        <>
          <div className={styles.metricGrid}>
            <article className={styles.metricCard} data-metric="users_active">
              <h3>{t("Cuentas activas")}</h3>
              <span className={styles.metricValue}>{countLabel(metrics.users, "active")}</span>
              <p className={styles.metricHint}>{t("Cuentas que pueden operar en la plataforma.")}</p>
            </article>
            <article className={styles.metricCard} data-metric="users_suspended">
              <h3>{t("Cuentas suspendidas")}</h3>
              <span className={styles.metricValue}>{countLabel(metrics.users, "suspended")}</span>
              <p className={styles.metricHint}>{t("Solo conservan estado, soporte y cierre de sesión.")}</p>
            </article>
            <article className={styles.metricCard} data-metric="documents_pending">
              <h3>{t("Documentos pendientes")}</h3>
              <span className={styles.metricValue}>{metrics.documents_pending}</span>
              <p className={styles.metricHint}>
                {t("Cargas a la espera de revisión. Se revisan en la cola documental del backoffice.")}
              </p>
            </article>

            {Object.keys(metrics.contact_requests_by_status).length === 0 ? (
              <article
                className={styles.metricCard}
                data-metric="contact_requests_by_status"
                data-source="missing"
              >
                <h3>{t("Solicitudes de contacto")}</h3>
                <span className={styles.metricValue}>{t(NO_SOURCE_LABEL)}</span>
                <p className={styles.metricHint}>
                  {t("El backend devolvió el mapa sin claves porque las solicitudes de contacto todavía no existen como fuente de datos. No hay ningún recuento que mostrar y esto no equivale a ausencia de solicitudes.")}
                </p>
              </article>
            ) : (
              <article className={styles.metricCard} data-metric="contact_requests_by_status">
                <h3>{t("Solicitudes de contacto")}</h3>
                <span className={styles.metricValue}>
                  {Object.values(metrics.contact_requests_by_status).reduce((total, value) => total + value, 0)}
                </span>
                <p className={styles.metricHint}>
                  {Object.entries(metrics.contact_requests_by_status)
                    .map(([status, value]) => `${contactStatusLabel(status, t)}: ${value}`)
                    .join(" · ")}
                </p>
              </article>
            )}

            {metrics.support_inquiries_pending === null ? (
              <article
                className={styles.metricCard}
                data-metric="support_inquiries_pending"
                data-source="missing"
              >
                <h3>{t("Consultas de soporte sin responder")}</h3>
                <span className={styles.metricValue}>{t(NO_SOURCE_LABEL)}</span>
                <p className={styles.metricHint}>
                  {t("El backend devolvió un valor nulo: la mesa de soporte todavía no persiste consultas, así que no puede afirmar ninguna cantidad. No es ausencia de consultas.")}
                </p>
              </article>
            ) : (
              <article className={styles.metricCard} data-metric="support_inquiries_pending">
                <h3>{t("Consultas de soporte sin responder")}</h3>
                <span className={styles.metricValue}>{metrics.support_inquiries_pending}</span>
                <p className={styles.metricHint}>{t("Consultas recibidas que siguen sin respuesta.")}</p>
              </article>
            )}
          </div>

          <div className={styles.breakdown}>
            <article className={styles.breakdownCard} aria-labelledby="admin-metrics-categories">
              <h3 id="admin-metrics-categories">{t("Perfiles por categoría")}</h3>
              <dl>
                {Object.entries(metrics.profiles_by_category).map(([key, value]) => (
                  <div key={key}>
                    <dt>{categoryKeyLabel(key, t)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className={styles.breakdownCard} aria-labelledby="admin-metrics-access">
              <h3 id="admin-metrics-access">{t("Perfiles por estado de acceso")}</h3>
              <dl>
                {Object.entries(metrics.profiles_by_access_state).map(([key, value]) => (
                  <div key={key}>
                    <dt>{accessStateKeyLabel(key, t)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
