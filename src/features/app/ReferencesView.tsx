"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

import {
  ApiRequestError,
  type Profile,
  type Reference,
  type ReferenceDirection,
  type ReferenceVisibility,
  getBrowserJson,
  isReferenceResponse,
  isReferencesResponse,
  mutateBrowserJson,
  referenceVisibilityPath,
  referencesPath,
} from "./api";
import { CATEGORY_LABELS } from "./directoryModel";
import {
  REFERENCE_DIRECTIONS,
  REFERENCE_DIRECTION_LABELS,
  counterpartOf,
  directionFromSearch,
  formatArgentinaDate,
  moderationReasonText,
  referenceState,
  referenceStatusText,
  referencesQuery,
  visibilityErrorText,
} from "./referencesModel";
import { ownAccessText } from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./References.module.css";
import requestStyles from "./Requests.module.css";

/** `message: null` = sin mensaje propio del error: se muestra el texto genérico traducido al render. */
type ListState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; items: readonly Reference[]; nextCursor: string | null }>
  | Readonly<{ status: "forbidden"; code: string | null; message: string }>
  | Readonly<{ status: "error"; message: string | null }>;

type Loaded = Readonly<{ key: string; state: ListState }>;

type MoreState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string | null }>;

/** Motivo de un cambio de visibilidad rechazado; el texto se arma al render. */
type Failure = Readonly<{ reason: unknown }>;

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

function initialDirection(): ReferenceDirection {
  return typeof window === "undefined" ? "received" : directionFromSearch(window.location.search);
}

/** La dirección vive en la URL (recargable y enlazable desde avisos); el cursor nunca. */
function writeDirectionToUrl(direction: ReferenceDirection): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("cursor");
  url.searchParams.set("direction", direction);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function replaceItem(loaded: Loaded | null, key: string, updated: Reference): Loaded | null {
  if (!loaded || loaded.key !== key || loaded.state.status !== "ready") return loaded;
  return {
    key,
    state: {
      ...loaded.state,
      items: loaded.state.items.map((item) => (item.id === updated.id ? updated : item)),
    },
  };
}

/**
 * `/app/references`: referencias que recibió el perfil activo y las que escribió.
 * Disponible para todas las categorías. Las recibidas empiezan ocultas y solo quien
 * las recibe decide publicarlas en su ficha; la moderación administrativa manda por
 * encima de esa decisión. Laravel valida cada cambio; la UI refleja su respuesta.
 */
