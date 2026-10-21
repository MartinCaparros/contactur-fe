"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { browserTranslate } from "@/lib/i18n/browser";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import {
  AccountStatePill,
  CursorPagination,
  ListErrorNotice,
  type MutationOutcome,
  OutcomeNotice,
  PermissionNotice,
} from "./AdminFeedback";
import { StatusChangeDialog } from "./StatusChangeDialog";
import {
  type AdminUser,
  type AdminUserStatusInput,
  type PaginationMeta,
  type UserStatus,
  type UsersFilters,
  adminUserStatusPath,
  adminUsersPath,
  errorCodeFrom,
  fieldErrorFrom,
  formatDateTime,
  getBrowserJson,
  isAdminUserResponse,
  isAdminUsersResponse,
  isStatus,
  messageFrom,
  mutateBrowserJson,
  redirectIfUnauthorized,
  userStatusLabel,
} from "./api";
import styles from "./AdminPanels.module.css";

type LoadedState =
  | { status: "ready"; users: readonly AdminUser[]; meta: PaginationMeta }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

type ListState = LoadedState | { status: "loading" };

/** El resultado se guarda junto a la URL que lo produjo, así el estado de carga se
 * deriva de la consulta vigente en lugar de escribirse dentro del efecto. */
type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

type Target = Readonly<{ user: AdminUser; intent: UserStatus }>;

const EMPTY_FILTERS: UsersFilters = { q: "", status: "", cursor: null };

const ADMIN_PROTECTED_MESSAGE = tk(
  "El backend protege las cuentas administradoras: una cuenta con rol de administración no puede quedar suspendida desde el backoffice. El estado de la cuenta no cambió.",
);

function suspendedLabel(intent: UserStatus, t: Translate): string {
  return intent === "suspended" ? t("Suspender la cuenta") : t("Reactivar la cuenta");
}

function dialogDescription(intent: UserStatus, t: Translate): string {
  return intent === "suspended"
    ? t("La cuenta conserva sus datos y solo podrá consultar su estado, contactar soporte y cerrar sesión. No se modifica ningún grant de acceso de sus perfiles.")
    : t("La cuenta vuelve a operar con los permisos que ya tenía. Reactivar no concede habilitación a sus perfiles: eso depende del grant de cada perfil.");
}

