"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/lib/brand/BrandMark";
import { browserMutation } from "@/lib/browser/auth";
import { LanguageSwitch } from "@/lib/i18n/LanguageSwitch";
import { useT } from "@/lib/i18n/LocaleProvider";
import { type Translate, tk } from "@/lib/i18n/translate";

import { DocumentsPanel, documentAllowsCompletion } from "./DocumentsPanel";
import {
  ACTIVE_PROFILE_KEY,
  ONBOARDING_PROFILE_KEY,
} from "./session";
import {
  ApiRequestError,
  type AcceptTermsInput,
  type Catalogs,
  type CreateProfileInput,
  type CurrentAccount,
  type DocumentRecord,
  type Profile,
  type ProfileCategory,
  type UpdateProfileInput,
  firstFieldError,
  getBrowserJson,
  isCatalogsResponse,
  isCurrentAccountResponse,
  isProfileResponse,
  isPublicProfileId,
  isTermsAcceptanceResponse,
  mutateBrowserJson,
} from "./api";
import { useAccountLocale } from "./accountLocale";
import { persistProfileData } from "./profilePersistence";
import styles from "./OnboardingPage.module.css";

const TERMS_VERSION = "demo-v1";
/** Texto fuente de cada paso (`tk`); se traduce al mostrarlo. */
const STEP_LABELS = [tk("Categoría"), tk("Datos"), tk("Documentos"), tk("Revisión")] as const;

/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type InitialState =
  | { status: "loading" }
  | { status: "ready"; account: CurrentAccount; catalogs: Catalogs }
  | { status: "error"; message: string | null };
type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** Rótulos del glosario compartido (common), por si el catálogo no trae la categoría. */
const CATEGORY_FALLBACK_LABELS: Record<ProfileCategory, string> = {
  tourism_company: tk("Empresa turística"),
  guide: tk("Guía"),
  driver: tk("Conductor"),
  instructor: tk("Instructor"),
  transport_company: tk("Empresa de transporte"),
};

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // El borrador permanece persistido en el servidor aunque no haya sessionStorage.
  }
}

function safeSessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // No hay estado local que limpiar si sessionStorage no está disponible.
  }
}

function updateOnboardingUrl(profileId: string | null): void {
  const url = new URL(window.location.href);
  if (profileId) url.searchParams.set("profile", profileId);
  else url.searchParams.delete("profile");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function onboardingStepKey(profileId: string): string {
  return `contactur:onboarding-step:${profileId}`;
}

function resumeStep(profile: Profile): number {
  if (profile.completed_at) return 4;
  const fromServer = profile.onboarding_step === 1 ? 2 : profile.onboarding_step === 2 ? 3 : 4;
  const local = Number(safeSessionGet(onboardingStepKey(profile.id)));
  return Number.isInteger(local) && local >= 2 && local <= 4 ? local : fromServer;
}

const PROFILE_DATA_FIELD_PREFIXES = [
  "display_name",
  "description",
  "contact",
  "contact_email",
  "phone",
  "primary_city",
  "cities",
  "city_ids",
  "languages",
  "language_ids",
  "services",
  "service_ids",
  "company",
  "legal_name",
  "years_active",
  "guide",
  "education_summary",
  "qualifications",
  "driver",
  "license_type",
  "vehicle_type",
  "vehicle_capacity",
  "instructor",
  "training_summary",
  "specialties",
  "specialty_ids",
  "transport_company",
  "fleet_description",
  "fleet_vehicles",
] as const;

function hasProfileDataErrors(fields: FieldErrors): boolean {
  return Object.keys(fields).some((field) => PROFILE_DATA_FIELD_PREFIXES.some(
    (prefix) => field === prefix || field.startsWith(`${prefix}.`),
  ));
}

function requestMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Mensaje propio del error o `null` para usar el genérico al mostrarlo. */
function errorMessage(reason: unknown): string | null {
  return reason instanceof Error ? reason.message : null;
}

function redirectOnUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
  return true;
}

function fieldErrorsFrom(reason: unknown): FieldErrors {
  return reason instanceof ApiRequestError ? reason.fields : {};
}

function categoryLabel(catalogs: Catalogs, category: ProfileCategory, t: Translate): string {
  return catalogs.categories.find((item) => item.code === category)?.name ?? t(CATEGORY_FALLBACK_LABELS[category]);
}

function fieldErrorId(name: string): string {
  return `profile-${name.replaceAll(".", "-")}-error`;
}

