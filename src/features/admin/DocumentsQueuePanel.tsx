"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { browserTranslate } from "@/lib/i18n/browser";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import {
  AccessStatePill,
  CursorPagination,
  DocumentStatePill,
  ListErrorNotice,
  type MutationOutcome,
  OutcomeNotice,
  PermissionNotice,
  ProfileStatePill,
} from "./AdminFeedback";
import { DocumentReviewDialog } from "./DocumentReviewDialog";
import {
  ADMIN_CATEGORIES,
  type AdminDocumentEntry,
  type AdminDocumentReviewInput,
  CATALOGS_PATH,
  DOCUMENT_STATUSES,
  type DocumentReviewAction,
  type DocumentStatus,
  type DocumentTypeItem,
  type DocumentsFilters,
  type PaginationMeta,
  type ProfileCategory,
  adminDocumentReviewPath,
  adminDocumentsPath,
  categoryLabel,
  documentStatusLabel,
  documentValidityLabel,
  downloadProfileDocument,
  errorCodeFrom,
  fieldErrorFrom,
  formatBytes,
  formatDateTime,
  getBrowserJson,
  isCatalogsResponse,
  isAdminDocumentsResponse,
  isDocumentResponse,
  isStatus,
  messageFrom,
  mutateBrowserJson,
  redirectIfUnauthorized,
} from "./api";
import styles from "./AdminPanels.module.css";

type LoadedState =
  | { status: "ready"; entries: readonly AdminDocumentEntry[]; meta: PaginationMeta }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

type ListState = LoadedState | { status: "loading" };

/** El resultado se guarda junto a la URL que lo produjo, así el estado de carga se
 * deriva de la consulta vigente en lugar de escribirse dentro del efecto. */
type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

type TypesState =
  | { status: "loading" }
  | { status: "ready"; types: readonly DocumentTypeItem[] }
  | { status: "error"; message: string };

type Target = Readonly<{ entry: AdminDocumentEntry; action: DocumentReviewAction }>;

const EMPTY_FILTERS: DocumentsFilters = { status: "", category: "", documentTypeId: "", cursor: null };

/**
 * Los tres conflictos reales del backend tienen mensaje propio y distinguible: cada uno
 * describe una causa distinta y una salida distinta, así que un texto genérico obligaría
 * a adivinar qué pasó.
 */
const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  document_not_pending: tk("El documento ya no está pendiente de revisión: otra decisión se aplicó antes que esta, así que el backend no volvió a revisarlo y nada cambió ahora. Actualizá la cola para ver el estado real antes de insistir."),
  document_file_unavailable: tk("El archivo del documento ya no está disponible en el almacenamiento privado, así que no hay nada que revisar ni descargar. El documento queda como está: pedile al titular una carga nueva."),
  document_expired: tk("No se puede aprobar un documento vencido: su vigencia declarada ya pasó. El documento sigue pendiente. Podés rechazarlo pidiendo un reemplazo con vigencia al día."),
};

function conflictMessageFor(reason: unknown, t: Translate): string | null {
  const code = errorCodeFrom(reason);
  if (code === null) return null;
  const known = CONFLICT_MESSAGES[code];
  if (known === undefined) return null;
  return `${t(known)} ${t("El backend respondió: {detail}", { detail: messageFrom(reason, t("sin detalle.")) })}`;
}

function statusSummary(status: "" | DocumentStatus, t: Translate): string {
  return status === ""
    ? t("Estado consultado: pendientes. Sin filtro de estado el backend devuelve solo la cola de pendientes.")
    : t("Estado consultado: {status}.", { status: documentStatusLabel(status, t) });
}

