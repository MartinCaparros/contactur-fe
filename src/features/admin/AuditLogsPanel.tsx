"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { browserTranslate } from "@/lib/i18n/browser";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";

import { CursorPagination, ListErrorNotice, PermissionNotice } from "./AdminFeedback";
import { SafeChanges } from "./SafeChanges";
import {
  AUDIT_ACTION_SUGGESTIONS,
  AUDIT_TARGET_TYPES,
  type AuditFilters,
  type AuditLog,
  type PaginationMeta,
  adminAuditLogsPath,
  auditActionLabel,
  auditTargetTypeLabel,
  fieldErrorFrom,
  formatDateTime,
  getBrowserJson,
  isAuditLogsResponse,
  isStatus,
  messageFrom,
  redirectIfUnauthorized,
} from "./api";
import styles from "./AdminPanels.module.css";

type FieldErrors = Readonly<{
  action: string | null;
  targetType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}>;

type LoadedState =
  | { status: "ready"; logs: readonly AuditLog[]; meta: PaginationMeta }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string; fieldErrors: FieldErrors };

type ListState = LoadedState | { status: "loading" };

/** El resultado se guarda junto a la URL que lo produjo, así el estado de carga se
 * deriva de la consulta vigente en lugar de escribirse dentro del efecto. */
type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

const NO_FIELD_ERRORS: FieldErrors = { action: null, targetType: null, dateFrom: null, dateTo: null };

const EMPTY_FILTERS: AuditFilters = { action: "", targetType: "", dateFrom: "", dateTo: "", cursor: null };

const ACTION_LIST_ID = "admin-audit-action-options";

