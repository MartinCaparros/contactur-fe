"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { type Locale, intlLocale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import type { Translate } from "@/lib/i18n/translate";

import {
  ApiRequestError,
  type Catalogs,
  type DocumentRecord,
  type Profile,
  downloadProfileDocument,
  firstFieldError,
  getBrowserJson,
  isDocumentResponse,
  isDocumentsResponse,
  isProfileResponse,
  mutateBrowserFormData,
  mutateBrowserNoContent,
} from "./api";
import styles from "./DocumentsPanel.module.css";

type FieldErrors = Readonly<Record<string, readonly string[]>>;
type DocumentType = Catalogs["document_types"][number];
/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type DocumentsState =
  | { status: "loading"; documents: DocumentRecord[] }
  | { status: "ready"; documents: DocumentRecord[] }
  | { status: "error"; documents: DocumentRecord[]; message: string | null };

type DocumentsPanelProps = Readonly<{
  profileId: string;
  documentTypes: readonly DocumentType[];
  requiredOnly?: boolean;
  onDocumentsChange?: (documents: DocumentRecord[]) => void;
  onProfileChange?: (profile: Profile) => void;
}>;

function fieldErrorId(typeId: number, field: string): string {
  return `document-${typeId}-${field.replaceAll(".", "-")}-error`;
}

function DocumentFieldError({
  typeId,
  fields,
  name,
}: Readonly<{ typeId: number; fields: FieldErrors; name: string }>) {
  const message = firstFieldError(fields, name);
  return message ? <span id={fieldErrorId(typeId, name)} className={styles.fieldError} role="alert">{message}</span> : null;
}

