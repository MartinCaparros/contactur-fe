"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

import {
  type AccessEvaluation,
  ApiRequestError,
  type ContactRequest,
  type CreateReferenceInput,
  type Profile,
  type Reference,
  type SafeProfile,
  contactRequestReferencesPath,
  getBrowserJson,
  isReferenceResponse,
  isReferencesResponse,
  mutateBrowserJson,
  referencesPath,
} from "./api";
import {
  AUTHORED_LOOKUP_PER_PAGE,
  REFERENCE_BODY_MAX,
  REFERENCE_BODY_MIN,
  bodyCounterText,
  createReferenceErrorText,
  formatArgentinaDate,
  moderationReasonText,
  referenceBodyProblem,
  referenceState,
  referenceStatusText,
  referencesHref,
  referencesQuery,
} from "./referencesModel";
import { ownAccessText } from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./References.module.css";
import requestStyles from "./Requests.module.css";

type LookupState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "done"; existing: Reference | null }>;

/**
 * El error guarda el motivo y el texto se arma al render (idioma activo):
 * - `field`: 422; se muestra junto al campo (el mensaje de Laravel ya viene traducido).
 * - `general`: se explica arriba del formulario según el `code`.
 */
type SubmitState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "sending" }>
  | Readonly<{ status: "error"; placement: "field" | "general"; reason: unknown; fieldMessage: string | null }>
  | Readonly<{ status: "created"; reference: Reference }>
  | Readonly<{ status: "exists" }>;

const BODY_ID = "reference-body";
const HINT_ID = "reference-body-hint";
const COUNTER_ID = "reference-body-counter";
const ERROR_ID = "reference-body-error";

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

/**
 * Sección "Referencia" del detalle de una solicitud aceptada (T20). Antes de ofrecer
 * el formulario se consulta la primera página de referencias emitidas: si ya hay una
 * para este match se muestra en lugar del formulario. Si esa consulta falla, el
 * formulario se ofrece igual y el 409 `reference_already_exists` del backend lo cubre.
 * Esta sección nunca muestra datos de contacto: eso sigue en "Datos de contacto".
 */
