"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { tk } from "@/lib/i18n/translate";

import {
  ApiRequestError,
  type ContactQuota,
  type ContactRequest,
  type CreateContactRequestInput,
  type Profile,
  type SafeProfile,
  createContactRequest,
  newIdempotencyKey,
} from "./api";
import { businessToday } from "./availabilityModel";
import { createErrorText, formatArgentinaDateTime, quotaText } from "./requestsModel";
import directoryStyles from "./Directory.module.css";
import styles from "./Requests.module.css";

type FieldErrors = Readonly<Record<string, readonly string[]>>;

const FORM_FIELDS = ["service_description", "requested_from", "requested_to", "requested_city_id"] as const;
type FormField = (typeof FORM_FIELDS)[number];

/** Codes cuyo siguiente paso está en la bandeja de solicitudes. */
const CODES_WITH_REQUESTS_LINK = new Set(["contact_request_pending", "contact_request_already_accepted"]);

/**
 * El error guarda el motivo y no el texto: el mensaje se arma al render, en el idioma
 * activo. Los `fields` del 422 ya llegan traducidos por Laravel.
 */
type SubmitState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "sending" }>
  | Readonly<{ status: "error"; code: string | null; reason: unknown; fields: FieldErrors }>
  | Readonly<{ status: "sent"; request: ContactRequest; replayed: boolean }>
  | Readonly<{ status: "exhausted"; limit: string | null }>;

type Draft = Readonly<{ description: string; from: string; to: string; cityId: string }>;

const EMPTY_DRAFT: Draft = { description: "", from: "", to: "", cityId: "" };

function profileUrl(path: string, profileId: string): string {
  return `${path}?profile=${encodeURIComponent(profileId)}`;
}

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function bodyFrom(draft: Draft, targetId: string): CreateContactRequestInput {
  return {
    target_profile_id: targetId,
    service_description: draft.description.trim(),
    ...(draft.from && draft.to ? { requested_from: draft.from, requested_to: draft.to } : {}),
    ...(draft.cityId ? { requested_city_id: Number(draft.cityId) } : {}),
  };
}

/**
 * Cupo mensual agotado: no se muestra el formulario, se explica el uso del mes. El
 * dato viene de `/access` (`contact_quota`) o del 403 `capability_limit_reached`.
 */
export function QuotaExhausted({
  actorId,
  quota,
  limit = null,
}: Readonly<{ actorId: string; quota: ContactQuota | null; limit?: string | null }>) {
  const t = useT();
  return (
    <section className={styles.requestBox} aria-labelledby="contact-quota-title" role="status">
      <h2 id="contact-quota-title">{t("Alcanzaste el límite mensual de solicitudes")}</h2>
      <p>
        {quota
          ? quotaText(quota, t)
          : limit && limit !== "unlimited"
            ? t("Tu habilitación permite {limit} solicitudes de contacto por mes y ya las usaste.", { limit })
            : t("Ya usaste las solicitudes de contacto disponibles para este mes.")}
        {" "}{t("Hasta que se renueve el cupo o cambie tu habilitación no podés enviar otra.")}
      </p>
      <div className={directoryStyles.actionsRow}>
        <Link className={directoryStyles.secondaryAction} href={profileUrl("/app/access", actorId)}>{t("Ver estado de acceso")}</Link>
        <Link className={directoryStyles.secondaryAction} href={profileUrl("/app/requests", actorId)}>{t("Ver mis solicitudes")}</Link>
      </div>
    </section>
  );
}

/**
 * Envío de una solicitud desde la ficha (R13). Laravel valida todo (categoría,
 * cupo, pendiente única, cooldown, fechas); este formulario solo exige lo mínimo
 * para no gastar un request (descripción y fechas de a pares) y explica cada `code`.
 *
 * Idempotencia: cada intento de envío lleva una `Idempotency-Key`. Si el envío
 * falla (por ejemplo, la red se cae y no sabemos si llegó) y se reintenta con el
 * mismo contenido, se reutiliza la misma key: el backend reproduce la solicitud ya
 * creada en vez de duplicarla o descontar otra vez del cupo. Una key nueva se genera
 * solo si cambia el contenido, tras un éxito o tras `idempotency_conflict`.
 */
