"use client";

import Link from "next/link";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import {
  type AccessEvaluation,
  ApiRequestError,
  type ContactRequest,
  type ContactRequestAction,
  type MatchedContacts,
  type Profile,
  type ProfileContact,
  type SafeProfile,
  contactRequestActionPath,
  contactRequestContactPath,
  contactRequestPath,
  getBrowserJson,
  isContactRequestResponse,
  isMatchedContactsResponse,
  isPublicProfileId,
  mutateBrowserJson,
} from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { CATEGORY_LABELS } from "./directoryModel";
import { RequestReferencePanel } from "./RequestReferencePanel";
import {
  type RequestRole,
  STATUS_LABELS,
  STATUS_MARKS,
  availabilityStatusText,
  contactErrorText,
  decisionErrorText,
  formatArgentinaDateTime,
  ownAccessText,
  requestedDatesText,
  roleIn,
} from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./Requests.module.css";

/** `message: null` = sin mensaje propio del error: se muestra el texto genérico traducido al render. */
type DetailState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; request: ContactRequest }>
  | Readonly<{ status: "not-found" }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "error"; message: string | null }>;

/**
 * Resultado de una decisión. Se guarda el dato (estado devuelto o motivo del error) y
 * el texto se arma al render, así sigue al idioma activo.
 */
type Outcome =
  | Readonly<{ tone: "success"; status: ContactRequest["status"] }>
  | Readonly<{ tone: "conflict"; reason: unknown }>;

type OutcomeView = Readonly<{ tone: Outcome["tone"]; message: string }>;

/** `failure` guarda el motivo del último intento fallido; el texto se arma al render. */
type DialogState = Readonly<{ action: ContactRequestAction; pending: boolean; failure: Readonly<{ reason: unknown }> | null }>;

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

/** Mensaje del error (las ApiRequestError ya llegan traducidas); `null` usa el genérico de la vista. */
function messageFrom(reason: unknown): string | null {
  return reason instanceof Error && reason.message ? reason.message : null;
}