export function UsersPanel() {
  const t = useT();
  const locale = useLocale();
  const [filters, setFilters] = useState<UsersFilters>(EMPTY_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftStatus, setDraftStatus] = useState<"" | UserStatus>("");
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MutationOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);
  const generation = useRef(0);

  const requestPath = adminUsersPath(filters);
  const state: ListState = loaded?.key === requestPath ? loaded.state : { status: "loading" };

  // Toda respuesta se compara contra la generación vigente: una respuesta tardía de
  // un filtro anterior nunca sobreescribe el listado actual.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAdminUsersResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key: requestPath, state: { status: "ready", users: response.data, meta: response.meta } });
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
          state: { status: "error", message: messageFrom(reason, browserTranslate("No pudimos listar las cuentas.")) },
        });
      });

    return () => controller.abort();
  }, [requestPath]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const response = await getBrowserJson(requestPath, isAdminUsersResponse);
    if (current !== generation.current) return;
    setLoaded({ key: requestPath, state: { status: "ready", users: response.data, meta: response.meta } });
  }, [requestPath]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOutcome(null);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters({ q: draftSearch.trim(), status: draftStatus, cursor: null });
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftStatus("");
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

  const openDialog = (user: AdminUser, intent: UserStatus) => {
    setTarget({ user, intent });
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

  const submitStatus = async (reason: string) => {
    if (!target) return;
    setMutationPending(true);
    setReasonError(null);
    setConflictMessage(null);
    setGeneralError(null);

    let updated: AdminUser;
    try {
      const response = await mutateBrowserJson<AdminUserStatusInput, { data: AdminUser }>(
        adminUserStatusPath(target.user.id),
        "PATCH",
        { status: target.intent, reason },
        isAdminUserResponse,
      );
      updated = response.data;
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setMutationPending(false);
      const fieldMessage = fieldErrorFrom(reason_, "reason");
      if (fieldMessage) {
        setReasonError(fieldMessage);
        return;
      }
      if (isStatus(reason_, 409) && errorCodeFrom(reason_) === "admin_account_protected") {
        setConflictMessage(t(ADMIN_PROTECTED_MESSAGE));
        return;
      }
      if (isStatus(reason_, 403)) {
        setGeneralError(t("No tenés permisos para cambiar el estado de esta cuenta. {detail}", {
          detail: messageFrom(reason_, t("El backend rechazó la operación.")),
        }));
        return;
      }
      setGeneralError(messageFrom(reason_, t("No pudimos cambiar el estado de la cuenta.")));
      return;
    }

    closeDialog();
    // El estado que se informa es el que devolvió la respuesta, no el solicitado.
    const message = t("La cuenta «{name}» quedó en estado {status}. El motivo se registró en la auditoría.", {
      name: updated.name,
      status: userStatusLabel(updated.status, t),
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

  const users = state.status === "ready" ? state.users : [];
  const busy = state.status === "loading" || retrying;

  return (
    <section className={styles.panel} aria-labelledby="admin-users-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-users-title">{t("Cuentas")}</h1>
      <p className={styles.lead}>
        {t("Búsqueda por nombre o correo, filtro por estado de la cuenta y suspensión o reactivación con motivo obligatorio. El motivo queda en la auditoría del backend.")}
      </p>

      <form onSubmit={applyFilters} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Filtros de cuentas")}</legend>
          <label>
            {t("Buscar por nombre o correo")}
            <input
              type="search"
              name="q"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
            />
          </label>
          <label>
            {t("Estado de la cuenta")}
            <select
              name="status"
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value as "" | UserStatus)}
            >
              <option value="">{t("Todos los estados")}</option>
              <option value="active">{t("Activa")}</option>
              <option value="suspended">{t("Suspendida")}</option>
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit" disabled={busy}>{t("Aplicar filtros")}</button>
            <button type="button" data-variant="ghost" onClick={clearFilters} disabled={busy}>
              {t("Limpiar")}
            </button>
          </div>
        </fieldset>
      </form>

      <OutcomeNotice outcome={outcome} retrying={retrying} onRetry={() => void retryRefresh()} />

      {state.status === "loading" ? (
        <div aria-busy="true" role="status">
          <span>{t("Consultando cuentas…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? (
        <ListErrorNotice title={t("No pudimos listar las cuentas")} message={state.message} />
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.summaryBar}>
            <span>
              {users.length === 0
                ? t("Ninguna cuenta coincide con los filtros aplicados.")
                : t("{count} cuentas en esta página.", { count: users.length })}
            </span>
          </p>

          {users.length > 0 ? (
            <ul className={styles.recordList}>
              {users.map((user) => {
                const isAdminAccount = user.system_role === "admin";
                return (
                  <li className={styles.recordCard} key={user.id} data-user-id={user.id}>
                    <div className={styles.recordHeading}>
                      <h3>{user.name}</h3>
                      <span className={styles.pillGroup}>
                        <AccountStatePill status={user.status} />
                      </span>
                    </div>
                    <dl className={styles.recordFields}>
                      <div>
                        <dt>{t("Correo")}</dt>
                        <dd>{user.email}</dd>
                      </div>
                      <div>
                        <dt>{t("Rol de sistema")}</dt>
                        <dd>{isAdminAccount ? t("Administración") : t("Usuario")}</dd>
                      </div>
                      <div>
                        <dt>{t("Perfiles")}</dt>
                        <dd>{user.profile_count}</dd>
                      </div>
                      <div>
                        <dt>{t("Correo verificado")}</dt>
                        <dd>{user.email_verified_at ? formatDateTime(user.email_verified_at, locale) : t("Sin verificar")}</dd>
                      </div>
                      <div>
                        <dt>{t("Alta")}</dt>
                        <dd>{formatDateTime(user.created_at, locale)}</dd>
                      </div>
                    </dl>
                    <div className={styles.recordActions}>
                      {user.status === "active" && !isAdminAccount ? (
                        <button
                          type="button"
                          data-variant="danger"
                          onClick={() => openDialog(user, "suspended")}
                        >
                          {t("Suspender cuenta")}
                        </button>
                      ) : null}
                      {user.status === "suspended" ? (
                        <button type="button" onClick={() => openDialog(user, "active")}>
                          {t("Reactivar cuenta")}
                        </button>
                      ) : null}
                      {isAdminAccount && user.status === "active" ? (
                        <p className={styles.recordNote}>
                          {t("Cuenta de administración: el backoffice no ofrece suspenderla y el backend la protege con un conflicto si se intenta.")}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <CursorPagination
            pageIndex={pageIndex}
            shown={users.length}
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
          title={suspendedLabel(target.intent, t)}
          subject={`${target.user.name} · ${target.user.email}`}
          description={dialogDescription(target.intent, t)}
          submitLabel={target.intent === "suspended" ? t("Suspender cuenta") : t("Reactivar cuenta")}
          pending={mutationPending}
          reasonError={reasonError}
          conflictMessage={conflictMessage}
          generalError={generalError}
          onSubmit={(reason) => void submitStatus(reason)}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  );
}
