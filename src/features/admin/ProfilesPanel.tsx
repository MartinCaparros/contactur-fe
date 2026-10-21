"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n/config";
import { browserTranslate } from "@/lib/i18n/browser";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import { AccessGrantDialog, type GrantFieldErrors } from "./AccessGrantDialog";
import {
  AccessStatePill,
  CursorPagination,
  ListErrorNotice,
  type MutationOutcome,
  OutcomeNotice,
  PermissionNotice,
  ProfileStatePill,
} from "./AdminFeedback";
import { StatusChangeDialog } from "./StatusChangeDialog";
import {
  ACCESS_STATES,
  ADMIN_CATEGORIES,
  type AccessEffectiveState,
  type AdminAccessGrantInput,
  type AdminProfileEntry,
  type AdminProfileStatusInput,
  type PaginationMeta,
  PROFILE_STATUSES,
  type ProfileCategory,
  type ProfileStatus,
  type ProfileStatusIntent,
  type ProfilesFilters,
  accessGrantStatusLabel,
  accessStateLabel,
  adminProfileAccessPath,
  adminProfileStatusPath,
  adminProfilesPath,
  categoryLabel,
  errorCodeFrom,
  fieldErrorFrom,
  formatBusinessDateTime,
  formatDateTime,
  getBrowserJson,
  isAccessResponse,
  isAdminProfileResponse,
  isAdminProfilesResponse,
  isStatus,
  messageFrom,
  mutateBrowserJson,
  profileStatusLabel,
  redirectIfUnauthorized,
} from "./api";
import styles from "./AdminPanels.module.css";

type LoadedState =
  | { status: "ready"; entries: readonly AdminProfileEntry[]; meta: PaginationMeta }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

type ListState = LoadedState | { status: "loading" };

/** El resultado se guarda junto a la URL que lo produjo, así el estado de carga se
 * deriva de la consulta vigente en lugar de escribirse dentro del efecto. */
type LoadedResult = Readonly<{ key: string; state: LoadedState }>;

type Target = Readonly<{ entry: AdminProfileEntry; intent: ProfileStatusIntent }>;

const EMPTY_FILTERS: ProfilesFilters = { q: "", category: "", status: "", accessState: "", cursor: null };

const SUSPEND_DESCRIPTION = tk(
  "El perfil deja de operar y la suspensión prevalece sobre cualquier habilitación. No modifica el grant de acceso: el grant queda como está y su versión no cambia.",
);

const RESTORE_DESCRIPTION = tk(
  "Se pide sacar al perfil de la suspensión. Si nunca completó el alta, el backend lo devuelve a Borrador en lugar de publicarlo. Restaurar tampoco concede acceso: el grant no se toca.",
);

/**
 * Concurrencia optimista del grant: `expected_version` tiene que coincidir con la
 * versión vigente. Si no coincide se explica que alguien más lo modificó y se ofrece
 * releerlo; nunca se reenvía el mismo formulario con la versión nueva a ciegas, porque
 * los valores que se estaban editando pueden haber quedado obsoletos.
 */
const STALE_GRANT_MESSAGE = tk(
  "Otra persona modificó esta habilitación mientras la editabas, así que la versión que enviaste ya no es la vigente y el backend no aplicó ningún cambio. Releé la habilitación para ver los valores actuales y volvé a confirmar; no la reenviamos con la versión nueva por tu cuenta.",
);

const NO_GRANT_FIELD_ERRORS: GrantFieldErrors = {};

/**
 * El mensaje se construye con lo que devolvió la respuesta, nunca con la intención
 * enviada: pedir `published` sobre un perfil que jamás completó el alta devuelve
 * `draft`, y esa diferencia se explica en lugar de ocultarse.
 */
function outcomeMessage(entry: AdminProfileEntry, intent: ProfileStatusIntent, t: Translate): string {
  const name = entry.profile.display_name;
  const status = profileStatusLabel(entry.profile.status, t);
  const access = t("El grant de acceso no se modificó: sigue en {state}.", {
    state: accessStateLabel(entry.access.effective_state, t),
  });

  if (intent === "suspended") {
    return t("El perfil «{name}» quedó en estado {status}. {access}", { name, status, access });
  }
  if (entry.profile.status === "published") {
    return t("El perfil «{name}» salió de la suspensión y quedó en estado {status}. Restaurar no concede acceso. {access}", {
      name,
      status,
      access,
    });
  }
  return t("Pediste restaurar y publicar el perfil «{name}», pero el backend lo devolvió en estado {status} porque nunca completó el alta, así que no se publicó. Mostramos el estado real de la respuesta. {access}", {
    name,
    status,
    access,
  });
}