export function ReferencesView({ profile }: Readonly<{ profile: Profile }>) {
  const t = useT();
  const [direction, setDirection] = useState<ReferenceDirection>(initialDirection);
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState<MoreState>({ status: "idle" });
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [itemErrors, setItemErrors] = useState<Readonly<Record<string, Failure>>>({});
  const [notice, setNotice] = useState<Failure | null>(null);
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const query = referencesQuery(direction);
  const requestKey = `${query}#${run}`;
  const state: ListState = loaded?.key === requestKey ? loaded.state : { status: "loading" };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    writeDirectionToUrl(direction);
  }, [direction]);

  // Primera página con generación propia: una respuesta tardía de otra pestaña (o un
  // "Cargar más" en vuelo) nunca pisa el listado vigente.
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    moreController.current?.abort();
    const key = requestKey;

    void getBrowserJson(referencesPath(profile.id, query), isReferencesResponse, controller.signal)
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
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ status: "loading" });
    try {
      const response = await getBrowserJson(
        referencesPath(profile.id, referencesQuery(direction, state.nextCursor)),
        isReferencesResponse,
        controller.signal,
      );
      if (controller.signal.aborted || current !== generation.current) return;
      setLoaded((previous) => {
        if (!previous || previous.key !== key || previous.state.status !== "ready") return previous;
        const known = new Set(previous.state.items.map((item) => item.id));
        const items = [...previous.state.items, ...response.data.filter((item) => !known.has(item.id))];
        return { key, state: { status: "ready", items, nextCursor: response.meta.next_cursor } };
      });
      setMore({ status: "idle" });
    } catch (reason) {
      if (controller.signal.aborted || current !== generation.current) return;
      if (redirectIfUnauthorized(reason)) return;
      setMore({ status: "error", message: messageFrom(reason) });
    }
  };

  /**
   * Publicar/ocultar es optimista: el estado cambia al instante y vuelve atrás si
   * Laravel lo rechaza. Con `reference_moderated` se explica y se relee el listado,
   * porque la moderación cambió el estado real mientras se miraba.
   */
  const toggleVisibility = async (reference: Reference) => {
    if (pending.has(reference.id) || reference.moderated) return;
    const key = requestKey;
    const visibility: ReferenceVisibility = reference.visibility === "visible" ? "hidden" : "visible";
    setPending((current) => new Set(current).add(reference.id));
    setItemErrors((current) => {
      if (!(reference.id in current)) return current;
      const next = { ...current };
      delete next[reference.id];
      return next;
    });
    setNotice(null);
    setLoaded((current) => replaceItem(current, key, { ...reference, visibility }));
    try {
      const { data } = await mutateBrowserJson(
        referenceVisibilityPath(profile.id, reference.id),
        "PATCH",
        { visibility },
        isReferenceResponse,
      );
      if (!mounted.current) return;
      setLoaded((current) => replaceItem(current, key, data));
    } catch (reason) {
      if (!mounted.current || redirectIfUnauthorized(reason)) return;
      setLoaded((current) => replaceItem(current, key, reference));
      if (reason instanceof ApiRequestError && reason.code === "reference_moderated") {
        setNotice({ reason });
        setRun((value) => value + 1);
        return;
      }
      setItemErrors((current) => ({ ...current, [reference.id]: { reason } }));
    } finally {
      if (mounted.current) {
        setPending((current) => {
          const next = new Set(current);
          next.delete(reference.id);
          return next;
        });
      }
    }
  };

  const changeDirection = (value: ReferenceDirection) => {
    if (value === direction) return;
    setMore({ status: "idle" });
    setItemErrors({});
    setNotice(null);
    setDirection(value);
  };

  return (
    <section className={directoryStyles.panel} aria-labelledby="references-title">
      <p className={directoryStyles.eyebrow}>{t("Referencias profesionales")}</p>
      <h1 id="references-title">{t("Referencias")}</h1>
      <p className={directoryStyles.lead}>
        {t("Las referencias son textos libres que dejan las partes de un match aceptado. Un match aceptado no equivale a una contratación ni a un servicio realizado. Las que recibís empiezan ocultas: vos decidís cuáles se publican en tu ficha.")}
      </p>

      <div className={requestStyles.tabs} role="tablist" aria-label={t("Referencias por dirección")}>
        {REFERENCE_DIRECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`references-tab-${item}`}
            className={requestStyles.tab}
            aria-selected={item === direction}
            aria-controls="references-panel"
            onClick={() => changeDirection(item)}
          >
            {t(REFERENCE_DIRECTION_LABELS[item])}
          </button>
        ))}
      </div>

      <div
        id="references-panel"
        className={requestStyles.tabPanel}
        role="tabpanel"
        aria-labelledby={`references-tab-${direction}`}
        aria-busy={state.status === "loading"}
      >
        <h2 className={directoryStyles.srOnly}>
          {direction === "received" ? t("Referencias recibidas") : t("Referencias escritas por vos")}
        </h2>

        {notice ? (
          <div className={styles.notice} role="alert"><p>{visibilityErrorText(notice.reason, t)}</p></div>
        ) : null}

        {state.status === "loading" ? <p className={directoryStyles.muted} role="status">{t("Cargando referencias…")}</p> : null}

        {state.status === "forbidden" ? (
          <div className={directoryStyles.blocked} role="alert">
            <h2>{t("No podés ver las referencias en este momento")}</h2>
            <p>{ownAccessText(state.code, t) ?? state.message}</p>
            <Link className={directoryStyles.primaryAction} href={profileUrl("/app/access", profile.id)}>{t("Ver estado de acceso")}</Link>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={directoryStyles.errorBox} role="alert">
            <h2>{t("No pudimos cargar las referencias")}</h2>
            <p>{state.message ?? t("No pudimos cargar las referencias.")}</p>
            <button type="button" className={directoryStyles.secondaryButton} onClick={() => setRun((value) => value + 1)}>
              {t("Reintentar")}
            </button>
          </div>
        ) : null}

        {state.status === "ready" && state.items.length === 0 ? (
          <div className={directoryStyles.empty} role="status">
            {direction === "received" ? (
              <>
                <h2>{t("Todavía no recibiste referencias")}</h2>
                <p>
                  {t("Cuando la otra parte de un match aceptado deje una referencia sobre tu perfil, aparece acá oculta hasta que decidas publicarla.")}
                </p>
              </>
            ) : (
              <>
                <h2>{t("Todavía no escribiste referencias")}</h2>
                <p>{t("Podés dejar una desde el detalle de una solicitud aceptada.")}</p>
                <Link className={directoryStyles.secondaryAction} href={profileUrl("/app/requests", profile.id)}>
                  {t("Ver solicitudes")}
                </Link>
              </>
            )}
          </div>
        ) : null}

        {state.status === "ready" && state.items.length > 0 ? (
          <>
            <p className={directoryStyles.muted} aria-live="polite">
              {state.items.length === 1
                ? state.nextCursor
                  ? t("{count} referencia cargada · hay más", { count: 1 })
                  : t("{count} referencia cargada", { count: 1 })
                : state.nextCursor
                  ? t("{count} referencias cargadas · hay más", { count: state.items.length })
                  : t("{count} referencias cargadas", { count: state.items.length })}
            </p>
            <ul className={requestStyles.requestList}>
              {state.items.map((item) => (
                <ReferenceRow
                  key={item.id}
                  reference={item}
                  direction={direction}
                  actorId={profile.id}
                  pending={pending.has(item.id)}
                  error={itemErrors[item.id] ?? null}
                  onToggle={() => void toggleVisibility(item)}
                />
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
                  <p className={directoryStyles.fieldError} role="alert">{more.message ?? t("No pudimos cargar más referencias.")}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function ReferenceRow({
  reference,
  direction,
  actorId,
  pending,
  error,
  onToggle,
}: Readonly<{
  reference: Reference;
  direction: ReferenceDirection;
  actorId: string;
  pending: boolean;
  error: Failure | null;
  onToggle: () => void;
}>) {
  const t = useT();
  const counterpart = counterpartOf(reference, direction);
  const titleId = `reference-${reference.id}`;
  const errorId = `reference-error-${reference.id}`;
  const moderation = moderationReasonText(reference, t);
  const canToggle = direction === "received" && !reference.moderated;

  return (
    <li>
      <article className={requestStyles.requestCard} aria-labelledby={titleId} data-reference-id={reference.id}>
        <div className={requestStyles.requestHeader}>
          <div>
            <p className={directoryStyles.eyebrow}>{direction === "received" ? t("Escrita por") : t("Sobre")}</p>
            <h3 id={titleId}>{counterpart.display_name}</h3>
            <p className={requestStyles.counterpartMeta}>
              <span>{t(CATEGORY_LABELS[counterpart.category])}</span>
              <time dateTime={reference.created_at}>{formatArgentinaDate(reference.created_at)}</time>
            </p>
          </div>
          <p className={styles.state} data-state={referenceState(reference)}>
            {t("Estado: {status}", { status: referenceStatusText(reference, direction, t) })}
          </p>
        </div>

        <p className={styles.body}>{reference.body}</p>

        {moderation ? <p className={styles.moderation}>{moderation}</p> : null}

        <div className={requestStyles.rowFooter}>
          {canToggle ? (
            <button
              type="button"
              className={reference.visibility === "visible" ? requestStyles.ghostButton : requestStyles.confirmButton}
              onClick={onToggle}
              disabled={pending}
              aria-describedby={error ? `${titleId} ${errorId}` : titleId}
            >
              {reference.visibility === "visible" ? t("Ocultar de mi ficha") : t("Publicar en mi ficha")}
            </button>
          ) : <span />}
          <Link
            className={directoryStyles.secondaryAction}
            href={profileUrl(`/app/requests/${reference.contact_request_id}`, actorId)}
            aria-label={t("Ver la solicitud relacionada con {name}", { name: counterpart.display_name })}
          >
            {t("Ver solicitud")}
          </Link>
        </div>
        {error ? <p id={errorId} className={styles.itemError} role="alert">{visibilityErrorText(error.reason, t)}</p> : null}
      </article>
    </li>
  );
}