export function AuditLogsPanel() {
  const t = useT();
  const locale = useLocale();
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const generation = useRef(0);

  const requestPath = adminAuditLogsPath(filters);
  const state: ListState = loaded?.key === requestPath ? loaded.state : { status: "loading" };
  const fieldErrors = state.status === "error" ? state.fieldErrors : NO_FIELD_ERRORS;

  // Toda respuesta se compara contra la generación vigente: una respuesta tardía de
  // un filtro anterior nunca sobreescribe el listado actual.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAuditLogsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key: requestPath, state: { status: "ready", logs: response.data, meta: response.meta } });
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
            message: messageFrom(reason, browserTranslate("No pudimos consultar la auditoría.")),
            fieldErrors: isStatus(reason, 422)
              ? {
                action: fieldErrorFrom(reason, "action"),
                targetType: fieldErrorFrom(reason, "target_type"),
                dateFrom: fieldErrorFrom(reason, "date_from"),
                dateTo: fieldErrorFrom(reason, "date_to"),
              }
              : NO_FIELD_ERRORS,
          },
        });
      });

    return () => controller.abort();
  }, [requestPath]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters({
      action: draft.action.trim(),
      targetType: draft.targetType,
      dateFrom: draft.dateFrom,
      dateTo: draft.dateTo,
      cursor: null,
    });
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters(EMPTY_FILTERS);
  };

  const goNext = () => {
    const nextCursor = state.status === "ready" ? state.meta.next_cursor : null;
    if (nextCursor === null) return;
    setCursorHistory((history) => [...history.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex(pageIndex + 1);
    setFilters((current) => ({ ...current, cursor: nextCursor }));
  };

  const goPrevious = () => {
    if (pageIndex === 0) return;
    const previousCursor = cursorHistory[pageIndex - 1] ?? null;
    setPageIndex(pageIndex - 1);
    setFilters((current) => ({ ...current, cursor: previousCursor }));
  };

  const logs = state.status === "ready" ? state.logs : [];
  const busy = state.status === "loading";

  return (
    <section className={styles.panel} aria-labelledby="admin-audit-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-audit-title">{t("Auditoría")}</h1>
      <p className={styles.lead}>
        {t("Registro de solo lectura de las mutaciones administrativas. No hay acciones sobre los eventos: no se editan, no se borran y no se ocultan. Los actores y destinos se identifican con identificadores públicos, no con datos de contacto.")}
      </p>

      <form onSubmit={applyFilters} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Filtros de auditoría")}</legend>
          <div className={styles.filterField}>
            <label htmlFor="admin-audit-action">{t("Acción")}</label>
            <input
              id="admin-audit-action"
              type="text"
              name="action"
              list={ACTION_LIST_ID}
              value={draft.action}
              maxLength={100}
              onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
              aria-invalid={fieldErrors.action ? true : undefined}
              aria-describedby={
                fieldErrors.action ? "admin-audit-action-hint admin-audit-action-error" : "admin-audit-action-hint"
              }
            />
            <datalist id={ACTION_LIST_ID}>
              {AUDIT_ACTION_SUGGESTIONS.map((action) => (
                <option value={action} key={action}>{auditActionLabel(action, t) ?? action}</option>
              ))}
            </datalist>
            <span className={styles.fieldHint} id="admin-audit-action-hint">
              {t("Coincidencia exacta con el nombre de la acción. Las sugerencias son las que el backend emite hoy; podés escribir otra.")}
            </span>
            {fieldErrors.action ? (
              <span className={styles.fieldError} id="admin-audit-action-error" role="alert">
                {fieldErrors.action}
              </span>
            ) : null}
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-audit-target">{t("Tipo de destino")}</label>
            <select
              id="admin-audit-target"
              name="target_type"
              value={draft.targetType}
              onChange={(event) => setDraft((current) => ({ ...current, targetType: event.target.value }))}
              aria-invalid={fieldErrors.targetType ? true : undefined}
              aria-describedby={fieldErrors.targetType ? "admin-audit-target-error" : undefined}
            >
              <option value="">{t("Todos los destinos")}</option>
              {AUDIT_TARGET_TYPES.map((targetType) => (
                <option value={targetType} key={targetType}>
                  {auditTargetTypeLabel(targetType, t) ?? targetType}
                </option>
              ))}
            </select>
            {fieldErrors.targetType ? (
              <span className={styles.fieldError} id="admin-audit-target-error" role="alert">
                {fieldErrors.targetType}
              </span>
            ) : null}
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-audit-date-from">{t("Desde")}</label>
            <input
              id="admin-audit-date-from"
              type="date"
              name="date_from"
              value={draft.dateFrom}
              onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))}
              aria-invalid={fieldErrors.dateFrom ? true : undefined}
              aria-describedby={fieldErrors.dateFrom ? "admin-audit-date-from-error" : undefined}
            />
            {fieldErrors.dateFrom ? (
              <span className={styles.fieldError} id="admin-audit-date-from-error" role="alert">
                {fieldErrors.dateFrom}
              </span>
            ) : null}
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-audit-date-to">{t("Hasta")}</label>
            <input
              id="admin-audit-date-to"
              type="date"
              name="date_to"
              value={draft.dateTo}
              onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))}
              aria-invalid={fieldErrors.dateTo ? true : undefined}
              aria-describedby={fieldErrors.dateTo ? "admin-audit-date-to-error" : undefined}
            />
            {fieldErrors.dateTo ? (
              <span className={styles.fieldError} id="admin-audit-date-to-error" role="alert">
                {fieldErrors.dateTo}
              </span>
            ) : null}
          </div>
          <div className={styles.filterActions}>
            <button type="submit" disabled={busy}>{t("Aplicar filtros")}</button>
            <button type="button" data-variant="ghost" onClick={clearFilters} disabled={busy}>
              {t("Limpiar")}
            </button>
          </div>
        </fieldset>
      </form>

      {state.status === "loading" ? (
        <div aria-busy="true" role="status">
          <span>{t("Consultando la auditoría…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? (
        <ListErrorNotice title={t("No pudimos consultar la auditoría")} message={state.message} />
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.summaryBar}>
            <span>
              {logs.length === 0
                ? t("Ningún evento de auditoría coincide con los filtros aplicados.")
                : t("{count} eventos en esta página.", { count: logs.length })}
            </span>
          </p>

          {logs.length > 0 ? (
            <ul className={styles.recordList}>
              {logs.map((log) => {
                // Una acción o un destino que todavía no tiene rótulo se muestra con el código crudo.
                const actionLabel = auditActionLabel(log.action, t);
                const targetLabel = auditTargetTypeLabel(log.target_type, t);
                return (
                  <li className={styles.recordCard} key={log.id} data-audit-id={log.id}>
                    <div className={styles.recordHeading}>
                      <h3>{actionLabel ?? log.action}</h3>
                      <span className={styles.pillGroup}>
                        <span className={styles.codePill} data-kind="action">{log.action}</span>
                        <span className={styles.codePill} data-kind="target">{log.target_type}</span>
                      </span>
                    </div>
                    <dl className={styles.recordFields}>
                      <div>
                        <dt>{t("Fecha")}</dt>
                        <dd>{formatDateTime(log.created_at, locale)}</dd>
                      </div>
                      <div>
                        <dt>{t("Destino")} {targetLabel ? `· ${targetLabel}` : ""}</dt>
                        <dd className={styles.identifier}>{log.target_id}</dd>
                      </div>
                      <div>
                        <dt>{t("Responsable (identificador público)")}</dt>
                        <dd className={styles.identifier}>{log.actor_user_id}</dd>
                      </div>
                      <div>
                        <dt>{t("Solicitud")}</dt>
                        <dd className={styles.identifier}>{log.request_id}</dd>
                      </div>
                      <div>
                        <dt>{t("Motivo")}</dt>
                        <dd>{log.reason ?? t("Sin motivo registrado")}</dd>
                      </div>
                    </dl>
                    <div className={styles.changeBlock}>
                      <h4>{t("Cambios registrados")}</h4>
                      <SafeChanges changes={log.safe_changes} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <CursorPagination
            pageIndex={pageIndex}
            shown={logs.length}
            total={state.meta.total ?? null}
            hasNext={state.meta.next_cursor !== null}
            busy={busy}
            onPrevious={goPrevious}
            onNext={goNext}
          />
        </>
      ) : null}
    </section>
  );
}