/** Resumen de la habilitación ya aplicada; se arma con lo que devolvió el backend. */
function grantOutcomeMessage(
  entry: AdminProfileEntry,
  evaluation: AdminProfileEntry["access"],
  kept: readonly number[] | undefined,
  t: Translate,
  locale: Locale,
): string {
  const grant = evaluation.grant;
  const params = {
    name: entry.profile.display_name,
    grant: grant === null ? t("sin habilitación") : accessGrantStatusLabel(grant.status, t),
    version: grant?.version ?? 0,
    state: accessStateLabel(evaluation.effective_state, t),
    status: profileStatusLabel(entry.profile.status, t),
  };
  const summary = grant?.expires_at
    ? t("La habilitación de «{name}» quedó en {grant}, versión {version}, con vigencia hasta {date}. Estado de acceso evaluado: {state}. El estado del perfil no cambió: sigue en {status}.", {
      ...params,
      date: formatBusinessDateTime(grant.expires_at, locale),
    })
    : t("La habilitación de «{name}» quedó en {grant}, versión {version}, con vigencia sin vencimiento. Estado de acceso evaluado: {state}. El estado del perfil no cambió: sigue en {status}.", params);
  if (kept === undefined) return summary;
  return `${summary} ${t("Se conservaron {kept} de {total} ciudades y las excluidas quedaron sin disponibilidad futura.", {
    kept: kept.length,
    total: entry.profile.cities.length,
  })}`;
}

