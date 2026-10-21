"use client";

import { type FormEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import {
  AdminDialog,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  ReasonField,
  reasonProblem,
} from "./AdminDialog";
import {
  ACCESS_GRANT_STATUSES,
  type AccessGrantStatus,
  type AdminAccessGrantInput,
  type AdminProfileEntry,
  accessGrantStatusLabel,
  accessStateLabel,
  categoryLabel,
  formatBusinessDateTime,
  grantDateTimeToInput,
  inputToGrantDateTime,
} from "./api";
import styles from "./AdminPanels.module.css";

/** Campos del formulario que el backend puede devolver en `error.fields`. */
export type GrantField =
  | "status"
  | "starts_at"
  | "expires_at"
  | "city_limit"
  | "monthly_contact_limit"
  | "gallery_enabled"
  | "expected_version"
  | "cities_to_keep"
  | "reason";

export type GrantFieldErrors = Readonly<Partial<Record<GrantField, string | null>>>;

export type AccessGrantDialogProps = Readonly<{
  entry: AdminProfileEntry;
  pending: boolean;
  /** 422 del backend, campo por campo. */
  fieldErrors: GrantFieldErrors;
  /** 409 `stale_access_grant`: alguien más modificó el grant. */
  staleMessage: string | null;
  /** Aviso de que se volvió a leer el grant y hay que confirmar de nuevo. */
  notice: string | null;
  reloading: boolean;
  generalError: string | null;
  onReload: () => void;
  onSubmit: (payload: AdminAccessGrantInput) => void;
  onClose: () => void;
}>;

const DESCRIPTION = tk(
  "Habilitación manual del perfil: define desde cuándo y hasta cuándo puede operar y con qué capacidades. No es un pago ni una suscripción, no se renueva sola y no cambia el estado del perfil, que se administra aparte. El motivo y el cambio quedan en la auditoría.",
);

const LIMIT_HINT = tk(
  "Vacío significa sin límite. 0 bloquea la capacidad. Solo se aceptan enteros de 0 o más.",
);

const INTEGER = /^\d+$/;

type LimitKind = "cities" | "contacts";

/** Un literal por forma y por capacidad: el orden de las palabras cambia entre idiomas. */
function limitSummary(raw: string, kind: LimitKind, t: Translate): string {
  const trimmed = raw.trim();
  const cities = kind === "cities";
  if (trimmed === "") {
    return cities ? t("Sin límite de ciudades.") : t("Sin límite de solicitudes por mes.");
  }
  if (!INTEGER.test(trimmed)) return t("El valor actual no es un entero válido.");
  const value = Number(trimmed);
  if (value === 0) {
    return cities ? t("Bloqueado: 0 ciudades permitidas.") : t("Bloqueado: 0 solicitudes por mes permitidas.");
  }
  if (value === 1) return cities ? t("Hasta 1 ciudad.") : t("Hasta 1 solicitud por mes.");
  return cities
    ? t("Hasta {count} ciudades.", { count: value })
    : t("Hasta {count} solicitudes por mes.", { count: value });
}

/**
 * Etiqueta, ayuda y error viven fuera del `label` y se vinculan por id, así el nombre
 * accesible del control es solo su etiqueta y la ayuda llega por `aria-describedby`.
 */
function GrantFormField({
  fieldId,
  label,
  hint,
  error,
  children,
}: Readonly<{
  fieldId: string;
  label: string;
  hint?: string;
  error: string | null;
  children: ReactNode;
}>) {
  return (
    <div className={styles.dialogField}>
      <label htmlFor={fieldId}>{label}</label>
      {children}
      {hint ? <span className={styles.fieldHint} id={`${fieldId}-hint`}>{hint}</span> : null}
      {error ? (
        <span className={styles.fieldError} id={`${fieldId}-error`} role="alert">{error}</span>
      ) : null}
    </div>
  );
}

export function AccessGrantDialog({
  entry,
  pending,
  fieldErrors,
  staleMessage,
  notice,
  reloading,
  generalError,
  onReload,
  onSubmit,
  onClose,
}: AccessGrantDialogProps) {
  const t = useT();
  const locale = useLocale();
  const grant = entry.access.grant;
  const currentCities = entry.profile.cities;
  // Un perfil sin habilitación registrada se administra con versión 0: el backend
  // trata la ausencia de grant como versión 0, no como un error.
  const expectedVersion = grant?.version ?? 0;

  const [status, setStatus] = useState<AccessGrantStatus>(grant?.status ?? "inactive");
  const [startsAt, setStartsAt] = useState(grantDateTimeToInput(grant?.starts_at ?? null));
  const [expiresAt, setExpiresAt] = useState(grantDateTimeToInput(grant?.expires_at ?? null));
  const [cityLimit, setCityLimit] = useState(
    grant?.city_limit === null || grant?.city_limit === undefined ? "" : String(grant.city_limit),
  );
  const [contactLimit, setContactLimit] = useState(
    grant?.monthly_contact_limit === null || grant?.monthly_contact_limit === undefined
      ? ""
      : String(grant.monthly_contact_limit),
  );
  const [galleryEnabled, setGalleryEnabled] = useState(grant?.gallery_enabled ?? false);
  // Nada preseleccionado: la selección de ciudades a conservar la hace la persona.
  const [keptCityIds, setKeptCityIds] = useState<readonly number[]>([]);
  const [reason, setReason] = useState("");
  const [localErrors, setLocalErrors] = useState<GrantFieldErrors>({});
  const statusRef = useRef<HTMLSelectElement | null>(null);
  const baseId = useId();

  const fieldId = (field: GrantField) => `${baseId}-${field}`;

  const cityLimitValue = useMemo(() => {
    const trimmed = cityLimit.trim();
    if (trimmed === "") return null;
    return INTEGER.test(trimmed) ? Number(trimmed) : Number.NaN;
  }, [cityLimit]);

  /**
   * El backend exige `cities_to_keep` cuando el nuevo límite queda por debajo de las
   * ciudades actuales, y también cuando el límite es 0: en ese caso la única selección
   * válida es la lista vacía. Con límite vacío (sin límite) no corresponde enviarla.
   */
  const selectionRequired = cityLimitValue !== null &&
    Number.isInteger(cityLimitValue) &&
    (cityLimitValue === 0 || cityLimitValue < currentCities.length);
  const choosable = selectionRequired && cityLimitValue !== 0 && currentCities.length > 0;
  const removedCities = currentCities.filter((city) => !keptCityIds.includes(city.id));
  const exceedsLimit = choosable && cityLimitValue !== null && keptCityIds.length > cityLimitValue;

  const errorFor = (field: GrantField): string | null =>
    localErrors[field] ?? fieldErrors[field] ?? null;

  const describedBy = (field: GrantField, withHint: boolean): string | undefined => {
    const ids = [
      withHint ? `${fieldId(field)}-hint` : undefined,
      errorFor(field) ? `${fieldId(field)}-error` : undefined,
    ].filter((value): value is string => value !== undefined);
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  const toggleCity = (cityId: number) => {
    setKeptCityIds((current) => current.includes(cityId)
      ? current.filter((id) => id !== cityId)
      : [...current, cityId]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problems: Partial<Record<GrantField, string>> = {};
    if (cityLimit.trim() !== "" && !INTEGER.test(cityLimit.trim())) {
      problems.city_limit = t(LIMIT_HINT);
    }
    if (contactLimit.trim() !== "" && !INTEGER.test(contactLimit.trim())) {
      problems.monthly_contact_limit = t(LIMIT_HINT);
    }
    const reasonIssue = reasonProblem(reason, t);
    if (reasonIssue) problems.reason = reasonIssue;
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }
    setLocalErrors({});

    const base = {
      status,
      starts_at: inputToGrantDateTime(startsAt),
      expires_at: inputToGrantDateTime(expiresAt),
      city_limit: cityLimit.trim() === "" ? null : Number(cityLimit),
      monthly_contact_limit: contactLimit.trim() === "" ? null : Number(contactLimit),
      // Booleano JSON real: el backend rechaza "true" y 1.
      gallery_enabled: galleryEnabled,
      expected_version: expectedVersion,
      reason: reason.trim(),
    };
    onSubmit(selectionRequired
      ? { ...base, cities_to_keep: [...keptCityIds].sort((left, right) => left - right) }
      : base);
  };

  return (
    <AdminDialog
      title={t("Editar la habilitación manual")}
      subject={t("{profile} · {category} · titular {owner}", {
        profile: entry.profile.display_name,
        category: categoryLabel(entry.profile.category, t),
        owner: entry.owner.name,
      })}
      description={t(DESCRIPTION)}
      pending={pending}
      conflictMessage={staleMessage}
      conflictAction={staleMessage ? (
        <button type="button" onClick={onReload} disabled={reloading || pending}>
          {reloading ? t("Releyendo la habilitación…") : t("Releer la habilitación y reintentar")}
        </button>
      ) : undefined}
      generalError={generalError}
      notice={notice}
      initialFocusRef={statusRef}
      size="wide"
      onClose={onClose}
    >
      <dl className={styles.grantSnapshot}>
        <div>
          <dt>{t("Habilitación vigente")}</dt>
          <dd>
            {grant === null
              ? t("El perfil no tiene habilitación registrada todavía.")
              : grant.expires_at === null
                ? t("{status} · desde {start} · hasta sin vencimiento", {
                  status: accessGrantStatusLabel(grant.status, t),
                  start: formatBusinessDateTime(grant.starts_at, locale),
                })
                : t("{status} · desde {start} · hasta {end}", {
                  status: accessGrantStatusLabel(grant.status, t),
                  start: formatBusinessDateTime(grant.starts_at, locale),
                  end: formatBusinessDateTime(grant.expires_at, locale),
                })}
          </dd>
        </div>
        <div>
          <dt>{t("Estado de acceso evaluado")}</dt>
          <dd>{accessStateLabel(entry.access.effective_state, t)}</dd>
        </div>
        <div>
          <dt>{t("Versión sobre la que vas a escribir")}</dt>
          <dd data-grant-expected-version={expectedVersion}>
            {grant === null
              ? t("{version} (sin habilitación previa)", { version: expectedVersion })
              : expectedVersion}
          </dd>
        </div>
        <div>
          <dt>{t("Ciudades actuales del perfil")}</dt>
          <dd>
            {currentCities.length === 0
              ? t("Ninguna")
              : `${currentCities.length}: ${currentCities.map((city) => city.name).join(", ")}`}
          </dd>
        </div>
      </dl>
      {errorFor("expected_version") ? (
        <p className={styles.fieldError} id={`${fieldId("expected_version")}-error`} role="alert">
          {errorFor("expected_version")}
        </p>
      ) : null}

      <form onSubmit={submit} noValidate>
        <div className={styles.dialogGrid}>
          <GrantFormField
            fieldId={fieldId("status")}
            label={t("Estado de la habilitación")}
            error={errorFor("status")}
          >
            <select
              id={fieldId("status")}
              name="status"
              ref={statusRef}
              value={status}
              onChange={(event) => setStatus(event.target.value as AccessGrantStatus)}
              aria-invalid={errorFor("status") ? true : undefined}
              aria-describedby={describedBy("status", false)}
            >
              {ACCESS_GRANT_STATUSES.map((option) => (
                <option value={option} key={option}>{accessGrantStatusLabel(option, t)}</option>
              ))}
            </select>
          </GrantFormField>

          <GrantFormField
            fieldId={fieldId("starts_at")}
            label={t("Habilitada desde")}
            hint={t("Hora de Argentina. Vacío significa sin fecha de inicio.")}
            error={errorFor("starts_at")}
          >
            <input
              id={fieldId("starts_at")}
              type="datetime-local"
              name="starts_at"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              aria-invalid={errorFor("starts_at") ? true : undefined}
              aria-describedby={describedBy("starts_at", true)}
            />
          </GrantFormField>

          <GrantFormField
            fieldId={fieldId("expires_at")}
            label={t("Habilitada hasta")}
            hint={t("Hora de Argentina. Vacío significa sin vencimiento; la habilitación no se renueva sola.")}
            error={errorFor("expires_at")}
          >
            <input
              id={fieldId("expires_at")}
              type="datetime-local"
              name="expires_at"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              aria-invalid={errorFor("expires_at") ? true : undefined}
              aria-describedby={describedBy("expires_at", true)}
            />
          </GrantFormField>

          <GrantFormField
            fieldId={fieldId("city_limit")}
            label={t("Límite de ciudades")}
            hint={`${t(LIMIT_HINT)} ${limitSummary(cityLimit, "cities", t)}`}
            error={errorFor("city_limit")}
          >
            <input
              id={fieldId("city_limit")}
              type="number"
              name="city_limit"
              min={0}
              step={1}
              value={cityLimit}
              onChange={(event) => setCityLimit(event.target.value)}
              aria-invalid={errorFor("city_limit") ? true : undefined}
              aria-describedby={describedBy("city_limit", true)}
            />
          </GrantFormField>

          <GrantFormField
            fieldId={fieldId("monthly_contact_limit")}
            label={t("Límite mensual de solicitudes de contacto")}
            hint={`${t(LIMIT_HINT)} ${limitSummary(contactLimit, "contacts", t)}`}
            error={errorFor("monthly_contact_limit")}
          >
            <input
              id={fieldId("monthly_contact_limit")}
              type="number"
              name="monthly_contact_limit"
              min={0}
              step={1}
              value={contactLimit}
              onChange={(event) => setContactLimit(event.target.value)}
              aria-invalid={errorFor("monthly_contact_limit") ? true : undefined}
              aria-describedby={describedBy("monthly_contact_limit", true)}
            />
          </GrantFormField>

          <div className={styles.dialogField}>
            <label className={styles.checkboxField} htmlFor={fieldId("gallery_enabled")}>
              <input
                id={fieldId("gallery_enabled")}
                type="checkbox"
                name="gallery_enabled"
                checked={galleryEnabled}
                onChange={(event) => setGalleryEnabled(event.target.checked)}
                aria-invalid={errorFor("gallery_enabled") ? true : undefined}
                aria-describedby={describedBy("gallery_enabled", false)}
              />
              <span>{t("Galería habilitada")}</span>
            </label>
            {errorFor("gallery_enabled") ? (
              <span
                className={styles.fieldError}
                id={`${fieldId("gallery_enabled")}-error`}
                role="alert"
              >
                {errorFor("gallery_enabled")}
              </span>
            ) : null}
          </div>
        </div>

        {selectionRequired ? (
          <fieldset
            className={styles.cityFieldset}
            aria-describedby={errorFor("cities_to_keep") ? `${fieldId("cities_to_keep")}-error` : undefined}
          >
            <legend>{t("Ciudades a conservar (obligatorio)")}</legend>
            <p className={styles.cityWarning}>
              {t("El nuevo límite queda por debajo de las {count} ciudades actuales del perfil, así que hay que elegir cuáles se conservan. Las ciudades excluidas pierden sus disponibilidades futuras: el backend las bloquea en la misma operación y no se recuperan solas. Nadie elige por vos y la lista no se recorta automáticamente.", { count: currentCities.length })}
            </p>
            {choosable ? (
              <>
                <div className={styles.cityOptions}>
                  {currentCities.map((city) => {
                    const isPrimary = entry.profile.primary_city?.id === city.id;
                    return (
                      <label className={styles.checkboxField} key={city.id}>
                        <input
                          type="checkbox"
                          name="cities_to_keep"
                          value={city.id}
                          checked={keptCityIds.includes(city.id)}
                          onChange={() => toggleCity(city.id)}
                        />
                        <span>
                          {isPrimary ? t("{city} · ciudad principal", { city: city.name }) : city.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className={styles.cityCount} aria-live="polite">
                  {t("Conservás {kept} de {total} ciudades; el nuevo límite permite hasta {limit}.", {
                    kept: keptCityIds.length,
                    total: currentCities.length,
                    limit: String(cityLimitValue),
                  })}
                  {removedCities.length > 0
                    ? ` ${t("Pierden disponibilidad futura: {cities}.", {
                      cities: removedCities.map((city) => city.name).join(", "),
                    })}`
                    : ""}
                </p>
                {exceedsLimit ? (
                  <p className={styles.cityWarning} role="alert">
                    {t("La selección supera el nuevo límite, así que el backend va a rechazarla. Quitá ciudades o subí el límite antes de confirmar.")}
                  </p>
                ) : null}
                {keptCityIds.length === 0 ? (
                  <p className={styles.cityWarning} role="alert">
                    {t("Sin ninguna ciudad seleccionada el perfil queda sin ciudades y todas pierden disponibilidad futura. Si no es lo que buscás, elegí las que se conservan.")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className={styles.cityWarning} role="alert">
                {t("Con límite 0 no queda ninguna ciudad por conservar: se envía una selección vacía.")}
                {currentCities.length > 0
                  ? ` ${t("Pierden disponibilidad futura: {cities}.", {
                    cities: currentCities.map((city) => city.name).join(", "),
                  })}`
                  : ` ${t("El perfil no tiene ciudades cargadas.")}`}
              </p>
            )}
            {errorFor("cities_to_keep") ? (
              <span
                className={styles.fieldError}
                id={`${fieldId("cities_to_keep")}-error`}
                role="alert"
              >
                {errorFor("cities_to_keep")}
              </span>
            ) : null}
          </fieldset>
        ) : null}

        <ReasonField
          label={t("Motivo (obligatorio)")}
          hint={t("Queda registrado en la auditoría junto con la habilitación. Entre {min} y {max} caracteres.", {
            min: REASON_MIN_LENGTH,
            max: REASON_MAX_LENGTH,
          })}
          value={reason}
          error={errorFor("reason")}
          onChange={(value) => {
            setReason(value);
            if (localErrors.reason) setLocalErrors((current) => ({ ...current, reason: null }));
          }}
        />

        <div className={styles.dialogActions}>
          <button type="button" data-variant="ghost" onClick={onClose} disabled={pending}>
            {t("Cancelar")}
          </button>
          <button type="submit" disabled={pending || reloading}>
            {pending ? t("Aplicando…") : t("Guardar habilitación")}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