export function DocumentsQueuePanel() {
  const t = useT();
  const locale = useLocale();
  const [filters, setFilters] = useState<DocumentsFilters>(EMPTY_FILTERS);
  const [draftStatus, setDraftStatus] = useState<"" | DocumentStatus>("");
  const [draftCategory, setDraftCategory] = useState<"" | ProfileCategory>("");
  const [draftTypeId, setDraftTypeId] = useState("");
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const [types, setTypes] = useState<TypesState>({ status: "loading" });
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const generation = useRef(0);

  const requestPath = adminDocumentsPath(filters);
  const state: ListState = loaded?.key === requestPath ? loaded.state : { status: "loading" };

  // Toda respuesta se compara contra la generación vigente: una respuesta tardía de
  // un filtro anterior nunca sobreescribe el listado actual.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAdminDocumentsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
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
          state: { status: "error", message: messageFrom(reason, browserTranslate("No pudimos listar la cola documental.")) },
        });
      });

    return () => controller.abort();
  }, [requestPath]);

  // Los tipos documentales del filtro salen del catálogo real; si el catálogo falla el
  // filtro queda deshabilitado con su motivo, nunca con una lista inventada.
  useEffect(() => {
    const controller = new AbortController();

    void getBrowserJson(CATALOGS_PATH, isCatalogsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setTypes({ status: "ready", types: response.data.document_types });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (redirectIfUnauthorized(reason)) return;
        setTypes({
          status: "error",
          message: messageFrom(reason, browserTranslate("No pudimos consultar los tipos documentales.")),
        });
      });

    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const response = await getBrowserJson(requestPath, isAdminDocumentsResponse);
    if (current !== generation.current) return;
    setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
  }, [requestPath]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOutcome(null);
    setDownloadError(null);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters({
      status: draftStatus,
      category: draftCategory,
      documentTypeId: draftTypeId,
      cursor: null,
    });
  };

  const clearFilters = () => {
    setDraftStatus("");
    setDraftCategory("");
    setDraftTypeId("");
    setOutcome(null);
    setDownloadError(null);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters(EMPTY_FILTERS);
  };

  const availableTypes = types.status === "ready"
    ? types.types.filter((type) => draftCategory === "" || type.category === draftCategory)
    : [];

  const changeCategory = (category: "" | ProfileCategory) => {
    setDraftCategory(category);
    if (category === "" || types.status !== "ready") return;
    // Un tipo documental pertenece a una sola categoría: si deja de corresponder se
    // limpia en lugar de mandar una combinación que no devuelve nada.
    const selected = types.types.find((type) => String(type.id) === draftTypeId);
    if (selected && selected.category !== category) setDraftTypeId("");
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

  const openDialog = (entry: AdminDocumentEntry, action: DocumentReviewAction) => {
    setTarget({ entry, action });
    setReasonError(null);
    setConflictMessage(null);
    setGeneralError(null);
  };

  const closeDialog = () => {
    setTarget(null);
    setReasonError(null);
    setConflictMessage(null);
    setGeneralError(null);
  };

  const submitReview = async (rejectionReason: string | null) => {
    if (!target) return;
    setMutationPending(true);
    setReasonError(null);
    setConflictMessage(null);
    setGeneralError(null);

    // `rejection_reason` viaja solo al rechazar: el backend lo prohíbe en un approve.
    const body: AdminDocumentReviewInput = target.action === "approve"
      ? { action: "approve" }
      : { action: "reject", rejection_reason: rejectionReason ?? "" };

    let reviewed;
    try {
      const response = await mutateBrowserJson(
        adminDocumentReviewPath(target.entry.document.id),
        "POST",
        body,
        isDocumentResponse,
      );
      reviewed = response.data;
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setMutationPending(false);
      const conflict = conflictMessageFor(reason_, t);
      if (conflict) {
        setConflictMessage(conflict);
        return;
      }
      const fieldMessage = fieldErrorFrom(reason_, "rejection_reason");
      if (fieldMessage) {
        setReasonError(fieldMessage);
        return;
      }
      if (isStatus(reason_, 403)) {
        setGeneralError(t("No tenés permisos para revisar este documento. {detail}", {
          detail: messageFrom(reason_, t("El backend rechazó la operación.")),
        }));
        return;
      }
      setGeneralError(messageFrom(reason_, t("No pudimos registrar la revisión del documento.")));
      return;
    }

    closeDialog();
    // El estado que se informa es el que devolvió la respuesta, no el solicitado.
    const message = t("El documento «{file}» ({type}) del perfil «{profile}» quedó en estado {status}. La revisión recalcula la verificación documental del perfil; no concede acceso, que sigue dependiendo de su habilitación manual.", {
      file: reviewed.original_filename,
      type: reviewed.document_type.label,
      profile: target.entry.profile.display_name,
      status: documentStatusLabel(reviewed.status, t),
    });

    try {
      await refresh();
      setOutcome({ message, refreshed: true });
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setOutcome({ message, refreshed: false });
    } finally {
      setMutationPending(false);
    }
  };

  const retryRefresh = async () => {
    setRetrying(true);
    try {
      await refresh();
      setOutcome((current) => (current ? { ...current, refreshed: true } : current));
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setOutcome((current) => (current ? { ...current, refreshed: false } : current));
    } finally {
      setRetrying(false);
    }
  };

  const download = async (entry: AdminDocumentEntry) => {
    setDownloadingId(entry.document.id);
    setDownloadError(null);
    try {
      // Misma ruta protegida que usa el titular: el backend la habilita para una
      // cuenta de administración activa y responde el archivo con su nombre original.
      await downloadProfileDocument(entry.profile.id, entry.document);
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setDownloadError(
        conflictMessageFor(reason_, t) ?? messageFrom(reason_, t("No pudimos descargar el documento.")),
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const entries = state.status === "ready" ? state.entries : [];
  const busy = state.status === "loading" || retrying;

  return (
    <section className={styles.panel} aria-labelledby="admin-documents-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-documents-title">{t("Documentos")}</h1>
      <p className={styles.lead}>
        {t("La cola abre con los documentos pendientes de revisión: mientras no elijas un estado, el backend devuelve solo esa cola y no el total de documentos cargados. Aprobar o rechazar recalcula la verificación documental del perfil y nunca concede acceso.")}
      </p>

      <form onSubmit={applyFilters} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Filtros de la cola documental")}</legend>
          <div className={styles.filterField}>
            <label htmlFor="admin-documents-status">{t("Estado del documento")}</label>
            <select
              id="admin-documents-status"
              name="status"
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value as "" | DocumentStatus)}
              aria-describedby="admin-documents-status-hint"
            >
              <option value="">{t("Pendientes (predeterminado del backend)")}</option>
              {DOCUMENT_STATUSES.map((status) => (
                <option value={status} key={status}>{documentStatusLabel(status, t)}</option>
              ))}
            </select>
            <span className={styles.fieldHint} id="admin-documents-status-hint">
              {t("No hay opción «todos»: la consulta devuelve un estado por vez y los estados internos que el backend usa al reemplazar una carga no son revisables.")}
            </span>
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-documents-category">{t("Categoría del perfil")}</label>
            <select
              id="admin-documents-category"
              name="category"
              value={draftCategory}
              onChange={(event) => changeCategory(event.target.value as "" | ProfileCategory)}
            >
              <option value="">{t("Todas las categorías")}</option>
              {ADMIN_CATEGORIES.map((category) => (
                <option value={category} key={category}>{categoryLabel(category, t)}</option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-documents-type">{t("Tipo documental")}</label>
            <select
              id="admin-documents-type"
              name="document_type_id"
              value={draftTypeId}
              disabled={types.status !== "ready"}
              onChange={(event) => setDraftTypeId(event.target.value)}
              aria-describedby={types.status === "error" ? "admin-documents-types-error" : undefined}
            >
              <option value="">{t("Todos los tipos documentales")}</option>
              {availableTypes.map((type) => (
                <option value={type.id} key={type.id}>
                  {type.label} · {categoryLabel(type.category, t)}
                </option>
              ))}
            </select>
            {types.status === "loading" ? (
              <span className={styles.fieldHint}>{t("Consultando tipos documentales…")}</span>
            ) : null}
            {types.status === "error" ? (
              <span className={styles.fieldError} id="admin-documents-types-error" role="alert">
                {types.message} {t("El filtro por tipo documental queda sin usar.")}
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

      <OutcomeNotice outcome={outcome} retrying={retrying} onRetry={() => void retryRefresh()} />

      {downloadError ? (
        <ListErrorNotice title={t("No pudimos descargar el documento")} message={downloadError} />
      ) : null}

      {state.status === "loading" ? (
        <div aria-busy="true" role="status">
          <span>{t("Consultando la cola documental…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? (
        <ListErrorNotice title={t("No pudimos listar la cola documental")} message={state.message} />
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.summaryBar}>
            <span>
              {entries.length === 0
                ? filters.status === ""
                  ? t("No hay documentos pendientes de revisión con estos filtros.")
                  : t("Ningún documento coincide con los filtros aplicados.")
                : t("{count} documentos en esta página.", { count: entries.length })}
            </span>
            <span>{statusSummary(filters.status, t)}</span>
          </p>

          {entries.length > 0 ? (
            <ul className={styles.recordList}>
              {entries.map((entry) => {
                const document_ = entry.document;
                const pendingReview = document_.status === "pending";
                return (
                  <li className={styles.recordCard} key={document_.id} data-document-id={document_.id}>
                    <div className={styles.recordHeading}>
                      <h3>{document_.document_type.label}</h3>
                      <span className={styles.pillGroup}>
                        <DocumentStatePill status={document_.status} />
                        <ProfileStatePill status={entry.profile.status} />
                        <AccessStatePill state={entry.profile.access_state} />
                      </span>
                    </div>
                    <dl className={styles.recordFields}>
                      <div>
                        <dt>{t("Archivo")}</dt>
                        <dd>{document_.original_filename} · {formatBytes(document_.size_bytes)}</dd>
                      </div>
                      <div>
                        <dt>{t("Perfil")}</dt>
                        <dd>{entry.profile.display_name} · {categoryLabel(entry.profile.category, t)}</dd>
                      </div>
                      <div>
                        <dt>{t("Titular")}</dt>
                        <dd>{entry.owner.name} · {entry.owner.email}</dd>
                      </div>
                      <div>
                        <dt>{t("Exigencia")}</dt>
                        <dd>
                          {document_.document_type.required ? t("Obligatorio") : t("Opcional")} ·{" "}
                          {document_.document_type.requires_expiration ? t("requiere vigencia") : t("sin vencimiento obligatorio")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("Vigencia")}</dt>
                        <dd>{documentValidityLabel(document_, locale)}</dd>
                      </div>
                      <div>
                        <dt>{t("Número de registro")}</dt>
                        <dd>{document_.registration_number ?? t("Sin número declarado")}</dd>
                      </div>
                      <div>
                        <dt>{t("Cargado")}</dt>
                        <dd>{formatDateTime(document_.uploaded_at, locale)}</dd>
                      </div>
                      <div>
                        <dt>{t("Revisado")}</dt>
                        <dd>{document_.reviewed_at ? formatDateTime(document_.reviewed_at, locale) : t("Sin revisar")}</dd>
                      </div>
                      {document_.status === "rejected" && document_.rejection_reason ? (
                        <div>
                          <dt>{t("Motivo del rechazo")}</dt>
                          <dd>{document_.rejection_reason}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className={styles.recordActions}>
                      {pendingReview ? (
                        <>
                          <button type="button" onClick={() => openDialog(entry, "approve")}>
                            {t("Aprobar documento")}
                          </button>
                          <button
                            type="button"
                            data-variant="danger"
                            onClick={() => openDialog(entry, "reject")}
                          >
                            {t("Rechazar documento")}
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        data-variant="ghost"
                        onClick={() => void download(entry)}
                        disabled={downloadingId === document_.id}
                      >
                        {downloadingId === document_.id ? t("Descargando…") : t("Descargar archivo")}
                      </button>
                      <p className={styles.recordNote}>
                        {pendingReview
                          ? t("La decisión queda auditada con su motivo. Revisar no otorga ni quita habilitación.")
                          : t("Ya revisado: el backend solo acepta revisar documentos pendientes, así que no se ofrece cambiar la decisión.")}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <CursorPagination
            pageIndex={pageIndex}
            shown={entries.length}
            total={state.meta.total ?? null}
            hasNext={state.meta.next_cursor !== null}
            busy={busy}
            onPrevious={goPrevious}
            onNext={goNext}
          />
        </>
      ) : null}

      {target ? (
        <DocumentReviewDialog
          entry={target.entry}
          action={target.action}
          pending={mutationPending}
          reasonError={reasonError}
          conflictMessage={conflictMessage}
          generalError={generalError}
          onSubmit={(rejectionReason) => void submitReview(rejectionReason)}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  );
}