export function ProfilesPanel() {
  const t = useT();
  const locale = useLocale();
  const [filters, setFilters] = useState<ProfilesFilters>(EMPTY_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftCategory, setDraftCategory] = useState<"" | ProfileCategory>("");
  const [draftStatus, setDraftStatus] = useState<"" | ProfileStatus>("");
  const [draftAccessState, setDraftAccessState] = useState<"" | AccessEffectiveState>("");
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
  const [grantTarget, setGrantTarget] = useState<AdminProfileEntry | null>(null);
  const [grantPending, setGrantPending] = useState(false);
  const [grantFieldErrors, setGrantFieldErrors] = useState<GrantFieldErrors>(NO_GRANT_FIELD_ERRORS);
  const [grantStale, setGrantStale] = useState<string | null>(null);
  const [grantNotice, setGrantNotice] = useState<string | null>(null);
  const [grantGeneralError, setGrantGeneralError] = useState<string | null>(null);
  const [grantReloading, setGrantReloading] = useState(false);
  /** Cambia al releer el grant para remontar el formulario con los valores frescos. */
  const [grantReloadKey, setGrantReloadKey] = useState(0);
  const generation = useRef(0);

  const requestPath = adminProfilesPath(filters);
  const state: ListState = loaded?.key === requestPath ? loaded.state : { status: "loading" };

  // Toda respuesta se compara contra la generación vigente: una respuesta tardía de
  // un filtro anterior nunca sobreescribe el listado actual.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;

    void getBrowserJson(requestPath, isAdminProfilesResponse, controller.signal)
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
          state: { status: "error", message: messageFrom(reason, browserTranslate("No pudimos listar los perfiles.")) },
        });
      });

    return () => controller.abort();
  }, [requestPath]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const response = await getBrowserJson(requestPath, isAdminProfilesResponse);
    if (current !== generation.current) return;
    setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
  }, [requestPath]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOutcome(null);
    setCursorHistory([null]);
    setPageIndex(0);
    setFilters({
      q: draftSearch.trim(),
      category: draftCategory,
      status: draftStatus,
      accessState: draftAccessState,
      cursor: null,
    });
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftCategory("");
    setDraftStatus("");
    setDraftAccessState("");
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

  const openDialog = (entry: AdminProfileEntry, intent: ProfileStatusIntent) => {
    setTarget({ entry, intent });
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

    let updated: AdminProfileEntry;
    try {
      const response = await mutateBrowserJson<AdminProfileStatusInput, { data: AdminProfileEntry }>(
        adminProfileStatusPath(target.entry.profile.id),
        "PATCH",
        { status: target.intent, reason },
        isAdminProfileResponse,
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
      if (isStatus(reason_, 409)) {
        setConflictMessage(t("El backend rechazó la transición por el estado del recurso ({code}). {detail}", {
          code: errorCodeFrom(reason_) ?? t("conflicto"),
          detail: messageFrom(reason_, t("El estado del perfil no cambió.")),
        }));
        return;
      }
      if (isStatus(reason_, 403)) {
        setGeneralError(t("No tenés permisos para cambiar el estado de este perfil. {detail}", {
          detail: messageFrom(reason_, t("El backend rechazó la operación.")),
        }));
        return;
      }
      setGeneralError(messageFrom(reason_, t("No pudimos cambiar el estado del perfil.")));
      return;
    }

    closeDialog();
    const message = outcomeMessage(updated, target.intent, t);

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

  const openGrantDialog = (entry: AdminProfileEntry) => {
    setGrantTarget(entry);
    setGrantFieldErrors(NO_GRANT_FIELD_ERRORS);
    setGrantStale(null);
    setGrantNotice(null);
    setGrantGeneralError(null);
  };

  const closeGrantDialog = () => {
    setGrantTarget(null);
    setGrantFieldErrors(NO_GRANT_FIELD_ERRORS);
    setGrantStale(null);
    setGrantNotice(null);
    setGrantGeneralError(null);
  };

  /**
   * Relee el listado y vuelve a apuntar el diálogo a la versión vigente del grant. No
   * reenvía la mutación: el formulario se remonta con los valores frescos para que la
   * confirmación sea explícita.
   */
  const reloadGrant = async () => {
    if (!grantTarget) return;
    const profileId = grantTarget.profile.id;
    setGrantReloading(true);
    setGrantGeneralError(null);
    try {
      const current = ++generation.current;
      const response = await getBrowserJson(requestPath, isAdminProfilesResponse);
      if (current === generation.current) {
        setLoaded({ key: requestPath, state: { status: "ready", entries: response.data, meta: response.meta } });
      }
      const fresh = response.data.find((entry) => entry.profile.id === profileId);
      if (!fresh) {
        setGrantGeneralError(
          t("El perfil ya no aparece en esta consulta, así que no pudimos releer su habilitación. Cerrá el formulario y volvé a buscarlo."),
        );
        return;
      }
      setGrantTarget(fresh);
      setGrantStale(null);
      setGrantFieldErrors(NO_GRANT_FIELD_ERRORS);
      setGrantReloadKey((value) => value + 1);
      setGrantNotice(
        t("Releímos la habilitación: la versión vigente ahora es {version} y el formulario muestra esos valores. Revisalos y confirmá de nuevo.", {
          version: fresh.access.grant?.version ?? 0,
        }),
      );
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setGrantGeneralError(messageFrom(reason_, t("No pudimos releer la habilitación.")));
    } finally {
      setGrantReloading(false);
    }
  };

  const submitGrant = async (payload: AdminAccessGrantInput) => {
    if (!grantTarget) return;
    const entry = grantTarget;
    setGrantPending(true);
    setGrantFieldErrors(NO_GRANT_FIELD_ERRORS);
    setGrantStale(null);
    setGrantNotice(null);
    setGrantGeneralError(null);

    let evaluation;
    try {
      const response = await mutateBrowserJson(
        adminProfileAccessPath(entry.profile.id),
        "PUT",
        payload,
        isAccessResponse,
      );
      evaluation = response.data;
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setGrantPending(false);
      if (isStatus(reason_, 409) && errorCodeFrom(reason_) === "stale_access_grant") {
        setGrantStale(`${t(STALE_GRANT_MESSAGE)} ${t("El backend respondió: {detail}", {
          detail: messageFrom(reason_, t("sin detalle.")),
        })}`);
        return;
      }
      if (isStatus(reason_, 422)) {
        setGrantFieldErrors({
          status: fieldErrorFrom(reason_, "status"),
          starts_at: fieldErrorFrom(reason_, "starts_at"),
          expires_at: fieldErrorFrom(reason_, "expires_at"),
          city_limit: fieldErrorFrom(reason_, "city_limit"),
          monthly_contact_limit: fieldErrorFrom(reason_, "monthly_contact_limit"),
          gallery_enabled: fieldErrorFrom(reason_, "gallery_enabled"),
          expected_version: fieldErrorFrom(reason_, "expected_version"),
          // El backend nombra el campo `cities_to_keep`, pero la validación de la
          // relación puede llegar como `city_ids`: las dos apuntan a la misma selección.
          cities_to_keep: fieldErrorFrom(reason_, "cities_to_keep") ?? fieldErrorFrom(reason_, "city_ids"),
          reason: fieldErrorFrom(reason_, "reason"),
        });
        setGrantGeneralError(messageFrom(reason_, t("Revisá los campos marcados.")));
        return;
      }
      if (isStatus(reason_, 403)) {
        setGrantGeneralError(t("No tenés permisos para editar la habilitación de este perfil. {detail}", {
          detail: messageFrom(reason_, t("El backend rechazó la operación.")),
        }));
        return;
      }
      setGrantGeneralError(messageFrom(reason_, t("No pudimos guardar la habilitación.")));
      return;
    }

    closeGrantDialog();
    const message = grantOutcomeMessage(entry, evaluation, payload.cities_to_keep, t, locale);

    try {
      await refresh();
      setOutcome({ message, refreshed: true });
    } catch (reason_: unknown) {
      if (redirectIfUnauthorized(reason_)) return;
      setOutcome({ message, refreshed: false });
    } finally {
      setGrantPending(false);
    }
  };

  const entries = state.status === "ready" ? state.entries : [];
  const busy = state.status === "loading" || retrying;

  return (
    <section className={styles.panel} aria-labelledby="admin-profiles-title">
      <p className={styles.eyebrow}>{t("Backoffice")}</p>
      <h1 id="admin-profiles-title">{t("Perfiles")}</h1>
      <p className={styles.lead}>
        {t("El estado del perfil y el estado de acceso son dos cosas distintas y se filtran por separado: el primero describe la ficha, el segundo la habilitación vigente. Suspender un perfil no toca su grant y restaurarlo no concede acceso. La habilitación manual se edita con su propia acción, que sí reemplaza el grant y sube su versión sin mover el estado del perfil.")}
      </p>

      <form onSubmit={applyFilters} noValidate>
        <fieldset className={styles.filters}>
          <legend>{t("Filtros de perfiles")}</legend>
          <label>
            {t("Buscar por nombre")}
            <input
              type="search"
              name="q"
              value={draftSearch}
              maxLength={100}
              onChange={(event) => setDraftSearch(event.target.value)}
            />
          </label>
          <label>
            {t("Categoría")}
            <select
              name="category"
              value={draftCategory}
              onChange={(event) => setDraftCategory(event.target.value as "" | ProfileCategory)}
            >
              <option value="">{t("Todas las categorías")}</option>
              {ADMIN_CATEGORIES.map((category) => (
                <option value={category} key={category}>{categoryLabel(category, t)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Estado del perfil")}
            <select
              name="status"
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value as "" | ProfileStatus)}
            >
              <option value="">{t("Todos los estados de perfil")}</option>
              {PROFILE_STATUSES.map((status) => (
                <option value={status} key={status}>{profileStatusLabel(status, t)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Estado de acceso")}
            <select
              name="access_state"
              value={draftAccessState}
              onChange={(event) => setDraftAccessState(event.target.value as "" | AccessEffectiveState)}
            >
              <option value="">{t("Todos los estados de acceso")}</option>
              {ACCESS_STATES.map((accessState) => (
                <option value={accessState} key={accessState}>{accessStateLabel(accessState, t)}</option>
              ))}
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
          <span>{t("Consultando perfiles…")}</span>
          <span className={styles.skeleton} />
        </div>
      ) : null}

      {state.status === "forbidden" ? <PermissionNotice message={state.message} /> : null}
      {state.status === "error" ? (
        <ListErrorNotice title={t("No pudimos listar los perfiles")} message={state.message} />
      ) : null}

      {state.status === "ready" ? (
        <>
          <p className={styles.summaryBar}>
            <span>
              {entries.length === 0
                ? t("Ningún perfil coincide con los filtros aplicados.")
                : t("{count} perfiles en esta página.", { count: entries.length })}
            </span>
          </p>

          {entries.length > 0 ? (
            <ul className={styles.recordList}>
              {entries.map((entry) => (
                <li className={styles.recordCard} key={entry.profile.id} data-profile-id={entry.profile.id}>
                  <div className={styles.recordHeading}>
                    <h3>{entry.profile.display_name}</h3>
                    <span className={styles.pillGroup}>
                      <ProfileStatePill status={entry.profile.status} />
                      <AccessStatePill state={entry.access.effective_state} />
                    </span>
                  </div>
                  <dl className={styles.recordFields}>
                    <div>
                      <dt>{t("Categoría")}</dt>
                      <dd>{categoryLabel(entry.profile.category, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("Titular")}</dt>
                      <dd>{entry.owner.name} · {entry.owner.email}</dd>
                    </div>
                    <div>
                      <dt>{t("Estado de la cuenta titular")}</dt>
                      <dd>{entry.owner.status === "suspended" ? t("Suspendida") : t("Activa")}</dd>
                    </div>
                    <div>
                      <dt>{t("Alta completada")}</dt>
                      <dd>
                        {entry.profile.completed_at
                          ? formatDateTime(entry.profile.completed_at, locale)
                          : t("Sin completar · paso {step} de 4", { step: entry.profile.onboarding_step })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Ciudad principal")}</dt>
                      <dd>{entry.profile.primary_city?.name ?? t("Sin definir")}</dd>
                    </div>
                    <div>
                      <dt>{t("Verificación documental")}</dt>
                      <dd>{entry.profile.verified ? t("Verificado") : t("Sin verificar")}</dd>
                    </div>
                    <div>
                      <dt>{t("Habilitación manual")}</dt>
                      <dd>
                        {entry.access.grant === null
                          ? t("Sin habilitación registrada (versión 0)")
                          : entry.access.grant.expires_at === null
                            ? t("{status} · versión {version} · sin vencimiento", {
                              status: accessGrantStatusLabel(entry.access.grant.status, t),
                              version: entry.access.grant.version,
                            })
                            : t("{status} · versión {version} · hasta {date}", {
                              status: accessGrantStatusLabel(entry.access.grant.status, t),
                              version: entry.access.grant.version,
                              date: formatBusinessDateTime(entry.access.grant.expires_at, locale),
                            })}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Capacidades habilitadas")}</dt>
                      <dd>
                        {entry.access.grant === null
                          ? t("Sin capacidades definidas")
                          : t("Ciudades: {cities} · Solicitudes por mes: {contacts} · Galería: {gallery}", {
                            cities: entry.access.grant.city_limit ?? t("sin límite"),
                            contacts: entry.access.grant.monthly_contact_limit ?? t("sin límite"),
                            gallery: entry.access.grant.gallery_enabled ? t("habilitada") : t("no habilitada"),
                          })}
                      </dd>
                    </div>
                  </dl>
                  <div className={styles.recordActions}>
                    {entry.profile.status === "suspended" ? (
                      <button type="button" onClick={() => openDialog(entry, "published")}>
                        {t("Restaurar perfil")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-variant="danger"
                        onClick={() => openDialog(entry, "suspended")}
                      >
                        {t("Suspender perfil")}
                      </button>
                    )}
                    <button type="button" data-variant="ghost" onClick={() => openGrantDialog(entry)}>
                      {t("Editar habilitación")}
                    </button>
                    <p className={styles.recordNote}>
                      {t("El cambio de estado del perfil no altera el grant de acceso ni su versión. Editar la habilitación es la otra acción: esa sí reemplaza el grant y sube su versión, y no cambia el estado del perfil. Son dos ejes separados.")}
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
          title={target.intent === "suspended" ? t("Suspender el perfil") : t("Restaurar el perfil")}
          subject={t("{profile} · {category} · titular {owner}", {
            profile: target.entry.profile.display_name,
            category: categoryLabel(target.entry.profile.category, t),
            owner: target.entry.owner.name,
          })}
          description={target.intent === "suspended" ? t(SUSPEND_DESCRIPTION) : t(RESTORE_DESCRIPTION)}
          submitLabel={target.intent === "suspended" ? t("Suspender perfil") : t("Restaurar perfil")}
          pending={mutationPending}
          reasonError={reasonError}
          conflictMessage={conflictMessage}
          generalError={generalError}
          onSubmit={(reason) => void submitStatus(reason)}
          onClose={closeDialog}
        />
      ) : null}

      {grantTarget ? (
        <AccessGrantDialog
          key={`${grantTarget.profile.id}-${grantReloadKey}`}
          entry={grantTarget}
          pending={grantPending}
          fieldErrors={grantFieldErrors}
          staleMessage={grantStale}
          notice={grantNotice}
          reloading={grantReloading}
          generalError={grantGeneralError}
          onReload={() => void reloadGrant()}
          onSubmit={(payload) => void submitGrant(payload)}
          onClose={closeGrantDialog}
        />
      ) : null}
    </section>
  );
}