function fieldProps(typeId: number, fields: FieldErrors, name: string) {
  const invalid = Boolean(firstFieldError(fields, name));
  return {
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? fieldErrorId(typeId, name) : undefined,
  } as const;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Mensaje propio del error o `null` para usar el genérico al mostrarlo. */
function errorMessage(reason: unknown): string | null {
  return reason instanceof Error ? reason.message : null;
}

function fieldsFrom(reason: unknown): FieldErrors {
  return reason instanceof ApiRequestError ? reason.fields : {};
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function businessDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function documentAllowsCompletion(document: DocumentRecord): boolean {
  if (document.status === "rejected") return false;
  if (document.valid_until !== null && document.valid_until < businessDate()) return false;
  return document.status === "pending" || (document.status === "approved" && document.is_currently_valid);
}

function statusLabel(document: DocumentRecord, t: Translate): string {
  if (document.status === "pending") return t("Pendiente de revisión");
  if (document.status === "rejected") return t("Rechazado");
  return document.is_currently_valid ? t("Aprobado y vigente") : t("Aprobado sin vigencia actual");
}

function formatDate(value: string | null, t: Translate, locale: Locale): string {
  if (!value) return t("No requiere vencimiento");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function DocumentsPanel({
  profileId,
  documentTypes,
  requiredOnly = false,
  onDocumentsChange,
  onProfileChange,
}: DocumentsPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<DocumentsState>({ status: "loading", documents: [] });
  const [busyType, setBusyType] = useState<number | null>(null);
  const [refreshingType, setRefreshingType] = useState<number | null>(null);
  const [refreshFailedTypes, setRefreshFailedTypes] = useState<ReadonlySet<number>>(() => new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<number, FieldErrors>>({});
  const [notices, setNotices] = useState<Record<number, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const onDocumentsChangeRef = useRef(onDocumentsChange);
  const onProfileChangeRef = useRef(onProfileChange);
  onDocumentsChangeRef.current = onDocumentsChange;
  onProfileChangeRef.current = onProfileChange;

  const refreshDocuments = useCallback(async (signal?: AbortSignal) => {
    const response = await getBrowserJson(
      `/api/backend/v1/profiles/${profileId}/documents?per_page=50`,
      isDocumentsResponse,
      signal,
    );
    setState({ status: "ready", documents: response.data });
    onDocumentsChangeRef.current?.(response.data);
    return response.data;
  }, [profileId]);

  const refreshProfile = useCallback(async () => {
    if (!onProfileChangeRef.current) return;
    const response = await getBrowserJson(
      `/api/backend/v1/profiles/${profileId}`,
      isProfileResponse,
    );
    onProfileChangeRef.current?.(response.data);
  }, [profileId]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", documents: [] });
    setFieldErrors({});
    setNotices({});
    setRefreshFailedTypes(new Set());
    setActionError(null);
    void refreshDocuments(controller.signal).catch((reason: unknown) => {
      if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
      setState({
        status: "error",
        documents: [],
        message: errorMessage(reason),
      });
      onDocumentsChangeRef.current?.([]);
    });
    return () => controller.abort();
  }, [profileId, refreshDocuments]);

  const visibleTypes = documentTypes.filter((type) => !requiredOnly || type.required);
  const documents = state.documents;

  const upload = async (event: FormEvent<HTMLFormElement>, type: DocumentType) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const fileControl = formElement.elements.namedItem("file");
    const file = fileControl instanceof HTMLInputElement ? fileControl.files?.[0] : undefined;
    const registrationNumber = values.get("registration_number");
    const validUntil = values.get("valid_until");
    const replacesDocumentId = values.get("replaces_document_id");
    const multipart = new FormData();
    multipart.append("document_type_id", String(type.id));
    if (file) multipart.append("file", file);
    if (typeof registrationNumber === "string" && registrationNumber.trim()) {
      multipart.append("registration_number", registrationNumber.trim());
    }
    if (typeof validUntil === "string" && validUntil) multipart.append("valid_until", validUntil);
    if (typeof replacesDocumentId === "string" && replacesDocumentId) {
      multipart.append("replaces_document_id", replacesDocumentId);
    }

    setBusyType(type.id);
    setRefreshFailedTypes((current) => {
      const next = new Set(current);
      next.delete(type.id);
      return next;
    });
    setFieldErrors((current) => ({ ...current, [type.id]: {} }));
    setNotices((current) => ({ ...current, [type.id]: "" }));
    setActionError(null);
    try {
      await mutateBrowserFormData(
        `/api/backend/v1/profiles/${profileId}/documents`,
        multipart,
        isDocumentResponse,
      );
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) {
        setBusyType(null);
        return;
      }
      setFieldErrors((current) => ({ ...current, [type.id]: fieldsFrom(reason) }));
      setNotices((current) => ({ ...current, [type.id]: messageFrom(reason, t("No pudimos cargar el documento.")) }));
      setBusyType(null);
      return;
    }

    formElement.reset();
    try {
      await Promise.all([refreshDocuments(), refreshProfile()]);
      setNotices((current) => ({ ...current, [type.id]: t("Documento cargado y pendiente de revisión.") }));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setRefreshFailedTypes((current) => new Set(current).add(type.id));
      setNotices((current) => ({
        ...current,
        [type.id]: t("Documento guardado, no pudimos refrescar la información. Reintentá la actualización; no vuelvas a subir el archivo."),
      }));
    } finally {
      setBusyType(null);
    }
  };

  const retryRefresh = async (typeId: number) => {
    setRefreshingType(typeId);
    setActionError(null);
    try {
      await Promise.all([refreshDocuments(), refreshProfile()]);
      setRefreshFailedTypes((current) => {
        const next = new Set(current);
        next.delete(typeId);
        return next;
      });
      setNotices((current) => ({ ...current, [typeId]: t("La información documental quedó actualizada.") }));
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setNotices((current) => ({
        ...current,
        [typeId]: t("El documento está guardado, pero todavía no pudimos refrescar la información."),
      }));
    } finally {
      setRefreshingType(null);
    }
  };

  const download = async (document: DocumentRecord) => {
    setDownloadingId(document.id);
    setActionError(null);
    try {
      // Misma descarga que usa el backoffice: el helper vive en `api` para que la
      // rama binaria y la rama JSON del contrato no se implementen dos veces.
      await downloadProfileDocument(profileId, document);
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setActionError(messageFrom(reason, t("No pudimos descargar el documento.")));
    } finally {
      setDownloadingId(null);
    }
  };

  const remove = async (document: DocumentRecord) => {
    setDeletingId(document.id);
    setActionError(null);
    try {
      await mutateBrowserNoContent(
        `/api/backend/v1/profiles/${profileId}/documents/${document.id}`,
        "DELETE",
      );
      await Promise.all([refreshDocuments(), refreshProfile()]);
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      setActionError(messageFrom(reason, t("No pudimos eliminar el documento.")));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={styles.documents}>
      {state.status === "loading" ? <p role="status">{t("Consultando documentación…")}</p> : null}
      {state.status === "error" ? <div className={styles.errorNotice} role="alert"><strong>{t("No pudimos listar los documentos")}</strong><p>{state.message ?? t("No pudimos consultar la documentación.")}</p></div> : null}
      {actionError ? <div className={styles.errorNotice} role="alert">{actionError}</div> : null}
      {visibleTypes.length === 0 ? <p>{t("No hay tipos documentales configurados para este perfil.")}</p> : null}

      <div className={styles.typeGrid}>
        {visibleTypes.map((type) => {
          const typeDocuments = documents.filter((document) => document.document_type.id === type.id);
          const currentDocument = typeDocuments[0];
          const errors = fieldErrors[type.id] ?? {};
          const notice = notices[type.id];
          return (
            <section className={styles.typeCard} key={type.id} aria-labelledby={`document-type-${type.id}`}>
              <div className={styles.typeHeading}>
                <div>
                  <h3 id={`document-type-${type.id}`}>{type.label}</h3>
                  <p>{type.required ? t("Obligatorio") : t("Opcional")} · {type.requires_expiration ? t("requiere vigencia") : t("sin vencimiento obligatorio")}</p>
                </div>
                <span data-status={currentDocument?.status ?? "missing"}>
                  {currentDocument ? statusLabel(currentDocument, t) : t("Pendiente de carga")}
                </span>
              </div>

              <form className={styles.uploadForm} onSubmit={(event) => void upload(event, type)} noValidate>
                <label>{t("Archivo PDF, JPEG o PNG")}
                  <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required {...fieldProps(type.id, errors, "file")} />
                  <DocumentFieldError typeId={type.id} fields={errors} name="file" />
                </label>
                <label>{t("Número de registro, si corresponde")}
                  <input name="registration_number" maxLength={160} {...fieldProps(type.id, errors, "registration_number")} />
                  <DocumentFieldError typeId={type.id} fields={errors} name="registration_number" />
                </label>
                <label>{t("Vigente hasta")}
                  <input name="valid_until" type="date" required={type.requires_expiration} {...fieldProps(type.id, errors, "valid_until")} />
                  <DocumentFieldError typeId={type.id} fields={errors} name="valid_until" />
                </label>
                {typeDocuments.length > 0 ? (
                  <label>{t("Documento que reemplaza")}
                    <select name="replaces_document_id" defaultValue={typeDocuments[0]?.id ?? ""} {...fieldProps(type.id, errors, "replaces_document_id")}>
                      <option value="">{t("Nueva carga sin reemplazo")}</option>
                      {typeDocuments.map((document) => <option value={document.id} key={document.id}>{document.original_filename}</option>)}
                    </select>
                    <DocumentFieldError typeId={type.id} fields={errors} name="replaces_document_id" />
                  </label>
                ) : null}
                <DocumentFieldError typeId={type.id} fields={errors} name="document_type_id" />
                {notice ? <p className={Object.keys(errors).length > 0 ? styles.formError : styles.formSuccess} role={Object.keys(errors).length > 0 ? "alert" : "status"}>{notice}</p> : null}
                {refreshFailedTypes.has(type.id) ? (
                  <button type="button" onClick={() => void retryRefresh(type.id)} disabled={refreshingType !== null}>
                    {refreshingType === type.id ? t("Actualizando…") : t("Reintentar actualización documental")}
                  </button>
                ) : null}
                <button type="submit" disabled={busyType !== null || refreshingType !== null || state.status === "loading"}>
                  {busyType === type.id ? t("Subiendo…") : currentDocument ? t("Subir reemplazo") : t("Subir documento")}
                </button>
              </form>
            </section>
          );
        })}
      </div>

      {state.status === "ready" ? (
        <section className={styles.currentDocuments} aria-labelledby={`current-documents-${profileId}`}>
          <h3 id={`current-documents-${profileId}`}>{t("Documentos actuales")}</h3>
          {documents.length === 0 ? <p>{t("No hay documentos cargados.")}</p> : (
            <ul>
              {documents.map((document) => (
                <li key={document.id}>
                  <div>
                    <strong>{document.document_type.label}</strong>
                    <span>{document.original_filename}</span>
                    <small>{t("Estado: {status} · Vigencia: {validity}", { status: statusLabel(document, t), validity: formatDate(document.valid_until, t, locale) })}</small>
                    {document.status === "rejected" && document.rejection_reason ? <small className={styles.rejection}>{t("Motivo: {reason}", { reason: document.rejection_reason })}</small> : null}
                  </div>
                  <div className={styles.documentActions}>
                    <button type="button" onClick={() => void download(document)} disabled={downloadingId === document.id}>
                      {downloadingId === document.id ? t("Descargando…") : t("Descargar")}
                    </button>
                    <button type="button" onClick={() => void remove(document)} disabled={deletingId === document.id}>
                      {deletingId === document.id ? t("Eliminando…") : t("Eliminar")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