function outcomeText(outcome: Outcome, t: Translate, locale: Locale): string {
  if (outcome.tone === "conflict") return decisionErrorText(outcome.reason, t);
  if (outcome.status === "accepted") {
    return t("Listo: la solicitud quedó aceptada. Ya pueden ver los datos de contacto declarados. Recordá que esto no reserva el calendario ni confirma una contratación.");
  }
  return t("Listo: la solicitud quedó {status}.", { status: t(STATUS_LABELS[outcome.status]).toLocaleLowerCase(locale) });
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function namesOr(items: readonly { name: string }[], empty: string): string {
  return items.length > 0 ? items.map((item) => item.name).join(", ") : empty;
}

/** Textos fuente (`tk`); se traducen al pasarlos al diálogo. */
const DIALOG_COPY: Readonly<Record<ContactRequestAction, Readonly<{ title: string; confirm: string; description: string; tone: "default" | "danger" }>>> = {
  accept: {
    title: tk("¿Aceptar la solicitud?"),
    confirm: tk("Aceptar solicitud"),
    description: tk("Al aceptar, ambas partes van a poder ver los datos de contacto declarados en sus perfiles. Aceptar no reserva tu calendario ni confirma una contratación: los detalles se acuerdan directamente."),
    tone: "default",
  },
  reject: {
    title: tk("¿Rechazar la solicitud?"),
    confirm: tk("Rechazar solicitud"),
    description: tk("La empresa va a ver la solicitud como rechazada. No se comparte ningún dato de contacto y la decisión no se puede deshacer."),
    tone: "danger",
  },
  cancel: {
    title: tk("¿Cancelar la solicitud?"),
    confirm: tk("Cancelar solicitud"),
    description: tk("El perfil ya no va a poder responderla y no se comparte ningún dato de contacto. Para volver a enviarle una solicitud puede haber un tiempo de espera."),
    tone: "danger",
  },
};

/**
 * `/app/requests/[id]`: detalle participante. El servidor solo pasa el id de la URL;
 * la solicitud se pide desde el navegador y el contacto solo bajo demanda, así que
 * ningún dato privado viaja en el HTML/RSC. Las acciones se ofrecen según el rol y el
 * estado efectivo que devolvió Laravel, que vuelve a validar cada una.
 */
export function RequestDetailView({
  profile,
  access,
  requestId,
}: Readonly<{ profile: Profile; access: AccessEvaluation | null; requestId: string }>) {
  const t = useT();
  const locale = useLocale();
  const validId = isPublicProfileId(requestId);
  const [loaded, setLoaded] = useState<DetailState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  const state: DetailState = validId ? loaded : { status: "not-found" };

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    void getBrowserJson(contactRequestPath(profile.id, requestId), isContactRequestResponse, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setLoaded({ status: "ready", request: data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 404) {
          setLoaded({ status: "not-found" });
          return;
        }
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setLoaded({ status: "forbidden", code: reason.code, message: reason.message });
          return;
        }
        setLoaded({ status: "error", message: messageFrom(reason) });
      });
    return () => controller.abort();
  }, [profile.id, requestId, validId, reload]);

  useEffect(() => () => refreshController.current?.abort(), []);

  useEffect(() => {
    if (outcome) outcomeRef.current?.focus();
  }, [outcome]);

  /** Relee el detalle tras una mutación. Un fallo acá no deshace el éxito ya mostrado. */
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const { data } = await getBrowserJson(contactRequestPath(profile.id, requestId), isContactRequestResponse, controller.signal);
      if (controller.signal.aborted) return;
      setLoaded({ status: "ready", request: data });
      setRefreshFailed(false);
    } catch (reason) {
      if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
      setRefreshFailed(true);
    }
  }, [profile.id, requestId]);

  const decide = async (action: ContactRequestAction) => {
    if (state.status !== "ready" || dialog?.pending) return;
    setDialog({ action, pending: true, failure: null });
    try {
      const { data } = await mutateBrowserJson(
        contactRequestActionPath(profile.id, state.request.id, action),
        "POST",
        undefined,
        isContactRequestResponse,
      );
      setDialog(null);
      setRefreshFailed(false);
      setLoaded({ status: "ready", request: data });
      setOutcome({ tone: "success", status: data.status });
      void refresh();
    } catch (reason) {
      if (redirectIfUnauthorized(reason)) return;
      if (reason instanceof ApiRequestError && (reason.code === "contact_request_not_pending" || reason.status === 404)) {
        setDialog(null);
        setOutcome({ tone: "conflict", reason });
        void refresh();
        return;
      }
      setDialog({ action, pending: false, failure: { reason } });
    }
  };

  return (
    <section className={directoryStyles.panel} aria-labelledby="request-title" aria-busy={state.status === "loading"}>
      <Link className={directoryStyles.backLink} href={profileUrl("/app/requests", profile.id)}>← {t("Volver a solicitudes")}</Link>

      {state.status === "loading" ? (
        <>
          <p className={directoryStyles.eyebrow}>{t("Solicitud de contacto")}</p>
          <h1 id="request-title">{t("Cargando solicitud…")}</h1>
        </>
      ) : null}

      {state.status === "not-found" ? (
        <>
          <p className={directoryStyles.eyebrow}>{t("Solicitud de contacto")}</p>
          <h1 id="request-title">{t("Solicitud no disponible")}</h1>
          <p className={directoryStyles.lead}>{t("Esta solicitud no existe o no pertenece al perfil activo.")}</p>
        </>
      ) : null}

      {state.status === "forbidden" ? (
        <>
          <p className={directoryStyles.eyebrow}>{t("Solicitud de contacto")}</p>
          <h1 id="request-title">{t("No podés ver esta solicitud en este momento")}</h1>
          <div className={directoryStyles.blocked} role="alert">
            <p>{ownAccessText(state.code, t) ?? state.message}</p>
            <Link className={directoryStyles.primaryAction} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        </>
      ) : null}

      {state.status === "error" ? (
        <>
          <p className={directoryStyles.eyebrow}>{t("Solicitud de contacto")}</p>
          <h1 id="request-title">{t("No pudimos cargar la solicitud")}</h1>
          <div className={directoryStyles.errorBox} role="alert">
            <p>{state.message ?? t("No pudimos cargar la solicitud.")}</p>
            <button type="button" className={directoryStyles.secondaryButton} onClick={() => setReload((value) => value + 1)}>
              {t("Reintentar")}
            </button>
          </div>
        </>
      ) : null}

      {state.status === "ready" ? (
        <RequestDetails
          profile={profile}
          access={access}
          request={state.request}
          outcome={outcome ? { tone: outcome.tone, message: outcomeText(outcome, t, locale) } : null}
          outcomeRef={outcomeRef}
          refreshFailed={refreshFailed}
          onRetryRefresh={() => void refresh()}
          onAction={(action) => setDialog({ action, pending: false, failure: null })}
          onStale={() => void refresh()}
        />
      ) : null}

      {dialog && state.status === "ready" ? (
        <ConfirmDialog
          title={t(DIALOG_COPY[dialog.action].title)}
          subject={dialog.action === "cancel"
            ? t("Solicitud a {name}", { name: state.request.recipient.display_name })
            : t("Solicitud de {name}", { name: state.request.sender.display_name })}
          description={t(DIALOG_COPY[dialog.action].description)}
          confirmLabel={t(DIALOG_COPY[dialog.action].confirm)}
          tone={DIALOG_COPY[dialog.action].tone}
          pending={dialog.pending}
          error={dialog.failure ? decisionErrorText(dialog.failure.reason, t) : null}
          onConfirm={() => void decide(dialog.action)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}

function RequestDetails({
  profile,
  access,
  request,
  outcome,
  outcomeRef,
  refreshFailed,
  onRetryRefresh,
  onAction,
  onStale,
}: Readonly<{
  profile: Profile;
  access: AccessEvaluation | null;
  request: ContactRequest;
  outcome: OutcomeView | null;
  outcomeRef: RefObject<HTMLDivElement | null>;
  refreshFailed: boolean;
  onRetryRefresh: () => void;
  onAction: (action: ContactRequestAction) => void;
  onStale: () => void;
}>) {
  const t = useT();
  const role = roleIn(request, profile.id);
  const counterpart = role === "sender" ? request.recipient : request.sender;
  const name = counterpart.display_name;

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <p className={directoryStyles.eyebrow}>{role === "sender" ? t("Solicitud enviada") : t("Solicitud recibida")}</p>
          <h1 id="request-title">
            {role === "sender" ? t("Solicitud a {name}", { name }) : t("Solicitud de {name}", { name })}
          </h1>
        </div>
        <p className={styles.status} data-status={request.status}>
          <span aria-hidden="true">{STATUS_MARKS[request.status]}</span>
          {t("Estado: {status}", { status: t(STATUS_LABELS[request.status]) })}
        </p>
      </div>

      {outcome ? (
        <div className={styles.outcome} data-tone={outcome.tone} ref={outcomeRef} tabIndex={-1} role={outcome.tone === "success" ? "status" : "alert"}>
          <p>{outcome.message}</p>
        </div>
      ) : null}
      {refreshFailed ? (
        <div className={styles.outcome} data-tone="warning" role="status">
          <p>{t("No pudimos actualizar el detalle con la información más reciente. Lo que ves es lo último que respondió el servidor.")}</p>
          <button type="button" className={directoryStyles.secondaryButton} onClick={onRetryRefresh}>{t("Actualizar detalle")}</button>
        </div>
      ) : null}

      <div className={styles.detailLayout}>
        <div className={styles.detailColumn}>
          <section className={styles.section} aria-labelledby="request-service">
            <h2 id="request-service">{t("Servicio solicitado")}</h2>
            <p className={styles.serviceText}>{request.service_description}</p>
            <dl className={directoryStyles.facts}>
              <div><dt>{t("Fechas pedidas")}</dt><dd>{requestedDatesText(request.requested_from, request.requested_to, t)}</dd></div>
              <div><dt>{t("Ciudad pedida")}</dt><dd>{request.requested_city?.name ?? t("Sin ciudad indicada")}</dd></div>
              <div>
                <dt>{t("Disponibilidad")}</dt>
                <dd>{availabilityStatusText(request.availability_status, t)} {t("Es un dato informativo: no es una reserva.")}</dd>
              </div>
            </dl>
          </section>

          <Decisions request={request} role={role} access={access} onAction={onAction} />

          {request.status === "accepted" ? (
            <ContactPanel key={request.id} actorId={profile.id} request={request} onStale={onStale} />
          ) : null}

          {/* T20: solo un match aceptado admite referencias; cada parte deja una sobre la otra. */}
          {request.status === "accepted" && role !== null ? (
            <RequestReferencePanel
              key={`reference-${request.id}`}
              actor={profile}
              access={access}
              request={request}
              counterpart={counterpart}
              onStale={onStale}
            />
          ) : null}
        </div>

        <div className={styles.detailColumn}>
          <CounterpartCard actor={profile} counterpart={counterpart} />
          <History request={request} />
        </div>
      </div>
    </>
  );
}

function Decisions({
  request,
  role,
  access,
  onAction,
}: Readonly<{
  request: ContactRequest;
  role: RequestRole | null;
  access: AccessEvaluation | null;
  onAction: (action: ContactRequestAction) => void;
}>) {
  const t = useT();
  const locale = useLocale();
  if (request.status !== "pending" || role === null) {
    return (
      <section className={styles.section} aria-labelledby="request-actions">
        <h2 id="request-actions">{t("Estado de la solicitud")}</h2>
        <p>
          {request.status === "accepted"
            ? t("La solicitud fue aceptada. Aceptar habilita el contacto, pero no reserva el calendario ni confirma una contratación.")
            : t("La solicitud está {status} y ya no admite cambios. No se comparten datos de contacto.", {
                status: t(STATUS_LABELS[request.status]).toLocaleLowerCase(locale),
              })}
        </p>
      </section>
    );
  }

  const expiry = t("Vence el {date} (hora de Argentina). Después ya no puede aceptarse.", {
    date: formatArgentinaDateTime(request.expires_at, locale),
  });

  if (role === "sender") {
    return (
      <section className={styles.section} aria-labelledby="request-actions">
        <h2 id="request-actions">{t("Esperando respuesta")}</h2>
        <p>{expiry}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.dangerButton} onClick={() => onAction("cancel")}>{t("Cancelar solicitud")}</button>
        </div>
      </section>
    );
  }

  // D21: con acceso vencido se puede rechazar pero no aceptar. Lo decide Laravel;
  // la UI refleja las capacidades evaluadas y no ofrece lo que se va a rechazar.
  const canAccept = access === null || access.capabilities.can_receive_contact_requests;
  const canReject = access === null || access.capabilities.can_reject_pending_requests;

  return (
    <section className={styles.section} aria-labelledby="request-actions">
      <h2 id="request-actions">{t("Tu respuesta")}</h2>
      <p>{expiry}</p>
      <p className={styles.note}>
        {t("Aceptar habilita que ambas partes vean los datos de contacto declarados. No reserva tu calendario ni confirma una contratación.")}
      </p>
      {!canAccept ? (
        <p>
          {canReject
            ? t("Con el estado de acceso actual no podés aceptar solicitudes, pero sí rechazarlas.")
            : t("Con el estado de acceso actual no podés aceptar solicitudes.")}
        </p>
      ) : null}
      <div className={styles.actions}>
        {canAccept ? (
          <button type="button" className={styles.confirmButton} onClick={() => onAction("accept")}>{t("Aceptar")}</button>
        ) : null}
        {canReject ? (
          <button type="button" className={styles.dangerButton} onClick={() => onAction("reject")}>{t("Rechazar")}</button>
        ) : null}
      </div>
    </section>
  );
}

function CounterpartCard({ actor, counterpart }: Readonly<{ actor: Profile; counterpart: SafeProfile }>) {
  const t = useT();
  // El directorio solo muestra fichas de receptores a empresas: el receptor ve acá el
  // snapshot seguro de la empresa (D19), que nunca incluye contacto.
  const canOpenProfile = actor.category === "tourism_company" && counterpart.category !== "tourism_company";
  return (
    <section className={styles.section} aria-labelledby="request-counterpart">
      <h2 id="request-counterpart">{actor.category === "tourism_company" ? t("Perfil solicitado") : t("Empresa solicitante")}</h2>
      <div>
        <h3>{counterpart.display_name}</h3>
        <p className={styles.counterpartMeta}>
          <span>{t(CATEGORY_LABELS[counterpart.category])}</span>
          {counterpart.verified ? (
            <span className={directoryStyles.verified}><span aria-hidden="true">✓</span> {t("Verificado")}</span>
          ) : null}
        </p>
      </div>
      {counterpart.description ? <p>{counterpart.description}</p> : null}
      <dl className={directoryStyles.facts}>
        <div><dt>{t("Ciudad principal")}</dt><dd>{counterpart.primary_city?.name ?? t("Sin ciudad principal")}</dd></div>
        <div><dt>{t("Ciudades")}</dt><dd>{namesOr(counterpart.cities, t("Sin ciudades cargadas"))}</dd></div>
        <div><dt>{t("Idiomas")}</dt><dd>{namesOr(counterpart.languages, t("Sin idiomas cargados"))}</dd></div>
        <div><dt>{t("Servicios")}</dt><dd>{namesOr(counterpart.services, t("Sin servicios cargados"))}</dd></div>
      </dl>
      {canOpenProfile ? (
        <Link className={directoryStyles.secondaryAction} href={profileUrl(`/app/profiles/${counterpart.id}`, actor.id)}>
          {t("Ver ficha completa")}
        </Link>
      ) : (
        <p>{t("Es la ficha segura del perfil: no incluye datos de contacto.")}</p>
      )}
    </section>
  );
}

function History({ request }: Readonly<{ request: ContactRequest }>) {
  const t = useT();
  const locale = useLocale();
  // Rótulos como texto fuente (`tk`): también sirven de key estable de cada fila.
  const events: Array<Readonly<{ label: string; at: string }>> = [{ label: tk("Enviada"), at: request.created_at }];
  if (request.status === "accepted" && request.responded_at) events.push({ label: tk("Aceptada"), at: request.responded_at });
  if (request.status === "rejected" && request.responded_at) events.push({ label: tk("Rechazada"), at: request.responded_at });
  if (request.status === "cancelled" && request.cancelled_at) events.push({ label: tk("Cancelada"), at: request.cancelled_at });
  if (request.status === "expired") events.push({ label: tk("Venció"), at: request.expires_at });
  if (request.status === "pending") events.push({ label: tk("Vence"), at: request.expires_at });

  return (
    <section className={styles.section} aria-labelledby="request-history">
      <h2 id="request-history">{t("Historial")}</h2>
      <ol className={styles.history}>
        {events.map((event) => (
          <li key={event.label}>
            <strong>{t(event.label)}</strong>
            <time dateTime={event.at}>
              {t("{date} (hora de Argentina)", { date: formatArgentinaDateTime(event.at, locale) })}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** El error guarda el motivo; el texto se arma al render en el idioma activo. */
type ContactState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; data: MatchedContacts }>
  | Readonly<{ status: "error"; reason: unknown }>;

/**
 * R16: el contacto se pide solo con el click, nunca al montar ni en SSR. Vive en el
 * estado local de este componente: no se guarda en sessionStorage, URL ni estado
 * global, y se descarta al salir de la pantalla o al ocultarlo.
 */
function ContactPanel({
  actorId,
  request,
  onStale,
}: Readonly<{ actorId: string; request: ContactRequest; onStale: () => void }>) {
  const t = useT();
  const [state, setState] = useState<ContactState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const reveal = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "loading" });
    try {
      const { data } = await getBrowserJson(
        contactRequestContactPath(actorId, request.id),
        isMatchedContactsResponse,
        current.signal,
      );
      if (current.signal.aborted) return;
      setState({ status: "ready", data });
    } catch (reason) {
      if (current.signal.aborted || redirectIfUnauthorized(reason)) return;
      setState({ status: "error", reason });
      if (reason instanceof ApiRequestError && reason.code === "contact_request_not_accepted") onStale();
    }
  };

  return (
    <section className={styles.section} aria-labelledby="request-contact">
      <h2 id="request-contact">{t("Datos de contacto")}</h2>
      {state.status !== "ready" ? (
        <p>
          {t("Se muestran solo cuando los pedís y no se guardan: al salir de esta pantalla se descartan. Tener el contacto no reserva el calendario ni confirma una contratación.")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className={directoryStyles.errorBox} role="alert"><p>{contactErrorText(state.reason, t)}</p></div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className={styles.contactGrid}>
            <ContactCard title={state.data.counterpart.display_name} contact={state.data.counterpart} />
            <ContactCard title={t("Tus datos declarados")} contact={state.data.actor} />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.ghostButton} onClick={() => setState({ status: "idle" })}>
              {t("Ocultar datos de contacto")}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => void reveal()}
            disabled={state.status === "loading"}
          >
            {state.status === "loading" ? t("Cargando…") : state.status === "error" ? t("Reintentar") : t("Ver datos de contacto")}
          </button>
        </div>
      )}
    </section>
  );
}

function ContactCard({ title, contact }: Readonly<{ title: string; contact: ProfileContact }>) {
  const t = useT();
  const phoneHref = contact.phone ? contact.phone.replace(/[^\d+]/g, "") : "";
  return (
    <article className={styles.contactCard} aria-label={title}>
      <h3>{title}</h3>
      <dl className={directoryStyles.facts}>
        <div>
          <dt>{t("Email")}</dt>
          <dd>{contact.contact_email ? <a href={`mailto:${contact.contact_email}`}>{contact.contact_email}</a> : t("No declarado")}</dd>
        </div>
        <div>
          <dt>{t("Teléfono")}</dt>
          <dd>{contact.phone && phoneHref ? <a href={`tel:${phoneHref}`}>{contact.phone}</a> : contact.phone ?? t("No declarado")}</dd>
        </div>
      </dl>
    </article>
  );
}
