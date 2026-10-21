"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";

import {
  ApiRequestError,
  CONTACT_REQUEST_STATUSES,
  type ContactRequest,
  type ContactRequestDirection,
  type ContactRequestStatus,
  type Profile,
  contactRequestsPath,
  getBrowserJson,
  isContactRequestStatus,
  isContactRequestsResponse,
} from "./api";
import { CATEGORY_LABELS } from "./directoryModel";
import {
  DIRECTION_LABELS,
  STATUS_FILTER_LABELS,
  STATUS_LABELS,
  STATUS_MARKS,
  directionsFor,
  formatArgentinaDateTime,
  listQuery,
  ownAccessText,
  requestedDatesText,
  statusFromSearch,
  summarize,
} from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./Requests.module.css";

/** `message: null` = sin mensaje propio del error: se muestra el texto genérico traducido al render. */
type ListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; items: readonly ContactRequest[]; nextCursor: string | null }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "error"; message: string | null }>;

type MoreState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string | null }>;

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

/** Mensaje del error (las ApiRequestError ya llegan traducidas); `null` usa el genérico de la vista. */
function messageFrom(reason: unknown): string | null {
  return reason instanceof Error && reason.message ? reason.message : null;
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function initialStatus(): ContactRequestStatus | "" {
  return typeof window === "undefined" ? "" : statusFromSearch(window.location.search);
}

/** El filtro de estado vive en la URL (recargable); el cursor nunca, igual que en el buscador. */
function writeStatusToUrl(status: ContactRequestStatus | ""): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("cursor");
  if (status) url.searchParams.set("status", status);
  else url.searchParams.delete("status");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * `/app/requests`: bandeja del perfil activo. La empresa turística ve sus enviadas;
 * un receptor, sus recibidas (R19). El `status` de cada fila es el estado efectivo
 * que calcula Laravel, incluida la expiración por reloj.
 */
export function RequestsView({ profile }: Readonly<{ profile: Profile }>) {
  const t = useT();
  const locale = useLocale();
  const directions = directionsFor(profile.category);
  const [direction, setDirection] = useState<ContactRequestDirection>(directions[0] ?? "received");
  const [status, setStatus] = useState<ContactRequestStatus | "">(initialStatus);
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Readonly<{ key: string; state: ListState }> | null>(null);
  const [more, setMore] = useState<MoreState>({ status: "idle" });
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);

  const query = listQuery(direction, status);
  const requestKey = `${query}#${run}`;
  const state: ListState = loaded?.key === requestKey ? loaded.state : { status: "loading" };

  useEffect(() => {
    writeStatusToUrl(status);
  }, [status]);

  // Primera página con generación propia: una respuesta tardía de otro filtro (o un
  // "Cargar más" en vuelo) nunca pisa la bandeja vigente.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    moreController.current?.abort();
    const key = requestKey;

    void getBrowserJson(contactRequestsPath(profile.id, query), isContactRequestsResponse, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setLoaded({ key, state: { status: "ready", items: response.data, nextCursor: response.meta.next_cursor } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        if (redirectIfUnauthorized(reason)) return;
        if (reason instanceof ApiRequestError && reason.status === 403) {
          setLoaded({ key, state: { status: "forbidden", code: reason.code, message: reason.message } });
          return;
        }
        setLoaded({ key, state: { status: "error", message: messageFrom(reason) } });
      });

    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [profile.id, query, requestKey]);

  const loadMore = async () => {
    if (state.status !== "ready" || state.nextCursor === null || more.status === "loading") return;
    const current = generation.current;
    const key = requestKey;
    const previous = state.items;
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ status: "loading" });
    try {
      const response = await getBrowserJson(
        contactRequestsPath(profile.id, listQuery(direction, status, state.nextCursor)),
        isContactRequestsResponse,
        controller.signal,
      );
      if (controller.signal.aborted || current !== generation.current) return;
      const known = new Set(previous.map((item) => item.id));
      const items = [...previous, ...response.data.filter((item) => !known.has(item.id))];
      setLoaded({ key, state: { status: "ready", items, nextCursor: response.meta.next_cursor } });
      setMore({ status: "idle" });
    } catch (reason) {
      if (controller.signal.aborted || current !== generation.current) return;
      if (redirectIfUnauthorized(reason)) return;
      setMore({ status: "error", message: messageFrom(reason) });
    }
  };

  const changeStatus = (value: string) => {
    setMore({ status: "idle" });
    setStatus(isContactRequestStatus(value) ? value : "");
  };

  const statusLabel = status ? t(STATUS_LABELS[status]).toLocaleLowerCase(locale) : "";

  return (
    <section className={directoryStyles.panel} aria-labelledby="requests-title">
      <p className={directoryStyles.eyebrow}>{t("Solicitudes de contacto")}</p>
      <h1 id="requests-title">{t("Solicitudes")}</h1>
      <p className={directoryStyles.lead}>
        {profile.category === "tourism_company"
          ? t("Seguimiento de las solicitudes que enviaste. Los datos de contacto se comparten solo cuando el perfil acepta.")
          : t("Solicitudes que te enviaron empresas turísticas. Aceptar habilita el contacto, pero no reserva tu calendario ni confirma una contratación.")}
      </p>

      <div className={styles.tabs} role="tablist" aria-label={t("Bandejas de solicitudes")}>
        {directions.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`requests-tab-${item}`}
            className={styles.tab}
            aria-selected={item === direction}
            aria-controls="requests-panel"
            onClick={() => {
              setMore({ status: "idle" });
              setDirection(item);
            }}
          >
            {t(DIRECTION_LABELS[item])}
          </button>
        ))}
      </div>

      <div
        id="requests-panel"
        className={styles.tabPanel}
        role="tabpanel"
        aria-labelledby={`requests-tab-${direction}`}
        aria-busy={state.status === "loading"}
      >
        <h2 className={directoryStyles.srOnly}>
          {direction === "sent" ? t("Solicitudes enviadas") : t("Solicitudes recibidas")}
        </h2>
        <div className={styles.toolbar}>
          <div className={directoryStyles.field}>
            <label htmlFor="requests-status">{t("Estado")}</label>
            <select id="requests-status" name="status" value={status} onChange={(event) => changeStatus(event.target.value)}>
              <option value="">{t("Todos los estados")}</option>
              {CONTACT_REQUEST_STATUSES.map((item) => (
                <option key={item} value={item}>{t(STATUS_FILTER_LABELS[item])}</option>
              ))}
            </select>
          </div>
        </div>

        {state.status === "loading" ? <p className={directoryStyles.muted} role="status">{t("Cargando solicitudes…")}</p> : null}

        {state.status === "forbidden" ? (
          <div className={directoryStyles.blocked} role="alert">
            <h2>{t("No podés ver las solicitudes en este momento")}</h2>
            <p>{ownAccessText(state.code, t) ?? state.message}</p>
            <Link className={directoryStyles.primaryAction} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={directoryStyles.errorBox} role="alert">
            <h2>{t("No pudimos cargar las solicitudes")}</h2>
            <p>{state.message ?? t("No pudimos cargar las solicitudes.")}</p>
            <button type="button" className={directoryStyles.secondaryButton} onClick={() => setRun((value) => value + 1)}>
              {t("Reintentar")}
            </button>
          </div>
        ) : null}

        {state.status === "ready" && state.items.length === 0 ? (
          <div className={directoryStyles.empty} role="status">
            <h2>
              {direction === "sent"
                ? status
                  ? t("No hay solicitudes enviadas con estado “{status}”", { status: statusLabel })
                  : t("Todavía no hay solicitudes enviadas")
                : status
                  ? t("No hay solicitudes recibidas con estado “{status}”", { status: statusLabel })
                  : t("Todavía no hay solicitudes recibidas")}
            </h2>
            {profile.category === "tourism_company" ? (
              <>
                <p>{t("Buscá un perfil en el directorio y enviale una solicitud desde su ficha.")}</p>
                <Link className={directoryStyles.secondaryAction} href={profileUrl("/app/search", profile.id)}>{t("Buscar profesionales")}</Link>
              </>
            ) : (
              <p>{t("Cuando una empresa turística te envíe una solicitud, aparece acá.")}</p>
            )}
          </div>
        ) : null}

        {state.status === "ready" && state.items.length > 0 ? (
          <>
            <p className={directoryStyles.muted} aria-live="polite">
              {state.items.length === 1
                ? state.nextCursor
                  ? t("{count} solicitud cargada · hay más", { count: 1 })
                  : t("{count} solicitud cargada", { count: 1 })
                : state.nextCursor
                  ? t("{count} solicitudes cargadas · hay más", { count: state.items.length })
                  : t("{count} solicitudes cargadas", { count: state.items.length })}
            </p>
            <ul className={styles.requestList}>
              {state.items.map((item) => (
                <RequestRow key={item.id} request={item} actorId={profile.id} direction={direction} />
              ))}
            </ul>
            {state.nextCursor ? (
              <div className={directoryStyles.moreRow}>
                <button
                  type="button"
                  className={directoryStyles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={more.status === "loading"}
                >
                  {more.status === "loading" ? t("Cargando…") : t("Cargar más")}
                </button>
                {more.status === "error" ? (
                  <p className={directoryStyles.fieldError} role="alert">{more.message ?? t("No pudimos cargar más solicitudes.")}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function RequestRow({
  request,
  actorId,
  direction,
}: Readonly<{ request: ContactRequest; actorId: string; direction: ContactRequestDirection }>) {
  const t = useT();
  const locale = useLocale();
  const counterpart = direction === "sent" ? request.recipient : request.sender;
  const titleId = `request-${request.id}`;
  const name = counterpart.display_name;
  return (
    <li>
      <article className={styles.requestCard} aria-labelledby={titleId} data-request-id={request.id}>
        <div className={styles.requestHeader}>
          <div>
            <h3 id={titleId}>{name}</h3>
            <p className={styles.counterpartMeta}>
              <span>{t(CATEGORY_LABELS[counterpart.category])}</span>
              {counterpart.verified ? (
                <span className={directoryStyles.verified}><span aria-hidden="true">✓</span> {t("Verificado")}</span>
              ) : null}
            </p>
          </div>
          <p className={styles.status} data-status={request.status}>
            <span aria-hidden="true">{STATUS_MARKS[request.status]}</span>
            {t("Estado: {status}", { status: t(STATUS_LABELS[request.status]) })}
          </p>
        </div>
        <p className={styles.service}>{summarize(request.service_description)}</p>
        <dl className={directoryStyles.cardFacts}>
          <div><dt>{t("Fechas pedidas")}</dt><dd>{requestedDatesText(request.requested_from, request.requested_to, t)}</dd></div>
          {request.requested_city ? <div><dt>{t("Ciudad")}</dt><dd>{request.requested_city.name}</dd></div> : null}
          <div>
            <dt>{direction === "sent" ? t("Enviada") : t("Recibida")}</dt>
            <dd>{formatArgentinaDateTime(request.created_at, locale)}</dd>
          </div>
        </dl>
        <div className={styles.rowFooter}>
          {request.status === "pending" ? (
            <p className={styles.expiry}>
              {t("Vence el {date} (hora de Argentina)", { date: formatArgentinaDateTime(request.expires_at, locale) })}
            </p>
          ) : <span />}
          <Link
            className={directoryStyles.secondaryAction}
            href={profileUrl(`/app/requests/${request.id}`, actorId)}
            aria-label={direction === "sent" ? t("Ver solicitud a {name}", { name }) : t("Ver solicitud de {name}", { name })}
          >
            {t("Ver detalle")}
          </Link>
        </div>
      </article>
    </li>
  );
}