export function FieldError({ fields, name }: Readonly<{ fields: FieldErrors; name: string }>) {
  const message = firstFieldError(fields, name);
  return message ? <span id={fieldErrorId(name)} className={styles.fieldError} role="alert">{message}</span> : null;
}

function fieldProps(fields: FieldErrors, name: string) {
  const invalid = Boolean(firstFieldError(fields, name));
  return {
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? fieldErrorId(name) : undefined,
  } as const;
}

function textValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(form: FormData, name: string): string | null {
  const value = textValue(form, name);
  return value || null;
}

function nullableInteger(form: FormData, name: string): number | null {
  const value = textValue(form, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function selectedIds(form: FormData, name: string): number[] {
  return form.getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map(Number)
    .filter((value) => Number.isInteger(value));
}

function commonProfilePayload(form: FormData) {
  return {
    display_name: textValue(form, "display_name"),
    description: nullableText(form, "description"),
    contact_email: nullableText(form, "contact_email"),
    phone: nullableText(form, "phone"),
    primary_city_id: nullableInteger(form, "primary_city_id"),
    language_ids: selectedIds(form, "language_ids"),
    service_ids: selectedIds(form, "service_ids"),
  };
}

function qualificationPayload(form: FormData) {
  const indexes = form.getAll("qualification_index")
    .filter((value): value is string => typeof value === "string")
    .map(Number)
    .filter((value) => Number.isInteger(value));
  return indexes.flatMap((index) => {
    const title = textValue(form, `qualifications.${index}.title`);
    const institution = textValue(form, `qualifications.${index}.institution`);
    const completedOn = textValue(form, `qualifications.${index}.completed_on`);
    const expiresOn = nullableText(form, `qualifications.${index}.expires_on`);
    if (!title && !institution && !completedOn && !expiresOn) return [];
    return [{ title, institution, completed_on: completedOn, expires_on: expiresOn }];
  });
}

function fleetPayload(form: FormData) {
  const indexes = form.getAll("fleet_index")
    .filter((value): value is string => typeof value === "string")
    .map(Number)
    .filter((value) => Number.isInteger(value));
  return indexes.flatMap((index) => {
    const vehicleType = textValue(form, `fleet_vehicles.${index}.vehicle_type`);
    const quantity = nullableInteger(form, `fleet_vehicles.${index}.quantity`);
    const capacity = nullableInteger(form, `fleet_vehicles.${index}.capacity`);
    if (!vehicleType && quantity === null && capacity === null) return [];
    return [{ vehicle_type: vehicleType, quantity: quantity ?? 0, capacity: capacity ?? 0 }];
  });
}

export function updatePayload(category: ProfileCategory, form: FormData): UpdateProfileInput {
  const common = commonProfilePayload(form);
  switch (category) {
    case "tourism_company":
      return { ...common, legal_name: textValue(form, "legal_name"), years_active: nullableInteger(form, "years_active") };
    case "guide":
      return { ...common, education_summary: nullableText(form, "education_summary"), qualifications: qualificationPayload(form) };
    case "driver":
      return {
        ...common,
        license_type: nullableText(form, "license_type"),
        vehicle_type: nullableText(form, "vehicle_type"),
        vehicle_capacity: nullableInteger(form, "vehicle_capacity"),
      };
    case "instructor":
      return {
        ...common,
        training_summary: nullableText(form, "training_summary"),
        specialty_ids: selectedIds(form, "specialty_ids"),
        qualifications: qualificationPayload(form),
      };
    case "transport_company":
      return {
        ...common,
        legal_name: textValue(form, "legal_name"),
        fleet_description: nullableText(form, "fleet_description"),
        fleet_vehicles: fleetPayload(form),
      };
  }
}

type QualificationValue = Readonly<{
  title: string;
  institution: string;
  completed_on: string;
  expires_on: string | null;
}>;

type FleetValue = Readonly<{
  vehicle_type: string;
  quantity: number;
  capacity: number;
}>;

function QualificationFields({ qualifications, fields }: Readonly<{ qualifications: readonly QualificationValue[]; fields: FieldErrors }>) {
  const t = useT();
  const nextKey = useRef(qualifications.length + 1);
  const [rows, setRows] = useState(() => (qualifications.length > 0 ? qualifications : [{ title: "", institution: "", completed_on: "", expires_on: null }])
    .map((value, index) => ({ key: index + 1, value })));
  return (
    <fieldset className={styles.fieldset}>
      <legend>{t("Formación y calificaciones")}</legend>
      {rows.map((row, index) => (
        <div className={styles.repeaterRow} key={row.key}>
          <input type="hidden" name="qualification_index" value={index} />
          <label>{t("Título o calificación")}<input name={`qualifications.${index}.title`} defaultValue={row.value.title} {...fieldProps(fields, `qualifications.${index}.title`)} /><FieldError fields={fields} name={`qualifications.${index}.title`} /></label>
          <label>{t("Institución")}<input name={`qualifications.${index}.institution`} defaultValue={row.value.institution} {...fieldProps(fields, `qualifications.${index}.institution`)} /><FieldError fields={fields} name={`qualifications.${index}.institution`} /></label>
          <label>{t("Fecha de finalización")}<input name={`qualifications.${index}.completed_on`} type="date" defaultValue={row.value.completed_on} {...fieldProps(fields, `qualifications.${index}.completed_on`)} /><FieldError fields={fields} name={`qualifications.${index}.completed_on`} /></label>
          <label>{t("Vencimiento, si corresponde")}<input name={`qualifications.${index}.expires_on`} type="date" defaultValue={row.value.expires_on ?? ""} {...fieldProps(fields, `qualifications.${index}.expires_on`)} /><FieldError fields={fields} name={`qualifications.${index}.expires_on`} /></label>
          {rows.length > 1 ? <button className={styles.secondaryFormButton} type="button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t("Quitar calificación")}</button> : null}
        </div>
      ))}
      <FieldError fields={fields} name="qualifications" />
      <button className={styles.secondaryFormButton} type="button" onClick={() => {
        const key = nextKey.current++;
        setRows((current) => [...current, { key, value: { title: "", institution: "", completed_on: "", expires_on: null } }]);
      }}>{t("Agregar calificación")}</button>
    </fieldset>
  );
}

function FleetFields({ vehicles, fields }: Readonly<{ vehicles: readonly FleetValue[]; fields: FieldErrors }>) {
  const t = useT();
  const nextKey = useRef(vehicles.length + 1);
  const [rows, setRows] = useState(() => (vehicles.length > 0 ? vehicles : [{ vehicle_type: "", quantity: 0, capacity: 0 }])
    .map((value, index) => ({ key: index + 1, value })));
  return (
    <fieldset className={styles.fieldset}>
      <legend>{t("Vehículos de flota")}</legend>
      {rows.map((row, index) => (
        <div className={styles.repeaterRow} key={row.key}>
          <input type="hidden" name="fleet_index" value={index} />
          <label>{t("Tipo de vehículo")}<input name={`fleet_vehicles.${index}.vehicle_type`} defaultValue={row.value.vehicle_type} {...fieldProps(fields, `fleet_vehicles.${index}.vehicle_type`)} /><FieldError fields={fields} name={`fleet_vehicles.${index}.vehicle_type`} /></label>
          <label>{t("Cantidad")}<input name={`fleet_vehicles.${index}.quantity`} type="number" min="1" defaultValue={row.value.quantity || ""} {...fieldProps(fields, `fleet_vehicles.${index}.quantity`)} /><FieldError fields={fields} name={`fleet_vehicles.${index}.quantity`} /></label>
          <label>{t("Capacidad por unidad")}<input name={`fleet_vehicles.${index}.capacity`} type="number" min="1" defaultValue={row.value.capacity || ""} {...fieldProps(fields, `fleet_vehicles.${index}.capacity`)} /><FieldError fields={fields} name={`fleet_vehicles.${index}.capacity`} /></label>
          {rows.length > 1 ? <button className={styles.secondaryFormButton} type="button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t("Quitar vehículo")}</button> : null}
        </div>
      ))}
      <FieldError fields={fields} name="fleet_vehicles" />
      <button className={styles.secondaryFormButton} type="button" onClick={() => {
        const key = nextKey.current++;
        setRows((current) => [...current, { key, value: { vehicle_type: "", quantity: 0, capacity: 0 } }]);
      }}>{t("Agregar vehículo")}</button>
    </fieldset>
  );
}

export function CategoryFields({
  profile,
  catalogs,
  fields = {},
}: Readonly<{ profile: Profile; catalogs: Catalogs; fields?: FieldErrors }>) {
  const t = useT();
  switch (profile.category) {
    case "tourism_company":
      return (
        <fieldset className={styles.fieldset}>
          <legend>{t("Datos de la empresa turística")}</legend>
          <label>{t("Razón social")}<input name="legal_name" defaultValue={profile.company.legal_name} required {...fieldProps(fields, "legal_name")} /><FieldError fields={fields} name="legal_name" /></label>
          <label>{t("Años de actividad")}<input name="years_active" type="number" min="0" defaultValue={profile.company.years_active ?? ""} {...fieldProps(fields, "years_active")} /><FieldError fields={fields} name="years_active" /></label>
        </fieldset>
      );
    case "guide":
      return (
        <>
          <fieldset className={styles.fieldset}>
            <legend>{t("Datos de guía")}</legend>
            <label>{t("Resumen de formación")}<textarea name="education_summary" defaultValue={profile.guide.education_summary ?? ""} {...fieldProps(fields, "education_summary")} /><FieldError fields={fields} name="education_summary" /></label>
          </fieldset>
          <QualificationFields qualifications={profile.qualifications} fields={fields} />
        </>
      );
    case "driver":
      return (
        <fieldset className={styles.fieldset}>
          <legend>{t("Datos de conducción")}</legend>
          <label>{t("Tipo de licencia")}<input name="license_type" defaultValue={profile.driver.license_type ?? ""} {...fieldProps(fields, "license_type")} /><FieldError fields={fields} name="license_type" /></label>
          <label>{t("Tipo de vehículo")}<input name="vehicle_type" defaultValue={profile.driver.vehicle_type ?? ""} {...fieldProps(fields, "vehicle_type")} /><FieldError fields={fields} name="vehicle_type" /></label>
          <label>{t("Capacidad del vehículo")}<input name="vehicle_capacity" type="number" min="1" defaultValue={profile.driver.vehicle_capacity ?? ""} {...fieldProps(fields, "vehicle_capacity")} /><FieldError fields={fields} name="vehicle_capacity" /></label>
        </fieldset>
      );
    case "instructor":
      return (
        <>
          <fieldset className={styles.fieldset}>
            <legend>{t("Datos de instrucción")}</legend>
            <label>{t("Resumen de capacitación")}<textarea name="training_summary" defaultValue={profile.instructor.training_summary ?? ""} {...fieldProps(fields, "training_summary")} /><FieldError fields={fields} name="training_summary" /></label>
            <CheckboxList legend={t("Especialidades")} name="specialty_ids" items={catalogs.specialties} selected={profile.specialties.map((item) => item.id)} fields={fields} />
          </fieldset>
          <QualificationFields qualifications={profile.qualifications} fields={fields} />
        </>
      );
    case "transport_company":
      return (
        <>
          <fieldset className={styles.fieldset}>
            <legend>{t("Datos de la empresa de transporte")}</legend>
            <label>{t("Razón social")}<input name="legal_name" defaultValue={profile.transport_company.legal_name} required {...fieldProps(fields, "legal_name")} /><FieldError fields={fields} name="legal_name" /></label>
            <label>{t("Descripción de flota")}<textarea name="fleet_description" defaultValue={profile.transport_company.fleet_description ?? ""} {...fieldProps(fields, "fleet_description")} /><FieldError fields={fields} name="fleet_description" /></label>
          </fieldset>
          <FleetFields vehicles={profile.fleet_vehicles} fields={fields} />
        </>
      );
  }
}

function CheckboxList({
  legend,
  name,
  items,
  selected,
  fields,
}: Readonly<{
  legend: string;
  name: string;
  items: ReadonlyArray<{ id: number; name: string }>;
  selected: readonly number[];
  fields: FieldErrors;
}>) {
  const t = useT();
  const describedBy = firstFieldError(fields, name) ? fieldErrorId(name) : undefined;
  return (
    <fieldset className={styles.checkGroup} aria-invalid={Boolean(describedBy) || undefined} aria-describedby={describedBy}>
      <legend>{legend}</legend>
      {items.length === 0 ? <p>{t("No hay opciones disponibles en el catálogo.")}</p> : (
        <div>
          {items.map((item) => (
            <label key={item.id}>
              <input name={name} type="checkbox" value={item.id} defaultChecked={selected.includes(item.id)} />
              <span>{item.name}</span>
            </label>
          ))}
        </div>
      )}
      <FieldError fields={fields} name={name} />
    </fieldset>
  );
}

export function ProfileDataStep({
  account,
  catalogs,
  profile,
  busy,
  fields,
  onSubmit,
  submitLabel,
}: Readonly<{
  account?: CurrentAccount;
  catalogs: Catalogs;
  profile: Profile;
  busy: boolean;
  fields: FieldErrors;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Texto ya traducido; por defecto "Guardar y continuar" en el idioma activo. */
  submitLabel?: string;
}>) {
  const t = useT();
  return (
    <form className={styles.form} key={`${profile.id}-${profile.onboarding_step}`} onSubmit={onSubmit} noValidate>
      {account ? <div className={styles.accountSummary}><span>{t("Cuenta")}</span><strong>{account.user.name}</strong><small>{account.user.email}</small></div> : null}
      <fieldset className={styles.fieldset}>
        <legend>{t("Datos del perfil")}</legend>
        <label>{t("Nombre visible")}<input name="display_name" defaultValue={profile.display_name} required {...fieldProps(fields, "display_name")} /><FieldError fields={fields} name="display_name" /></label>
        <label>{t("Descripción")}<textarea name="description" defaultValue={profile.description ?? ""} required {...fieldProps(fields, "description")} /><FieldError fields={fields} name="description" /></label>
        <label>{t("Email de contacto")}<input name="contact_email" type="email" defaultValue={profile.contact_email ?? ""} required {...fieldProps(fields, "contact_email")} /><FieldError fields={fields} name="contact_email" /></label>
        <label>{t("Teléfono")}<input name="phone" defaultValue={profile.phone ?? ""} required {...fieldProps(fields, "phone")} /><FieldError fields={fields} name="phone" /></label>
        <label>{t("Ciudad principal")}
          <select name="primary_city_id" defaultValue={profile.primary_city?.id ?? ""} required {...fieldProps(fields, "primary_city_id")}>
            <option value="">{t("Seleccioná una ciudad")}</option>
            {catalogs.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
          <FieldError fields={fields} name="primary_city_id" />
        </label>
      </fieldset>
      <CheckboxList legend={t("Ciudades donde trabajás")} name="city_ids" items={catalogs.cities} selected={profile.cities.map((city) => city.id)} fields={fields} />
      <CheckboxList legend={t("Idiomas")} name="language_ids" items={catalogs.languages} selected={profile.languages.map((item) => item.id)} fields={fields} />
      <CheckboxList legend={t("Servicios")} name="service_ids" items={catalogs.services} selected={profile.services.map((item) => item.id)} fields={fields} />
      <CategoryFields profile={profile} catalogs={catalogs} fields={fields} />
      <div className={styles.formActions}>
        <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? t("Guardando…") : submitLabel ?? t("Guardar y continuar")}</button>
      </div>
    </form>
  );
}

export function OnboardingPage() {
  const t = useT();
  const [initial, setInitial] = useState<InitialState>({ status: "loading" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState(1);
  const [profileLoading, setProfileLoading] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const profileRequest = useRef<AbortController | null>(null);
  const persistLocale = useAccountLocale(initial.status === "ready" ? initial.account.user : null);

  const applyProfile = (loaded: Profile) => {
    setDocuments(null);
    setProfile(loaded);
    const nextStep = resumeStep(loaded);
    setStep(nextStep);
    safeSessionSet(ONBOARDING_PROFILE_KEY, loaded.id);
    safeSessionSet(onboardingStepKey(loaded.id), String(nextStep));
    updateOnboardingUrl(loaded.id);
  };

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getBrowserJson("/api/backend/v1/me", isCurrentAccountResponse, controller.signal),
      getBrowserJson("/api/backend/v1/catalogs?per_page=50", isCatalogsResponse, controller.signal),
    ])
      .then(([accountResponse, catalogsResponse]) => {
        setInitial({ status: "ready", account: accountResponse.data, catalogs: catalogsResponse.data });
        const requested = new URL(window.location.href).searchParams.get("profile") ?? safeSessionGet(ONBOARDING_PROFILE_KEY);
        const canResume = isPublicProfileId(requested) && accountResponse.data.profiles.some(
          (item) => item.id === requested && item.status === "draft",
        );
        if (!canResume) return;
        setProfileLoading(true);
        return getBrowserJson(`/api/backend/v1/profiles/${requested}`, isProfileResponse, controller.signal)
          .then((response) => applyProfile(response.data))
          .finally(() => setProfileLoading(false));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectOnUnauthorized(reason)) return;
        setInitial({ status: "error", message: errorMessage(reason) });
      });
    return () => controller.abort();
  }, []);

  const resume = (profileId: string) => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    setProfileLoading(true);
    setProfile(null);
    setFieldErrors({});
    setNotice(null);
    void getBrowserJson(`/api/backend/v1/profiles/${profileId}`, isProfileResponse, controller.signal)
      .then((response) => applyProfile(response.data))
      .catch((reason: unknown) => {
        if (controller.signal.aborted || redirectOnUnauthorized(reason)) return;
        setNotice(requestMessage(reason, t("No pudimos retomar el perfil.")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
  };

  const createProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const category = textValue(form, "category");
    const displayName = textValue(form, "display_name");
    if (!initial || initial.status !== "ready") return;
    const categoryMatch = initial.catalogs.categories.find((item) => item.code === category);
    if (!categoryMatch) {
      setFieldErrors({ category: [t("Seleccioná una categoría válida del catálogo.")] });
      return;
    }
    const payload: CreateProfileInput = { category: categoryMatch.code, display_name: displayName };
    setBusy(true);
    setFieldErrors({});
    setNotice(null);
    try {
      const response = await mutateBrowserJson(
        "/api/backend/v1/profiles",
        "POST",
        payload,
        isProfileResponse,
      );
      applyProfile(response.data);
      setStep(2);
      safeSessionSet(onboardingStepKey(response.data.id), "2");
    } catch (reason) {
      if (redirectOnUnauthorized(reason)) return;
      setFieldErrors(fieldErrorsFrom(reason));
      setNotice(requestMessage(reason, t("No pudimos crear el borrador.")));
    } finally {
      setBusy(false);
    }
  };

  const saveProfileData = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    const profilePayload = updatePayload(profile.category, form);
    const cityIds = selectedIds(form, "city_ids");
    setBusy(true);
    setFieldErrors({});
    setNotice(null);
    try {
      const updated = await persistProfileData(profile, profilePayload, cityIds);
      setProfile(updated);
      setStep(3);
      safeSessionSet(onboardingStepKey(profile.id), "3");
    } catch (reason) {
      if (redirectOnUnauthorized(reason)) return;
      setFieldErrors(fieldErrorsFrom(reason));
      setNotice(requestMessage(reason, t("No pudimos guardar los datos del perfil.")));
    } finally {
      setBusy(false);
    }
  };

  const continueFromDocuments = () => {
    if (!profile || initial.status !== "ready") return;
    const required = initial.catalogs.document_types.filter(
      (type) => type.category === profile.category && type.required,
    );
    const missing = required.filter((type) => !documents?.some(
      (document) => document.document_type.id === type.id && documentAllowsCompletion(document),
    ));
    if (documents === null || missing.length > 0) {
      setNotice(documents === null
        ? t("Esperá a que termine la consulta documental antes de continuar.")
        : t("Falta cargar documentación vigente: {documents}.", { documents: missing.map((type) => type.label).join(", ") }));
      return;
    }
    setStep(4);
    safeSessionSet(onboardingStepKey(profile.id), "4");
    setNotice(null);
  };

  const returnToDocuments = () => {
    if (!profile) return;
    setStep(3);
    setDocuments(null);
    setFieldErrors({});
    setNotice(null);
    safeSessionSet(onboardingStepKey(profile.id), "3");
  };

  const finish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    if (form.get("accepted") !== "yes") {
      setFieldErrors({ accepted: [t("Debés aceptar los términos demo-v1 para continuar.")] });
      return;
    }
    const terms: AcceptTermsInput = { version: TERMS_VERSION, accepted: true };
    setBusy(true);
    setFieldErrors({});
    setNotice(null);
    try {
      try {
        await mutateBrowserJson(
          `/api/backend/v1/profiles/${profile.id}/terms`,
          "POST",
          terms,
          isTermsAcceptanceResponse,
        );
      } catch (reason) {
        const alreadyAccepted = reason instanceof ApiRequestError &&
          reason.status === 409 &&
          reason.code === "terms_already_accepted";
        if (!alreadyAccepted) throw reason;
      }
      const completed = await mutateBrowserJson(
        `/api/backend/v1/profiles/${profile.id}/complete`,
        "POST",
        undefined,
        isProfileResponse,
      );
      setProfile(completed.data);
      setStep(4);
      safeSessionSet(ACTIVE_PROFILE_KEY, completed.data.id);
      safeSessionRemove(ONBOARDING_PROFILE_KEY);
      safeSessionRemove(onboardingStepKey(completed.data.id));
      setNotice(t("El perfil quedó completo y pendiente de habilitación manual."));
    } catch (reason) {
      if (redirectOnUnauthorized(reason)) return;
      const fields = fieldErrorsFrom(reason);
      setFieldErrors(fields);
      const isCompletionValidation = reason instanceof ApiRequestError && reason.status === 422;
      const documentsError = firstFieldError(fields, "documents");
      if (isCompletionValidation && documentsError) {
        setStep(3);
        setDocuments(null);
        safeSessionSet(onboardingStepKey(profile.id), "3");
      } else if (isCompletionValidation && hasProfileDataErrors(fields)) {
        setStep(2);
        safeSessionSet(onboardingStepKey(profile.id), "2");
      }
      setNotice(requestMessage(reason, t("El perfil continúa como borrador.")));
    } finally {
      setBusy(false);
    }
  };

  const startAnother = () => {
    profileRequest.current?.abort();
    if (profile) safeSessionRemove(onboardingStepKey(profile.id));
    safeSessionRemove(ONBOARDING_PROFILE_KEY);
    setProfile(null);
    setStep(1);
    setFieldErrors({});
    setNotice(null);
    updateOnboardingUrl(null);
  };

  const logout = async () => {
    setLogoutPending(true);
    safeSessionRemove(ACTIVE_PROFILE_KEY);
    safeSessionRemove(ONBOARDING_PROFILE_KEY);
    if (profile) safeSessionRemove(onboardingStepKey(profile.id));
    try {
      const response = await browserMutation("/api/auth/logout");
      window.location.replace(response.ok ? "/" : "/?logout=local");
    } catch {
      window.location.replace("/?logout=local");
    }
  };

  if (initial.status === "loading") return <main className={styles.centerState} role="status">{t("Preparando el alta…")}</main>;
  if (initial.status === "error") return <main className={styles.centerState}><div role="alert"><h1>{t("No pudimos abrir el alta")}</h1><p>{initial.message ?? t("No pudimos preparar el alta.")}</p></div></main>;

  const drafts = initial.account.profiles.filter((item) => item.status === "draft" && item.completed_at === null);
  const requiredDocuments = profile
    ? initial.catalogs.document_types.filter((type) => type.category === profile.category && type.required)
    : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/app"><BrandMark /> <span className={styles.brandWord}>Contactur</span></Link>
        <div><LanguageSwitch onChange={persistLocale} /><span>{initial.account.user.name}</span><button type="button" onClick={logout} disabled={logoutPending}>{logoutPending ? t("Cerrando…") : t("Cerrar sesión")}</button></div>
      </header>
      <main className={styles.main}>
        <section className={styles.intro}>
          <div><p className={styles.eyebrow}>{t("Alta profesional")}</p><h1>{profile ? profile.display_name : t("Creá un perfil")}</h1><p>{t("Cuatro pasos guardados. Completar el alta no concede habilitación automática.")}</p></div>
          {profile ? <button className={styles.secondaryButton} type="button" onClick={startAnother}>{t("Crear otro perfil")}</button> : <Link href="/app">{t("Volver al panel")}</Link>}
        </section>

        <ol className={styles.steps} aria-label={t("Progreso del alta")}>
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            return <li key={label} data-current={step === number} data-complete={step > number}><span>{number}</span><strong>{t(label)}</strong></li>;
          })}
        </ol>

        {notice ? <div className={styles.notice} role={fieldErrors && Object.keys(fieldErrors).length > 0 ? "alert" : "status"}>{notice}</div> : null}
        {profileLoading ? <section className={styles.card} role="status">{t("Retomando el borrador…")}</section> : null}

        {!profile && !profileLoading && step === 1 ? (
          <div className={styles.onboardingGrid}>
            <section className={styles.card} aria-labelledby="create-title">
              <h2 id="create-title">{t("1. Categoría y nombre")}</h2>
              <form className={styles.form} onSubmit={createProfile} noValidate>
                <label>{t("Categoría")}
                  <select name="category" defaultValue="" required>
                    <option value="">{t("Seleccioná una categoría")}</option>
                    {initial.catalogs.categories.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                  </select>
                  <FieldError fields={fieldErrors} name="category" />
                </label>
                <label>{t("Nombre visible")}<input name="display_name" minLength={2} maxLength={160} required /><FieldError fields={fieldErrors} name="display_name" /></label>
                <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? t("Creando borrador…") : t("Crear borrador")}</button>
              </form>
            </section>
            <aside className={styles.card} aria-labelledby="drafts-title">
              <h2 id="drafts-title">{t("Borradores guardados")}</h2>
              {drafts.length === 0 ? <p>{t("No tenés borradores para retomar.")}</p> : (
                <ul className={styles.draftList}>{drafts.map((draft) => (
                  <li key={draft.id}><span><strong>{draft.display_name}</strong><small>{categoryLabel(initial.catalogs, draft.category, t)}</small></span><button type="button" onClick={() => resume(draft.id)}>{t("Retomar")}</button></li>
                ))}</ul>
              )}
            </aside>
          </div>
        ) : null}

        {profile && step === 2 ? (
          <section className={styles.card} aria-labelledby="details-title">
            <h2 id="details-title">{t("2. Datos y cobertura")}</h2>
            <p>{t("Los campos disponibles corresponden a {category}.", { category: categoryLabel(initial.catalogs, profile.category, t) })}</p>
            <ProfileDataStep account={initial.account} catalogs={initial.catalogs} profile={profile} busy={busy} fields={fieldErrors} onSubmit={saveProfileData} />
          </section>
        ) : null}

        {profile && step === 3 ? (
          <section className={styles.card} aria-labelledby="documents-title">
            <h2 id="documents-title">{t("3. Documentación requerida")}</h2>
            <p>{t("Cargá un archivo real por cada tipo obligatorio. Una carga válida queda pendiente de revisión administrativa y permite solicitar la finalización.")}</p>
            <DocumentsPanel
              profileId={profile.id}
              documentTypes={initial.catalogs.document_types.filter((type) => type.category === profile.category)}
              requiredOnly
              onDocumentsChange={setDocuments}
              onProfileChange={setProfile}
            />
            <div className={styles.formActions}>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={continueFromDocuments}
                disabled={documents === null || requiredDocuments.some((type) => !documents.some(
                  (document) => document.document_type.id === type.id && documentAllowsCompletion(document),
                ))}
              >
                {t("Continuar a revisión")}
              </button>
            </div>
          </section>
        ) : null}

        {profile && step === 4 && profile.completed_at === null ? (
          <section className={styles.card} aria-labelledby="review-title">
            <h2 id="review-title">{t("4. Revisión y términos")}</h2>
            <dl className={styles.reviewList}>
              <div><dt>{t("Perfil")}</dt><dd>{profile.display_name}</dd></div>
              <div><dt>{t("Categoría")}</dt><dd>{categoryLabel(initial.catalogs, profile.category, t)}</dd></div>
              <div><dt>{t("Ciudades")}</dt><dd>{profile.cities.length}</dd></div>
              <div><dt>{t("Versión de términos")}</dt><dd>{TERMS_VERSION}</dd></div>
            </dl>
            <form className={styles.form} onSubmit={finish}>
              <label className={styles.termsCheck}><input type="checkbox" name="accepted" value="yes" /><span>{t("Acepto los términos de demostración versión {version}.", { version: TERMS_VERSION })}</span></label>
              <FieldError fields={fieldErrors} name="accepted" />
              <FieldError fields={fieldErrors} name="terms" />
              <FieldError fields={fieldErrors} name="email" />
              <div className={styles.formActions}>
                <button className={styles.secondaryButton} type="button" onClick={returnToDocuments}>{t("Volver a documentos")}</button>
                <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? t("Verificando…") : t("Aceptar y solicitar finalización")}</button>
              </div>
            </form>
          </section>
        ) : null}

        {profile && step === 4 && profile.completed_at !== null ? (
          <section className={styles.card} aria-labelledby="complete-title">
            <p className={styles.eyebrow}>{t("Alta completa")}</p><h2 id="complete-title">{t("Pendiente de habilitación manual")}</h2>
            <p>{t("El documento quedó pendiente de revisión y la finalización no concedió acceso, grant ni pago. El estado efectivo se consulta por separado.")}</p>
            <Link className={styles.primaryLink} href={`/app?profile=${encodeURIComponent(profile.id)}`}>{t("Ir al panel")}</Link>
          </section>
        ) : null}
      </main>
    </div>
  );
}
