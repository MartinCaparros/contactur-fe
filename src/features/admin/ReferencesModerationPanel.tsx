"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { browserTranslate } from "@/lib/i18n/browser";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import {
  CursorPagination,
  ListErrorNotice,
  type MutationOutcome,
  OutcomeNotice,
  PermissionNotice,
} from "./AdminFeedback";
import { StatusChangeDialog } from "./StatusChangeDialog";
import {
  type AdminReferenceEntry,
  type AdminReferenceModerationInput,
  type PaginationMeta,
  type ReferenceModerationAction,
  type ReferenceRecord,
  type ReferencesFilters,
  type ReferencesModerationFilter,
  adminReferenceModeratePath,
  adminReferencesPath,
  categoryLabel,
  fieldErrorFrom,
  formatDateTime,
  getBrowserJson,
  isAdminReferencesResponse,
  isPublicProfileId,
  isReferenceResponse,
  isStatus,
  messageFrom,
  mutateBrowserJson,
  redirectIfUnauthorized,
} from "./api";
import styles from "./AdminPanels.module.css";

type LoadedState =
  | { status: "ready"; entries: readonly AdminReferenceEntry[]; meta: PaginationMeta }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

type ListState = LoadedState | { status: "loading" };

type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

type Target = Readonly<{ entry: AdminReferenceEntry; action: ReferenceModerationAction }>;

const EMPTY_FILTERS: ReferencesFilters = { moderated: "", profile: "", cursor: null };

const MODERATION_FILTER_LABELS: ReadonlyArray<readonly [ReferencesModerationFilter, string]> = [
  ["", tk("Todas")],
  ["false", tk("Sin moderar")],
  ["true", tk("Moderadas")],
];

const DIALOG_COPY: Readonly<Record<ReferenceModerationAction, Readonly<{ title: string; submit: string; description: string }>>> = {
  hide: {
    title: tk("Ocultar la referencia por moderación"),
    submit: tk("Ocultar referencia"),
    description: tk("La referencia deja de mostrarse en la ficha aunque el destinatario la tenga publicada. El texto no se modifica ni se borra. Autor y destinatario reciben un aviso y ven el motivo en sus referencias."),
  },
  restore: {
    title: tk("Restaurar la referencia"),
    submit: tk("Restaurar referencia"),
    description: tk("Se levanta la moderación y vuelve a valer la visibilidad que eligió el destinatario: si la tenía oculta, sigue oculta. Autor y destinatario reciben un aviso."),
  },
};

function moderationFilterLabel(value: ReferencesModerationFilter, t: Translate): string {
  return t(MODERATION_FILTER_LABELS.find(([key]) => key === value)?.[1] ?? tk("Todas"));
}

function isModerationFilter(value: string): value is ReferencesModerationFilter {
  return value === "" || value === "true" || value === "false";
}

function visibilityLabel(reference: Pick<ReferenceRecord, "visibility">, t: Translate): string {
  return reference.visibility === "visible" ? t("Publicada por el destinatario") : t("Oculta por el destinatario");
}

function partyText(party: ReferenceRecord["author"], t: Translate): string {
  return `${party.display_name} · ${categoryLabel(party.category, t)}`;
}

/** El estado que se informa es el que devolvió la respuesta, no el solicitado. */
function outcomeMessage(target: Target, reference: ReferenceRecord, sentReason: string, t: Translate): string {
  const who = { author: reference.author.display_name, subject: reference.subject.display_name };
  if (target.action === "hide") {
    const kept = reference.moderated && reference.moderation_reason !== null && reference.moderation_reason !== sentReason;
    if (!reference.moderated) {
      return t("La referencia de «{author}» sobre «{subject}» sigue sin moderación según la respuesta del backend.", who);
    }
    const hidden = t("La referencia de «{author}» sobre «{subject}» quedó oculta por moderación.", who);
    return kept
      ? `${hidden} ${t("Ya estaba moderada: el backend no cambió nada y conserva el motivo vigente.")}`
      : hidden;
  }
  return reference.moderated
    ? t("La referencia de «{author}» sobre «{subject}» sigue moderada según la respuesta del backend.", who)
    : t("La referencia de «{author}» sobre «{subject}» quedó sin moderación. {visibility}.", {
      ...who,
      visibility: visibilityLabel(reference, t),
    });
}

/**
 * `/admin/references`: moderación de referencias. Ocultar o restaurar exige motivo,
 * queda auditado y nunca edita el texto. El backend decide; la pantalla muestra lo
 * que respondió y trata un 403 como falta de permisos, nunca como lista vacía.
 */