export function RequestReferencePanel({
  actor,
  access,
  request,
  counterpart,
  onStale,
}: Readonly<{
  actor: Profile;
  access: AccessEvaluation | null;
  request: ContactRequest;
  counterpart: SafeProfile;
  onStale: () => void;
}>) {
  const t = useT();
  const [lookup, setLookup] = useState<LookupState>({ status: "loading" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [body, setBody] = useState("");
  /** Validación local: se marca el problema y el texto se arma al render con el cuerpo actual. */
  const [localError, setLocalError] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const createdRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getBrowserJson(
      referencesPath(actor.id, referencesQuery("authored", null, AUTHORED_LOOKUP_PER_PAGE)),
      isReferencesResponse,
      controller.signal,
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setLookup({ status: "done", existing: data.find((item) => item.contact_request_id === request.id) ?? null });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectIfUnauthorized(reason)) return;
        setLookup({ status: "done", existing: null });
      });
    return () => controller.abort();
  }, [actor.id, request.id]);

  useEffect(() => {
    if (submit.status === "created") createdRef.current?.focus();
  }, [submit.status]);

  const name = counterpart.display_name;
  const authoredHref = referencesHref(actor.id, "authored");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (referenceBodyProblem(body)) {
      setLocalError(true);
      textareaRef.current?.focus();
      return;
    }
    setLocalError(false);
    inFlight.current = true;
    setSubmit({ status: "sending" });
    try {
      const payload: CreateReferenceInput = { body: body.trim() };
      const { data } = await mutateBrowserJson(
        contactRequestReferencesPath(actor.id, request.id),
        "POST",
        payload,
        isReferenceResponse,
      );
      if (!mounted.current) return;
      setSubmit({ status: "created", reference: data });
    } catch (reason) {
      if (!mounted.current || redirectIfUnauthorized(reason)) return;
      if (reason instanceof ApiRequestError && reason.code === "reference_already_exists") {
        setSubmit({ status: "exists" });
        return;
      }
      if (reason instanceof ApiRequestError && reason.status === 422) {
        setSubmit({ status: "error", placement: "field", reason, fieldMessage: reason.fields.body?.[0] ?? null });
        textareaRef.current?.focus();
        return;
      }
      setSubmit({ status: "error", placement: "general", reason, fieldMessage: null });
      if (reason instanceof ApiRequestError && reason.code === "contact_request_not_accepted") onStale();
    } finally {
      inFlight.current = false;
    }
  };

  const existing = submit.status === "created"
    ? submit.reference
    : lookup.status === "done" ? lookup.existing : null;

  let content: ReactNode;
  if (lookup.status === "loading" && submit.status === "idle") {
    content = <p>{t("Revisando si ya dejaste una referencia en este match…")}</p>;
  } else if (existing) {
    const moderation = moderationReasonText(existing, t);
    content = (
      <div
        className={styles.created}
        ref={createdRef}
        tabIndex={-1}
        role={submit.status === "created" ? "status" : undefined}
      >
        <h3>
          {submit.status === "created"
            ? t("Referencia guardada sobre {name}", { name })
            : t("Ya dejaste una referencia sobre {name}", { name })}
        </h3>
        <p className={styles.state} data-state={referenceState(existing)}>
          {t("Estado: {status}", { status: referenceStatusText(existing, "authored", t) })}
        </p>
        <p className={styles.body}>{existing.body}</p>
        {moderation ? <p className={styles.moderation}>{moderation}</p> : null}
        <p>
          {t("Escrita el {date}. No se puede editar: {name} decide si la publica en su ficha.", {
            date: formatArgentinaDate(existing.created_at),
            name,
          })}
        </p>
        <Link className={directoryStyles.secondaryAction} href={authoredHref}>{t("Ver tus referencias")}</Link>
      </div>
    );
  } else if (submit.status === "exists") {
    content = (
      <div className={directoryStyles.errorBox} role="alert">
        <p>{t("Ya dejaste una referencia en este match. Cada parte puede dejar una sola y no se edita.")}</p>
        <Link className={directoryStyles.secondaryAction} href={authoredHref}>{t("Ver tus referencias")}</Link>
      </div>
    );
  } else if (access !== null && !access.allowed) {
    // D21: con acceso no vigente Laravel rechaza el alta; no se ofrece lo que se va a rechazar.
    content = (
      <p>
        {ownAccessText(access.denial_code, t) ?? t("Con el estado de acceso actual no podés dejar referencias.")}{" "}
        {t("Las referencias que ya escribiste siguen disponibles en Referencias.")}
      </p>
    );
  } else {
    const fieldError = localError
      ? referenceBodyProblem(body, t)
      : submit.status === "error" && submit.placement === "field"
        ? submit.fieldMessage ?? createReferenceErrorText(submit.reason, t)
        : null;
    const generalError = submit.status === "error" && submit.placement === "general"
      ? createReferenceErrorText(submit.reason, t)
      : null;
    const length = body.trim().length;
    const describedBy = [HINT_ID, COUNTER_ID, fieldError ? ERROR_ID : null].filter(Boolean).join(" ");
    content = (
      <>
        <p>
          {t("Contá cómo fue trabajar con {name}. Es texto libre. La referencia empieza oculta: {name} decide si la publica en su ficha. Una vez enviada no se puede editar.", { name })}
        </p>
        {generalError ? (
          <div className={directoryStyles.errorBox} role="alert"><p>{generalError}</p></div>
        ) : null}
        <form className={styles.form} onSubmit={(event) => void send(event)} aria-label={t("Referencia")} noValidate>
          <label htmlFor={BODY_ID}>{t("Dejá una referencia sobre {name}", { name })}</label>
          <textarea
            id={BODY_ID}
            name="body"
            ref={textareaRef}
            required
            maxLength={REFERENCE_BODY_MAX}
            value={body}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              setBody(event.target.value);
              if (localError) setLocalError(false);
            }}
          />
          <span className={directoryStyles.hint} id={HINT_ID}>
            {t("Entre {min} y {max} caracteres. Se respetan los saltos de línea.", { min: REFERENCE_BODY_MIN, max: REFERENCE_BODY_MAX })}
          </span>
          <span
            className={styles.counter}
            id={COUNTER_ID}
            data-out-of-range={length > 0 && (length < REFERENCE_BODY_MIN || length > REFERENCE_BODY_MAX) ? "true" : undefined}
          >
            {bodyCounterText(body, t)}
          </span>
          {fieldError ? <span className={directoryStyles.fieldError} id={ERROR_ID}>{fieldError}</span> : null}
          <div className={requestStyles.actions}>
            <button type="submit" className={requestStyles.confirmButton} disabled={submit.status === "sending"}>
              {submit.status === "sending" ? t("Enviando…") : t("Enviar referencia")}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <section className={requestStyles.section} aria-labelledby="request-reference" aria-busy={lookup.status === "loading"}>
      <h2 id="request-reference">{t("Referencia")}</h2>
      {content}
    </section>
  );
}