export function ContactRequestForm({
  actor,
  quota,
  target,
}: Readonly<{ actor: Profile; quota: ContactQuota | null; target: SafeProfile }>) {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  /** Errores del cliente como texto fuente (`tk`); se traducen al mostrarlos. */
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [today] = useState(() => businessToday());
  const attempt = useRef<Readonly<{ key: string; fingerprint: string }> | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Evita un doble envío por doble click antes de que React vuelva a pintar. */
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (state.status === "sent" || state.status === "error") resultRef.current?.focus();
  }, [state.status]);

  if (state.status === "exhausted") {
    return <QuotaExhausted actorId={actor.id} quota={null} limit={state.limit} />;
  }

  if (state.status === "sent") {
    const { request } = state;
    return (
      <section className={styles.requestBox} aria-labelledby="contact-sent-title">
        <div ref={resultRef} tabIndex={-1} role="status">
          <h2 id="contact-sent-title">{t("Solicitud enviada a {name}", { name: target.display_name })}</h2>
          <p>
            {state.replayed
              ? <>{t("Ya habíamos registrado este envío: es la misma solicitud, no se duplicó ni se descontó otra vez del cupo.")}{" "}</>
              : null}
            {t(
              "Queda pendiente hasta que el perfil responda o hasta el {date} (hora de Argentina). Los datos de contacto se comparten solo si la acepta.",
              { date: formatArgentinaDateTime(request.expires_at, locale) },
            )}
          </p>
        </div>
        <div className={directoryStyles.actionsRow}>
          <Link className={directoryStyles.primaryAction} href={profileUrl(`/app/requests/${request.id}`, actor.id)}>
            {t("Ver solicitud")}
          </Link>
        </div>
      </section>
    );
  }

  const sending = state.status === "sending";
  const serverFields: FieldErrors = state.status === "error" ? state.fields : {};
  const errorFor = (field: FormField): string | undefined => {
    const local = localErrors[field]?.[0];
    return local ? t(local) : serverFields[field]?.[0];
  };
  const generalFieldErrors = Object.entries(serverFields)
    .filter(([field]) => !FORM_FIELDS.some((name) => name === field) && field !== "retry_after" && field !== "capability" && field !== "limit")
    .flatMap(([, messages]) => messages);
  const describedBy = (field: FormField, hint?: string) => {
    const ids = [hint, errorFor(field) ? `contact-${field}-error` : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  };
  const fieldError = (field: FormField) => errorFor(field)
    ? <span className={directoryStyles.fieldError} id={`contact-${field}-error`}>{errorFor(field)}</span>
    : null;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setLocalErrors((current) => (Object.keys(current).length > 0 ? {} : current));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;

    const errors: Record<string, string[]> = {};
    if (!draft.description.trim()) errors.service_description = [tk("Describí el servicio que necesitás.")];
    if ((draft.from === "") !== (draft.to === "")) {
      errors[draft.from ? "requested_to" : "requested_from"] = [tk("Indicá las dos fechas del rango, o ninguna.")];
    }
    if (Object.keys(errors).length > 0) {
      setLocalErrors(errors);
      return;
    }
    setLocalErrors({});

    const body = bodyFrom(draft, target.id);
    const fingerprint = JSON.stringify(body);
    const previous = attempt.current;
    const key = previous && previous.fingerprint === fingerprint ? previous.key : newIdempotencyKey();
    attempt.current = { key, fingerprint };

    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    inFlight.current = true;
    setState({ status: "sending" });
    try {
      const result = await createContactRequest(actor.id, body, key, current.signal);
      if (current.signal.aborted) return;
      attempt.current = null;
      setState({ status: "sent", request: result.data, replayed: result.replayed });
    } catch (reason) {
      if (current.signal.aborted || redirectIfUnauthorized(reason)) return;
      if (reason instanceof ApiRequestError && reason.code === "capability_limit_reached") {
        setState({ status: "exhausted", limit: reason.fields.limit?.[0] ?? null });
        return;
      }
      // La key solo se descarta si el backend dijo que ya está ligada a otro contenido.
      if (reason instanceof ApiRequestError && reason.code === "idempotency_conflict") attempt.current = null;
      setState({
        status: "error",
        code: reason instanceof ApiRequestError ? reason.code : null,
        reason,
        fields: reason instanceof ApiRequestError && reason.status === 422 ? reason.fields : {},
      });
    } finally {
      if (controller.current === current) inFlight.current = false;
    }
  };

  const remaining = quota && quota.limit !== null && quota.remaining !== null ? quota.remaining : null;

  return (
    <section className={styles.requestBox} aria-labelledby="contact-form-title">
      <h2 id="contact-form-title">{t("Solicitar contacto")}</h2>
      <p>
        {t("Contale al perfil qué servicio necesitás. Si acepta, ambas partes ven los datos de contacto declarados; mientras tanto no se comparte ningún dato privado.")}
      </p>

      {state.status === "error" ? (
        <div className={directoryStyles.errorBox} ref={resultRef} tabIndex={-1} role="alert">
          <p>{createErrorText(state.reason, locale)}</p>
          {generalFieldErrors.length > 0 ? <p>{generalFieldErrors.join(" ")}</p> : null}
          {state.code && CODES_WITH_REQUESTS_LINK.has(state.code) ? (
            <Link className={directoryStyles.secondaryAction} href={profileUrl("/app/requests", actor.id)}>{t("Ver mis solicitudes")}</Link>
          ) : null}
        </div>
      ) : null}

      <form className={styles.requestForm} onSubmit={(event) => void submit(event)} aria-label={t("Solicitud de contacto")} noValidate>
        <div className={`${directoryStyles.field} ${styles.wide}`}>
          <label htmlFor="contact-service_description">{t("Servicio solicitado")}</label>
          <textarea
            id="contact-service_description"
            name="service_description"
            maxLength={5000}
            required
            value={draft.description}
            aria-invalid={errorFor("service_description") ? true : undefined}
            aria-describedby={describedBy("service_description", "contact-service-hint")}
            onChange={(event) => update("description", event.target.value)}
          />
          <span className={directoryStyles.hint} id="contact-service-hint">
            {t("Obligatorio. Por ejemplo: actividad, cantidad de personas, idioma o requisitos.")}
          </span>
          {fieldError("service_description")}
        </div>

        <div className={directoryStyles.field}>
          <label htmlFor="contact-requested_from">{t("Desde (opcional)")}</label>
          <input
            id="contact-requested_from"
            name="requested_from"
            type="date"
            min={today}
            value={draft.from}
            aria-invalid={errorFor("requested_from") ? true : undefined}
            aria-describedby={describedBy("requested_from", "contact-range-hint")}
            onChange={(event) => update("from", event.target.value)}
          />
          {fieldError("requested_from")}
        </div>

        <div className={directoryStyles.field}>
          <label htmlFor="contact-requested_to">{t("Hasta (opcional)")}</label>
          <input
            id="contact-requested_to"
            name="requested_to"
            type="date"
            min={draft.from || today}
            value={draft.to}
            aria-invalid={errorFor("requested_to") ? true : undefined}
            aria-describedby={describedBy("requested_to", "contact-range-hint")}
            onChange={(event) => update("to", event.target.value)}
          />
          {fieldError("requested_to")}
        </div>

        <div className={directoryStyles.field}>
          <label htmlFor="contact-requested_city_id">{t("Ciudad (opcional)")}</label>
          <select
            id="contact-requested_city_id"
            name="requested_city_id"
            value={draft.cityId}
            aria-invalid={errorFor("requested_city_id") ? true : undefined}
            aria-describedby={describedBy("requested_city_id")}
            onChange={(event) => update("cityId", event.target.value)}
          >
            <option value="">{t("Sin ciudad indicada")}</option>
            {target.cities.map((city) => <option key={city.id} value={String(city.id)}>{city.name}</option>)}
          </select>
          {fieldError("requested_city_id")}
        </div>

        <p className={`${directoryStyles.hint} ${styles.wide}`} id="contact-range-hint">
          {t("Fechas de a pares, desde hoy y hasta 90 días. Son contexto para el perfil: no reservan su calendario.")}
        </p>

        <div className={styles.formActions}>
          <button type="submit" className={directoryStyles.primaryButton} disabled={sending}>
            {sending ? t("Enviando…") : t("Enviar solicitud")}
          </button>
          {remaining !== null ? (
            <p>
              {remaining === 1
                ? t("Te queda {count} solicitud este mes.", { count: remaining })
                : t("Te quedan {count} solicitudes este mes.", { count: remaining })}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