export function ReferencesModerationPanel() {
  const t = useT();
  const locale = useLocale();
  const [filters, setFilters] = useState<ReferencesFilters>(EMPTY_FILTERS);
  const [draftModerated, setDraftModerated] = useState<ReferencesModerationFilter>("");
  const [draftProfile, setDraftProfile] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);
  const generation = useRef(0);
  const profileInputRef = useRef<HTMLInputElement | null>(null);

  const requestPath = adminReferencesPath(filters);
  const state: ListState = loaded?.key === requestPath ? loaded.state : { status: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAdminReferencesResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (isStatus(reason, 403)) {
          setLoaded({ key: requestPath, state: { status: "forbidden", message: messageFrom(reason, browserTranslate("La consulta fue rechazada.")) } });
          return;
        }
        setLoaded({ key: requestPath, state: { status: "error", message: messageFrom(reason, browserTranslate("No pudimos listar las referencias.")) } });
      });

    return () => controller.abort();
  }, [requestPath]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const response = await getBrowserJson(requestPath, isAdminReferencesResponse);
    if (current !== generation.current) return;
    setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
  }, [requestPath]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const profile = draftProfile.trim().toUpperCase();
    if (profile !== "" && !isPublicProfileId(profile)) {
      setProfileError(t("Ingresá el identificador público del perfil: 26 caracteres en mayúsculas y números (ULID), sin espacios."));
      profileInputRef.current?.focus();
      return;
    }
    setProfileError(null);
    setDraftProfile(profile);
    setOutcome(null);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters({ moderated: draftModerated, profile, cursor: null });
  };

  const clearFilters = () => {
    setDraftModerated("");
    setDraftProfile("");
    setProfileError(null);
    setOutcome(null);
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

  const openDialog = (entry: AdminReferenceEntry, action: ReferenceModerationAction) => {
    setTarget({ entry, action });
    setReasonError(null);
    setGeneralError(null);
  };

  const closeDialog = () => {
    setTarget(null);
    setReasonError(null);
    setGeneralError(null);
  };

  const submitModeration = async (reason: string) => {
    if (!target) return;
    setMutationPending(true);
    setReasonError(null);
    setGeneralError(null);

    const body: AdminReferenceModerationInput = { action: target.action, reason };
    let moderated: ReferenceRecord;
    try {
      const response = await mutateBrowserJson(
        adminReferenceModeratePath(target.entry.id),
        "POST",
        body,
        isReferenceResponse,
      );
      moderated = response.data;
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setMutationPending(false);
      const fieldMessage = fieldErrorFrom(reason_, "reason");
      if (fieldMessage) {
        setReasonError(fieldMessage);
        return;
      }
      if (isStatus(reason_, 403)) {
        setGeneralError(t("No tenés permisos para moderar esta referencia. {detail}", {
          detail: messageFrom(reason_, t("El backend rechazó la operación.")),
        }));
        return;
      }
      if (isStatus(reason_, 404)) {
        setGeneralError(t("La referencia ya no existe. Actualizá el listado antes de insistir."));
        return;
      }
      setGeneralError(messageFrom(reason_, t("No pudimos registrar la moderación.")));
      return;
    }

    const message = outcomeMessage(target, moderated, reason, t);
    const id = target.entry.id;
    closeDialog();
    // El resultado se refleja de inmediato con lo que respondió el backend; después se
    // relee el listado para que el filtro vigente y `moderated_at` queden al día.
    setLoaded((current) => current && current.state.status === "ready"
      ? {
          key: current.key,
          state: {
            ...current.state,
            entries: current.state.entries.map((entry) => entry.id === id
              ? { ...entry, ...moderated, moderated_at: moderated.moderated ? entry.moderated_at : null }
              : entry),
          },
        }
      : current);

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

  const entries = state.status === "ready" ? state.entries : [];
  const busy = state.status === "loading" || retrying;

  return (
    <section className={styles.panel} aria-labelledby="admin-references-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-references-title">{t("Referencias")}</h1>
      <p className={styles.lead}>
        {t("Moderación de las referencias entre partes de un match aceptado. Ocultar o restaurar exige motivo, queda auditado y nunca modifica el texto. La moderación manda sobre la visibilidad que eligió el destinatario.")}
      </p>

      <form onSubmit={applyFilters} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Filtros de referencias")}</legend>
          <div className={styles.filterField}>
            <label htmlFor="admin-references-moderated">{t("Estado")}</label>
            <select
              id="admin-references-moderated"
              name="moderated"
              value={draftModerated}
              onChange={(event) => {
                const value = event.target.value;
                if (isModerationFilter(value)) setDraftModerated(value);
              }}
            >
              {MODERATION_FILTER_LABELS.map(([value, label]) => (
                <option value={value} key={value || "all"}>{t(label)}</option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <label htmlFor="admin-references-profile">{t("Perfil autor o destinatario (opcional)")}</label>
            <input
              id="admin-references-profile"
              name="profile"
              ref={profileInputRef}
              value={draftProfile}
              maxLength={26}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setDraftProfile(event.target.value);
                if (profileError) setProfileError(null);
              }}
              aria-invalid={profileError ? true : undefined}
              aria-describedby={profileError
                ? "admin-references-profile-hint admin-references-profile-error"
                : "admin-references-profile-hint"}
            />
            <span className={styles.fieldHint} id="admin-references-profile-hint">
              {t("Identificador público (ULID) del perfil.")}
            </span>
            {profileError ? (
              <span className={styles.fieldError} id="admin-references-profile-error" role="alert">{profileError}</span>
            ) : null}
          </div>
          <div className={styles.filterActions}>
            <button type="submit" disabled={busy}>{t("Aplicar filtros")}</button>
            <button type="button" data-variant="ghost" onClick={clearFilters} disabled={busy}>{t("Limpiar")}</button>
          </div>
        </fieldset>
      </form>

      <OutcomeNotice outcome={outcome} retrying={retrying} onRetry={() => void retryRefresh()} />

      {state.status === "loading" ? (
        <div aria-busy="true" role="status">
          <span>{t("Consultando referencias…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? <ListErrorNotice title={t("No pudimos listar las referencias")} message={state.message} /> : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.summaryBar}>
            <span>
              {entries.length === 0
                ? t("Ninguna referencia coincide con los filtros aplicados.")
                : t("{count} referencias en esta página.", { count: entries.length })}
            </span>
            <span>
              {filters.profile
                ? t("Estado consultado: {status} · perfil {profile}.", {
                  status: moderationFilterLabel(filters.moderated, t),
                  profile: filters.profile,
                })
                : t("Estado consultado: {status}.", { status: moderationFilterLabel(filters.moderated, t) })}
            </span>
          </p>

          {entries.length > 0 ? (
            <ul className={styles.recordList}>
              {entries.map((entry) => (
                <li className={styles.recordCard} key={entry.id} data-reference-id={entry.id}>
                  <div className={styles.recordHeading}>
                    <h3>{entry.author.display_name} → {entry.subject.display_name}</h3>
                    <span className={styles.pillGroup}>
                      <span className={styles.statePill} data-kind="reference" data-tone={entry.moderated ? "danger" : "active"}>
                        <span aria-hidden="true">{entry.moderated ? "■" : "●"}</span>
                        {t("Moderación: {state}", {
                          state: entry.moderated ? t("Oculta por moderación") : t("Sin moderación"),
                        })}
                      </span>
                      <span className={styles.statePill} data-kind="visibility" data-tone={entry.visibility === "visible" ? "active" : "muted"}>
                        <span aria-hidden="true">{entry.visibility === "visible" ? "●" : "○"}</span>
                        {t("Visibilidad: {visibility}", { visibility: visibilityLabel(entry, t) })}
                      </span>
                    </span>
                  </div>
                  <p className={styles.referenceBody}>{entry.body}</p>
                  <dl className={styles.recordFields}>
                    <div>
                      <dt>{t("Autor")}</dt>
                      <dd>{partyText(entry.author, t)}<br /><span className={styles.identifier}>{entry.author.id}</span></dd>
                    </div>
                    <div>
                      <dt>{t("Destinatario")}</dt>
                      <dd>{partyText(entry.subject, t)}<br /><span className={styles.identifier}>{entry.subject.id}</span></dd>
                    </div>
                    <div>
                      <dt>{t("Creada")}</dt>
                      <dd>{formatDateTime(entry.created_at, locale)}</dd>
                    </div>
                    <div>
                      <dt>{t("Solicitud")}</dt>
                      <dd><span className={styles.identifier}>{entry.contact_request_id}</span></dd>
                    </div>
                    {entry.moderated ? (
                      <>
                        <div>
                          <dt>{t("Motivo de moderación")}</dt>
                          <dd>{entry.moderation_reason ?? t("Sin motivo registrado")}</dd>
                        </div>
                        <div>
                          <dt>{t("Moderada")}</dt>
                          <dd>{formatDateTime(entry.moderated_at, locale)}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                  <div className={styles.recordActions}>
                    {entry.moderated ? (
                      <button type="button" onClick={() => openDialog(entry, "restore")}>{t("Restaurar")}</button>
                    ) : (
                      <button type="button" data-variant="danger" onClick={() => openDialog(entry, "hide")}>{t("Ocultar")}</button>
                    )}
                    <p className={styles.recordNote}>
                      {t("La decisión queda auditada con su motivo. El texto de la referencia nunca se edita.")}
                    </p>
                  </div>
                </li>
              ))}
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
        <StatusChangeDialog
          title={t(DIALOG_COPY[target.action].title)}
          subject={t("Referencia de {author} sobre {subject}", {
            author: target.entry.author.display_name,
            subject: target.entry.subject.display_name,
          })}
          description={t(DIALOG_COPY[target.action].description)}
          submitLabel={t(DIALOG_COPY[target.action].submit)}
          pending={mutationPending}
          reasonError={reasonError}
          conflictMessage={null}
          generalError={generalError}
          onSubmit={(reason) => void submitModeration(reason)}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  );
}
