import type { components } from "@/lib/api/generated";
import { browserMutation, readBrowserApiError } from "@/lib/browser/auth";
import { browserTranslate } from "@/lib/i18n/browser";

export type ProfileCategory = components["schemas"]["ProfileCategory"];
export type CurrentAccount = components["schemas"]["CurrentAccountData"];
export type OwnedProfileSummary = components["schemas"]["OwnedProfileSummary"];
export type Profile = components["schemas"]["Profile"];
export type AccessEvaluation = components["schemas"]["AccessEvaluation"];
export type Catalogs = components["schemas"]["CatalogsData"];
export type DocumentRecord = components["schemas"]["Document"];
export type DocumentDownloadResponse = components["schemas"]["DocumentDownloadResponse"];
export type CreateProfileInput = components["schemas"]["CreateProfileBase"];
export type UpdateProfileInput = components["schemas"]["UpdateProfileRequest"];
export type ReplaceCitiesInput = components["schemas"]["ReplaceCitiesRequest"];
export type AcceptTermsInput = components["schemas"]["AcceptTermsRequest"];
export type City = components["schemas"]["City"];
export type AvailabilityData = components["schemas"]["AvailabilityData"];
export type AvailabilityDayInput = components["schemas"]["AvailabilityDayInput"];
export type UpdateAvailabilityInput = components["schemas"]["UpdateAvailabilityRequest"];
export type ReceiverCategory = components["schemas"]["ReceiverCategory"];
export type SafeProfile = components["schemas"]["SafeProfile"];
export type SearchResult = components["schemas"]["SearchResult"];
export type SearchResponse = components["schemas"]["SearchResponse"];
export type DirectoryProfile = components["schemas"]["DirectoryProfileData"];
export type PublicDocumentSummary = components["schemas"]["PublicDocumentSummary"];
export type PublicAvailability = components["schemas"]["PublicAvailabilityData"];
export type ContactQuota = components["schemas"]["ContactQuota"];
export type ContactRequest = components["schemas"]["ContactRequest"];
export type ContactRequestStatus = components["schemas"]["ContactRequestStatus"];
export type CreateContactRequestInput = components["schemas"]["CreateContactRequest"];
export type MatchedContacts = components["schemas"]["MatchedContactsData"];
export type ProfileContact = components["schemas"]["ProfileContact"];

export const PROFILE_CATEGORIES = [
  "tourism_company",
  "guide",
  "driver",
  "instructor",
  "transport_company",
] as const satisfies readonly ProfileCategory[];

const PROFILE_STATUSES = ["draft", "published", "suspended"] as const;
const ACCESS_STATES = ["inactive", "active", "expired", "suspended"] as const;
const DOCUMENT_STATUSES = ["pending", "approved", "rejected"] as const;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type JsonGuard<T> = (value: unknown) => value is T;
type UnknownRecord = Record<string, unknown>;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly fields: Readonly<Record<string, readonly string[]>>;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    fields: Readonly<Record<string, readonly string[]>> = {},
  ) {
    // Los mensajes fijos del cliente y del BFF están en español (texto fuente): se
    // traducen al idioma activo. Los de Laravel ya llegan traducidos (Accept-Language)
    // y, al no ser textos fuente, quedan como vienen.
    super(browserTranslate(message));
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyStringArrays(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(
    (messages) => Array.isArray(messages) && messages.every((message) => typeof message === "string"),
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isProfileCategory(value: unknown): value is ProfileCategory {
  return typeof value === "string" && PROFILE_CATEGORIES.some((category) => category === value);
}

export function isPublicProfileId(value: unknown): value is string {
  return typeof value === "string" && ULID.test(value);
}

function isCity(value: unknown): value is components["schemas"]["City"] {
  return isRecord(value) &&
    typeof value.id === "number" && Number.isInteger(value.id) &&
    typeof value.name === "string" &&
    typeof value.province_code === "string" &&
    value.country_code === "AR" &&
    typeof value.timezone === "string";
}

function isCatalogItem(value: unknown): value is components["schemas"]["CatalogItem"] {
  return isRecord(value) &&
    typeof value.id === "number" && Number.isInteger(value.id) &&
    typeof value.code === "string" &&
    typeof value.name === "string";
}

export function isMedia(value: unknown): value is components["schemas"]["Media"] {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    typeof value.url === "string" &&
    (value.mime_type === "image/jpeg" || value.mime_type === "image/png" || value.mime_type === "image/webp") &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.position === "number";
}

function isCapabilities(value: unknown): value is components["schemas"]["ProfileCapabilities"] {
  if (!isRecord(value)) return false;
  return [
    "can_search",
    "can_send_contact_requests",
    "can_publish_availability",
    "can_receive_contact_requests",
    "can_use_gallery",
    "can_view_history",
    "can_reject_pending_requests",
  ].every((key) => typeof value[key] === "boolean");
}

export function isOwnedProfileSummary(value: unknown): value is OwnedProfileSummary {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isProfileCategory(value.category) &&
    typeof value.display_name === "string" &&
    PROFILE_STATUSES.some((status) => status === value.status) &&
    isNullableString(value.completed_at) &&
    ACCESS_STATES.some((status) => status === value.access_state) &&
    isCapabilities(value.capabilities);
}

function isUser(value: unknown): value is components["schemas"]["User"] {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    isNullableString(value.email_verified_at) &&
    (value.system_role === "user" || value.system_role === "admin") &&
    (value.status === "active" || value.status === "suspended");
}

function isNotificationPreference(value: unknown): value is components["schemas"]["NotificationPreferenceInput"] {
  return isRecord(value) && typeof value.event_type === "string" && typeof value.email_enabled === "boolean";
}

export function isCurrentAccountResponse(value: unknown): value is { data: CurrentAccount } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isUser(data.user) &&
    Array.isArray(data.profiles) && data.profiles.every(isOwnedProfileSummary) &&
    Array.isArray(data.notification_preferences) && data.notification_preferences.every(isNotificationPreference);
}

function isQualification(value: unknown): value is components["schemas"]["Qualification"] {
  return isRecord(value) &&
    (value.id === undefined || (typeof value.id === "number" && Number.isInteger(value.id))) &&
    typeof value.title === "string" &&
    typeof value.institution === "string" &&
    typeof value.completed_on === "string" &&
    isNullableString(value.expires_on);
}

function isFleetVehicle(value: unknown): value is components["schemas"]["FleetVehicle"] {
  return isRecord(value) &&
    (value.id === undefined || (typeof value.id === "number" && Number.isInteger(value.id))) &&
    typeof value.vehicle_type === "string" &&
    typeof value.quantity === "number" && Number.isInteger(value.quantity) &&
    typeof value.capacity === "number" && Number.isInteger(value.capacity);
}

function isCommonProfile(value: UnknownRecord): boolean {
  return isPublicProfileId(value.id) &&
    isProfileCategory(value.category) &&
    typeof value.display_name === "string" &&
    (value.slug === undefined || typeof value.slug === "string") &&
    isNullableString(value.description) &&
    PROFILE_STATUSES.some((status) => status === value.status) &&
    typeof value.onboarding_step === "number" && Number.isInteger(value.onboarding_step) &&
    value.onboarding_step >= 1 && value.onboarding_step <= 4 &&
    isNullableString(value.completed_at) &&
    (value.primary_city === null || isCity(value.primary_city)) &&
    Array.isArray(value.cities) && value.cities.every(isCity) &&
    Array.isArray(value.languages) && value.languages.every(isCatalogItem) &&
    Array.isArray(value.services) && value.services.every(isCatalogItem) &&
    (value.contact_email === undefined || isNullableString(value.contact_email)) &&
    (value.phone === undefined || isNullableString(value.phone)) &&
    (value.avatar === null || isMedia(value.avatar)) &&
    Array.isArray(value.gallery) && value.gallery.every(isMedia) &&
    typeof value.verified === "boolean";
}

export function isProfile(value: unknown): value is Profile {
  if (!isRecord(value) || !isCommonProfile(value)) return false;

  switch (value.category) {
    case "tourism_company":
      return isRecord(value.company) &&
        typeof value.company.legal_name === "string" &&
        isNullableNumber(value.company.years_active);
    case "guide":
      return isRecord(value.guide) &&
        isNullableString(value.guide.education_summary) &&
        Array.isArray(value.qualifications) && value.qualifications.every(isQualification);
    case "driver":
      return isRecord(value.driver) &&
        isNullableString(value.driver.license_type) &&
        isNullableString(value.driver.vehicle_type) &&
        isNullableNumber(value.driver.vehicle_capacity);
    case "instructor":
      return isRecord(value.instructor) &&
        isNullableString(value.instructor.training_summary) &&
        Array.isArray(value.specialties) && value.specialties.every(isCatalogItem) &&
        Array.isArray(value.qualifications) && value.qualifications.every(isQualification);
    case "transport_company":
      return isRecord(value.transport_company) &&
        typeof value.transport_company.legal_name === "string" &&
        isNullableString(value.transport_company.fleet_description) &&
        Array.isArray(value.fleet_vehicles) && value.fleet_vehicles.every(isFleetVehicle);
    default:
      return false;
  }
}

export function isProfileResponse(value: unknown): value is { data: Profile } {
  return isRecord(value) && isProfile(value.data);
}

function isAccessGrant(value: unknown): value is components["schemas"]["AccessGrant"] {
  return isRecord(value) &&
    (value.status === "inactive" || value.status === "active" || value.status === "suspended") &&
    isNullableString(value.starts_at) &&
    isNullableString(value.expires_at) &&
    isNullableNumber(value.city_limit) &&
    isNullableNumber(value.monthly_contact_limit) &&
    typeof value.gallery_enabled === "boolean" &&
    typeof value.version === "number" && Number.isInteger(value.version);
}

function isContactQuota(value: unknown): value is components["schemas"]["ContactQuota"] {
  return isRecord(value) &&
    typeof value.month_start === "string" &&
    typeof value.used === "number" && Number.isInteger(value.used) &&
    isNullableNumber(value.limit) &&
    isNullableNumber(value.remaining);
}

export function isAccessResponse(value: unknown): value is { data: AccessEvaluation } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isPublicProfileId(data.profile_id) &&
    ACCESS_STATES.some((status) => status === data.effective_state) &&
    typeof data.allowed === "boolean" &&
    (data.denial_code === null ||
      data.denial_code === "subscription_required" ||
      data.denial_code === "subscription_expired" ||
      data.denial_code === "account_suspended" ||
      data.denial_code === "profile_suspended" ||
      data.denial_code === "capability_limit_reached") &&
    (data.grant === null || isAccessGrant(data.grant)) &&
    isCapabilities(data.capabilities) &&
    (data.contact_quota === null || isContactQuota(data.contact_quota)) &&
    typeof data.evaluated_at === "string";
}

function isDocumentType(value: unknown): value is components["schemas"]["DocumentType"] {
  return isRecord(value) &&
    typeof value.id === "number" && Number.isInteger(value.id) &&
    typeof value.code === "string" &&
    isProfileCategory(value.category) &&
    typeof value.label === "string" &&
    typeof value.requires_expiration === "boolean" &&
    typeof value.required === "boolean" &&
    (value.jurisdiction === undefined || isNullableString(value.jurisdiction));
}

function isPagination(value: unknown): boolean {
  return isRecord(value) &&
    isNullableString(value.next_cursor) &&
    typeof value.per_page === "number" && Number.isInteger(value.per_page) &&
    (value.total === undefined || isNullableNumber(value.total));
}

export function isCatalogsResponse(value: unknown): value is { data: Catalogs; meta: components["schemas"]["PaginationMeta"] } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return Array.isArray(data.categories) && data.categories.every((category) =>
    isRecord(category) && isProfileCategory(category.code) && typeof category.name === "string" &&
    typeof category.is_receiver === "boolean" && typeof category.has_availability === "boolean") &&
    Array.isArray(data.cities) && data.cities.every(isCity) &&
    Array.isArray(data.services) && data.services.every(isCatalogItem) &&
    Array.isArray(data.languages) && data.languages.every(isCatalogItem) &&
    Array.isArray(data.specialties) && data.specialties.every(isCatalogItem) &&
    Array.isArray(data.document_types) && data.document_types.every(isDocumentType) &&
    isPagination(value.meta);
}

export function isMediaResponse(value: unknown): value is { data: components["schemas"]["Media"] } {
  return isRecord(value) && isMedia(value.data);
}

export function isDocument(value: unknown): value is DocumentRecord {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isPublicProfileId(value.profile_id) &&
    isDocumentType(value.document_type) &&
    typeof value.original_filename === "string" &&
    (value.mime_type === "application/pdf" || value.mime_type === "image/jpeg" || value.mime_type === "image/png") &&
    typeof value.size_bytes === "number" &&
    isNullableString(value.registration_number) &&
    isNullableString(value.valid_until) &&
    DOCUMENT_STATUSES.some((status) => status === value.status) &&
    isNullableString(value.reviewed_at) &&
    isNullableString(value.rejection_reason) &&
    typeof value.uploaded_at === "string" &&
    typeof value.is_currently_valid === "boolean";
}

export function isDocumentResponse(value: unknown): value is { data: DocumentRecord } {
  return isRecord(value) && isDocument(value.data);
}

export function isDocumentsResponse(value: unknown): value is { data: DocumentRecord[]; meta: components["schemas"]["PaginationMeta"] } {
  return isRecord(value) && Array.isArray(value.data) && value.data.every(isDocument) && isPagination(value.meta);
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isDocumentDownloadResponse(value: unknown): value is DocumentDownloadResponse {
  return isRecord(value) &&
    isRecord(value.data) &&
    isSafeHttpUrl(value.data.signed_url) &&
    typeof value.data.expires_at === "string" &&
    Number.isFinite(Date.parse(value.data.expires_at));
}

/**
 * Evento de ventana que avisa al shell que el backend respondió 403
 * `account_suspended`. El shell re-consulta `/me` y pasa a la vista restringida sin
 * recargar (P27). No lleva datos: la fuente de verdad sigue siendo la API.
 */
export const ACCOUNT_SUSPENDED_EVENT = "contactur:account-suspended";

export async function apiError(response: Response, fallback: string): Promise<ApiRequestError> {
  const parsed = await readBrowserApiError(response);
  if (response.status === 403 && parsed?.error.code === "account_suspended" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACCOUNT_SUSPENDED_EVENT));
  }
  return new ApiRequestError(
    parsed?.error.message ?? fallback,
    response.status,
    parsed?.error.code ?? null,
    hasOnlyStringArrays(parsed?.error.fields) ? parsed.error.fields : {},
  );
}

export async function getBrowserJson<T>(
  path: string,
  guard: JsonGuard<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await apiError(response, "No pudimos obtener los datos solicitados.");
  const body: unknown = await response.json();
  if (!guard(body)) throw new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502, "invalid_response");
  return body;
}

export async function mutateBrowserJson<TBody, TResult>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: TBody | undefined,
  guard: JsonGuard<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  const response = await browserMutation(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await apiError(response, "No pudimos guardar los cambios.");
  const value: unknown = await response.json();
  if (!guard(value)) throw new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502, "invalid_response");
  return value;
}

export async function mutateBrowserFormData<TResult>(
  path: string,
  body: FormData,
  guard: JsonGuard<TResult>,
  signal?: AbortSignal,
): Promise<TResult> {
  const response = await browserMutation(path, { method: "POST", body, signal });
  if (!response.ok) throw await apiError(response, "No pudimos subir el archivo.");
  const value: unknown = await response.json();
  if (!guard(value)) throw new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502, "invalid_response");
  return value;
}

export async function mutateBrowserNoContent(
  path: string,
  method: "DELETE",
  signal?: AbortSignal,
): Promise<void> {
  const response = await browserMutation(path, { method, signal });
  if (!response.ok) throw await apiError(response, "No pudimos eliminar el recurso.");
  if (response.status !== 204) {
    throw new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502, "invalid_response");
  }
}

export function documentDownloadPath(profileId: string, documentId: string): string {
  return `/api/backend/v1/profiles/${profileId}/documents/${documentId}/download`;
}

function safeFilename(value: string): string {
  const sanitized = value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  return sanitized || "documento";
}

/**
 * Descarga por la ruta protegida del documento, la única que existe: el backend la
 * habilita tanto para el titular del perfil como para una cuenta de administración
 * activa, así que el backoffice y el panel del titular comparten exactamente este
 * recorrido en lugar de duplicarlo.
 *
 * El backend hoy emite el binario. La variante JSON `DocumentDownloadResponse` está
 * en el contrato, así que se distingue por `content-type`: en ese caso se abre la
 * `signed_url` validada como enlace y nunca se convierte en blob, porque un JSON
 * descargado como archivo sería un archivo roto. El nombre del archivo siempre es el
 * original declarado por el documento, saneado para no escapar del nombre.
 *
 * Lanza `ApiRequestError`; quien llama decide cómo mostrarlo y si un 401 redirige.
 */
export async function downloadProfileDocument(
  profileId: string,
  record: Readonly<{ id: string; original_filename: string }>,
): Promise<void> {
  const response = await fetch(
    documentDownloadPath(profileId, record.id),
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) throw await apiError(response, "No pudimos descargar el documento.");

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const anchor = window.document.createElement("a");
  anchor.download = safeFilename(record.original_filename);
  anchor.rel = "noopener noreferrer";

  if (contentType.includes("application/json")) {
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiRequestError("La respuesta de descarga no tiene el formato esperado.", 502, "invalid_response");
    }
    if (!isDocumentDownloadResponse(value)) {
      throw new ApiRequestError("La respuesta de descarga no tiene el formato esperado.", 502, "invalid_response");
    }
    anchor.href = value.data.signed_url;
    anchor.target = "_blank";
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

const FIELD_ERROR_ALIASES: Readonly<Record<string, readonly string[]>> = {
  city_ids: ["cities"],
  language_ids: ["languages"],
  service_ids: ["services"],
  specialty_ids: ["specialties"],
  contact_email: ["contact", "contact.email"],
  phone: ["contact.phone"],
  legal_name: ["company", "company.legal_name", "transport_company", "transport_company.legal_name"],
  years_active: ["company.years_active"],
  education_summary: ["guide", "guide.education_summary"],
  license_type: ["driver", "driver.license_type"],
  vehicle_type: ["driver.vehicle_type"],
  vehicle_capacity: ["driver.vehicle_capacity"],
  training_summary: ["instructor", "instructor.training_summary"],
  fleet_description: ["transport_company.fleet_description"],
};

export function firstFieldError(
  fields: Readonly<Record<string, readonly string[]>>,
  name: string,
): string | undefined {
  const candidates = [name, ...(FIELD_ERROR_ALIASES[name] ?? [])];
  for (const candidate of candidates) {
    const direct = fields[candidate]?.[0];
    if (direct) return direct;
    const nested = Object.entries(fields).find(([field]) => field.startsWith(`${candidate}.`));
    if (nested?.[1][0]) return nested[1][0];
  }
  return undefined;
}

export function isTermsAcceptanceResponse(
  value: unknown,
): value is { data: components["schemas"]["TermsAcceptance"] } {
  return isRecord(value) &&
    isRecord(value.data) &&
    isPublicProfileId(value.data.profile_id) &&
    typeof value.data.version === "string" &&
    typeof value.data.accepted_at === "string";
}

export function isProfileCitiesResponse(
  value: unknown,
): value is { data: components["schemas"]["ProfileCitiesData"] } {
  return isRecord(value) &&
    isRecord(value.data) &&
    isPublicProfileId(value.data.profile_id) &&
    Array.isArray(value.data.cities) &&
    value.data.cities.every(isCity);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function isAvailabilityDay(value: unknown): value is components["schemas"]["AvailabilityDay"] {
  return isRecord(value) &&
    typeof value.date === "string" && ISO_DATE.test(value.date) &&
    typeof value.available === "boolean" &&
    (value.city === null || isCity(value.city)) &&
    // Un día disponible siempre trae su ciudad; uno bloqueado nunca la trae.
    (value.available === (value.city !== null));
}

export function isAvailabilityResponse(value: unknown): value is { data: AvailabilityData } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isPublicProfileId(data.profile_id) &&
    typeof data.month === "string" && ISO_MONTH.test(data.month) &&
    typeof data.version === "number" && Number.isInteger(data.version) && data.version >= 0 &&
    Array.isArray(data.days) && data.days.every(isAvailabilityDay) &&
    data.days.every((day) => isRecord(day) && typeof day.date === "string" && day.date.startsWith(`${data.month}-`));
}

export function availabilityPath(profileId: string, month?: string): string {
  const base = `/api/backend/v1/profiles/${profileId}/availability`;
  return month ? `${base}?month=${encodeURIComponent(month)}` : base;
}

// --- Directorio entre miembros (T14/T15) ---------------------------------------
// Los guards validan solo la whitelist del contrato: si el backend agregara un campo
// de contacto, la UI no lo lee porque ningún componente lo referencia.

export const RECEIVER_CATEGORIES = [
  "guide",
  "driver",
  "instructor",
  "transport_company",
] as const satisfies readonly ReceiverCategory[];

export function isReceiverCategory(value: unknown): value is ReceiverCategory {
  return typeof value === "string" && RECEIVER_CATEGORIES.some((category) => category === value);
}

const AVAILABILITY_STATUSES = ["available", "partial", "unspecified"] as const;
const PUBLIC_DOCUMENT_STATUSES = ["missing", "pending", "approved", "rejected", "expired"] as const;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCategoryDetails(category: ProfileCategory, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (category) {
    case "tourism_company":
      return typeof value.legal_name === "string" && isNullableNumber(value.years_active);
    case "guide":
      return isNullableString(value.education_summary);
    case "driver":
      return isNullableString(value.license_type) &&
        isNullableString(value.vehicle_type) &&
        isNullableNumber(value.vehicle_capacity);
    case "instructor":
      return isNullableString(value.training_summary);
    case "transport_company":
      return typeof value.legal_name === "string" && isNullableString(value.fleet_description);
  }
}

export function isSafeProfile(value: unknown): value is SafeProfile {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isProfileCategory(value.category) &&
    typeof value.display_name === "string" &&
    isNullableString(value.description) &&
    (value.primary_city === null || isCity(value.primary_city)) &&
    Array.isArray(value.cities) && value.cities.every(isCity) &&
    Array.isArray(value.languages) && value.languages.every(isCatalogItem) &&
    Array.isArray(value.services) && value.services.every(isCatalogItem) &&
    (value.avatar === null || isMedia(value.avatar)) &&
    Array.isArray(value.gallery) && value.gallery.every(isMedia) &&
    typeof value.verified === "boolean" &&
    isCategoryDetails(value.category, value.category_details);
}

function isSearchResult(value: unknown): value is SearchResult {
  return isRecord(value) &&
    isSafeProfile(value.safe_profile) &&
    isNonNegativeInteger(value.matched_days) &&
    isNonNegativeInteger(value.requested_days) &&
    AVAILABILITY_STATUSES.some((status) => status === value.availability_status);
}

export function isSearchResponse(value: unknown): value is SearchResponse {
  return isRecord(value) &&
    Array.isArray(value.data) && value.data.every(isSearchResult) &&
    isPagination(value.meta) &&
    isRecord(value.meta) && typeof value.meta.search_seed === "string";
}

function isPublicDocumentSummary(value: unknown): value is PublicDocumentSummary {
  return isRecord(value) &&
    isRecord(value.document_type) &&
    typeof value.document_type.code === "string" &&
    typeof value.document_type.label === "string" &&
    PUBLIC_DOCUMENT_STATUSES.some((status) => status === value.status) &&
    isNullableString(value.valid_until) &&
    typeof value.is_currently_valid === "boolean";
}

function isPublicReference(value: unknown): value is components["schemas"]["PublicReference"] {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isSafeProfile(value.author) &&
    typeof value.body === "string" &&
    typeof value.created_at === "string";
}

export function isDirectoryProfileResponse(value: unknown): value is { data: DirectoryProfile } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isSafeProfile(data.profile) &&
    Array.isArray(data.document_statuses) && data.document_statuses.every(isPublicDocumentSummary) &&
    Array.isArray(data.qualifications) && data.qualifications.every(isQualification) &&
    Array.isArray(data.fleet_vehicles) && data.fleet_vehicles.every(isFleetVehicle) &&
    Array.isArray(data.specialties) && data.specialties.every(isCatalogItem) &&
    Array.isArray(data.visible_references) && data.visible_references.every(isPublicReference);
}

export function isPublicAvailabilityResponse(value: unknown): value is { data: PublicAvailability } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isPublicProfileId(data.profile_id) &&
    isNonNegativeInteger(data.version) &&
    Array.isArray(data.available_days) && data.available_days.every((day) =>
      isRecord(day) && typeof day.date === "string" && ISO_DATE.test(day.date) && isCity(day.city));
}

export function searchPath(actorProfileId: string, query: string): string {
  const base = `/api/backend/v1/profiles/${actorProfileId}/search`;
  return query ? `${base}?${query}` : base;
}

export function directoryProfilePath(actorProfileId: string, targetProfileId: string): string {
  return `/api/backend/v1/profiles/${actorProfileId}/directory/${targetProfileId}`;
}

export function directoryAvailabilityPath(actorProfileId: string, targetProfileId: string, month: string): string {
  return `${directoryProfilePath(actorProfileId, targetProfileId)}/availability?month=${encodeURIComponent(month)}`;
}

// --- Solicitudes de contacto (T17/T18) -------------------------------------------
// El `status` que llega ya es el estado efectivo (una pendiente vencida por reloj
// llega `expired`): la UI lo muestra tal cual y no recalcula vencimientos.

export const CONTACT_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const satisfies readonly ContactRequestStatus[];

export type ContactRequestDirection = "sent" | "received";
export type ContactRequestAction = "accept" | "reject" | "cancel";

const REQUEST_AVAILABILITY_STATUSES = ["available", "changed", "unavailable", "unspecified"] as const;

export function isContactRequestStatus(value: unknown): value is ContactRequestStatus {
  return typeof value === "string" && CONTACT_REQUEST_STATUSES.some((status) => status === value);
}

function isNullableIsoDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && ISO_DATE.test(value));
}

function isContactRequest(value: unknown): value is ContactRequest {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isSafeProfile(value.sender) &&
    isSafeProfile(value.recipient) &&
    typeof value.service_description === "string" &&
    isNullableIsoDate(value.requested_from) &&
    isNullableIsoDate(value.requested_to) &&
    (value.requested_city === null || isCity(value.requested_city)) &&
    isContactRequestStatus(value.status) &&
    REQUEST_AVAILABILITY_STATUSES.some((status) => status === value.availability_status) &&
    typeof value.expires_at === "string" &&
    isNullableString(value.responded_at) &&
    isNullableString(value.cancelled_at) &&
    typeof value.created_at === "string";
}

export function isContactRequestResponse(value: unknown): value is { data: ContactRequest } {
  return isRecord(value) && isContactRequest(value.data);
}

export function isContactRequestsResponse(
  value: unknown,
): value is { data: ContactRequest[]; meta: components["schemas"]["PaginationMeta"] } {
  return isRecord(value) && Array.isArray(value.data) && value.data.every(isContactRequest) && isPagination(value.meta);
}

function isProfileContact(value: unknown): value is ProfileContact {
  return isRecord(value) &&
    isPublicProfileId(value.profile_id) &&
    typeof value.display_name === "string" &&
    isNullableString(value.contact_email) &&
    isNullableString(value.phone);
}

export function isMatchedContactsResponse(value: unknown): value is { data: MatchedContacts } {
  return isRecord(value) &&
    isRecord(value.data) &&
    isPublicProfileId(value.data.contact_request_id) &&
    isProfileContact(value.data.actor) &&
    isProfileContact(value.data.counterpart);
}

export function contactRequestsPath(actorProfileId: string, query = ""): string {
  const base = `/api/backend/v1/profiles/${actorProfileId}/contact-requests`;
  return query ? `${base}?${query}` : base;
}

export function contactRequestPath(actorProfileId: string, requestId: string): string {
  return `${contactRequestsPath(actorProfileId)}/${requestId}`;
}

export function contactRequestActionPath(
  actorProfileId: string,
  requestId: string,
  action: ContactRequestAction,
): string {
  return `${contactRequestPath(actorProfileId, requestId)}/${action}`;
}

export function contactRequestContactPath(actorProfileId: string, requestId: string): string {
  return `${contactRequestPath(actorProfileId, requestId)}/contact`;
}

/** Patrón del header según el contrato: 16–128 caracteres de `[A-Za-z0-9._:-]`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

/**
 * Una key por intento de envío. Se quitan los guiones del UUID para que la key sea
 * solo `cr.` + 32 hexadecimales, dentro del patrón sin depender de qué caracteres
 * acepta. Sin `randomUUID` (contexto no seguro) se usa `getRandomValues`.
 */
export function newIdempotencyKey(): string {
  const hex = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `cr.${hex}`;
}

/**
 * POST de creación con `Idempotency-Key`. `replayed` refleja el header
 * `Idempotency-Replayed`: el backend devolvió la solicitud ya creada con esa key
 * (por ejemplo, tras un reintento por error de red) sin duplicarla ni consumir cuota.
 */
export async function createContactRequest(
  actorProfileId: string,
  body: CreateContactRequestInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Readonly<{ data: ContactRequest; replayed: boolean }>> {
  const response = await browserMutation(contactRequestsPath(actorProfileId), {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiError(response, "No pudimos enviar la solicitud.");
  const value: unknown = await response.json();
  if (!isContactRequestResponse(value)) {
    throw new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502, "invalid_response");
  }
  return { data: value.data, replayed: response.headers.get("idempotency-replayed") === "true" };
}

// --- Notificaciones (T19) ----------------------------------------------------------
// `safe_data` se trata como no confiable: el guard solo exige que sea un objeto y la
// vista lee únicamente claves conocidas como texto (nunca HTML).

export type AppNotification = components["schemas"]["Notification"];
export type NotificationType = AppNotification["type"];
export type NotificationPreference = components["schemas"]["NotificationPreferenceInput"];

export const NOTIFICATIONS_PER_PAGE = 20;

export function isNotification(value: unknown): value is AppNotification {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    typeof value.type === "string" &&
    isRecord(value.safe_data) &&
    isNullableString(value.read_at) &&
    typeof value.created_at === "string";
}

export function isNotificationResponse(value: unknown): value is { data: AppNotification } {
  return isRecord(value) && isNotification(value.data);
}

export function isNotificationsResponse(
  value: unknown,
): value is { data: AppNotification[]; meta: components["schemas"]["PaginationMeta"] } {
  return isRecord(value) && Array.isArray(value.data) && value.data.every(isNotification) && isPagination(value.meta);
}

export function notificationsPath(profileId: string, query = ""): string {
  const base = `/api/backend/v1/profiles/${profileId}/notifications`;
  return query ? `${base}?${query}` : base;
}

export function notificationReadPath(profileId: string, notificationId: string): string {
  return `${notificationsPath(profileId)}/${notificationId}/read`;
}

// --- Referencias (T20) -------------------------------------------------------------
// Texto libre entre las partes de un match aceptado, sin puntajes. El `body` se trata
// siempre como texto plano: ningún componente lo interpreta como HTML.

export type Reference = components["schemas"]["Reference"];
export type PublicReference = components["schemas"]["PublicReference"];
export type ReferenceVisibility = components["schemas"]["Visibility"];
export type CreateReferenceInput = components["schemas"]["CreateReferenceRequest"];
export type ReferenceVisibilityInput = components["schemas"]["ReferenceVisibilityRequest"];
export type ReferenceDirection = "authored" | "received";

export function isReferenceVisibility(value: unknown): value is ReferenceVisibility {
  return value === "hidden" || value === "visible";
}

export function isReference(value: unknown): value is Reference {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isPublicProfileId(value.contact_request_id) &&
    isSafeProfile(value.author) &&
    isSafeProfile(value.subject) &&
    typeof value.body === "string" &&
    isReferenceVisibility(value.visibility) &&
    typeof value.moderated === "boolean" &&
    isNullableString(value.moderation_reason) &&
    typeof value.created_at === "string";
}

export function isReferenceResponse(value: unknown): value is { data: Reference } {
  return isRecord(value) && isReference(value.data);
}

export function isReferencesResponse(
  value: unknown,
): value is { data: Reference[]; meta: components["schemas"]["PaginationMeta"] } {
  return isRecord(value) && Array.isArray(value.data) && value.data.every(isReference) && isPagination(value.meta);
}

export function referencesPath(profileId: string, query = ""): string {
  const base = `/api/backend/v1/profiles/${profileId}/references`;
  return query ? `${base}?${query}` : base;
}

export function referenceVisibilityPath(profileId: string, referenceId: string): string {
  return `${referencesPath(profileId)}/${referenceId}/visibility`;
}

export function contactRequestReferencesPath(profileId: string, requestId: string): string {
  return `${contactRequestPath(profileId, requestId)}/references`;
}

// --- Dashboard y ajustes de cuenta (T21) -------------------------------------------
// KPIs reales del perfil actor. El contrato enumera las claves, pero el guard acepta
// cualquier clave con un entero ≥ 0: una métrica nueva del backend no invalida el
// tablero y la UI muestra solo las que conoce.

export type DashboardMetricKey = components["schemas"]["DashboardMetric"]["key"];
export type Dashboard = Readonly<{
  profile_id: string;
  metrics: ReadonlyArray<Readonly<{ key: string; value: number }>>;
  capabilities: AccessEvaluation["capabilities"];
  access: AccessEvaluation;
}>;
export type UpdateAccountInput = components["schemas"]["UpdateAccountRequest"];
export type ChangeEmailInput = components["schemas"]["ChangeEmailRequest"];
export type ChangePasswordInput = components["schemas"]["ChangePasswordRequest"];

function isDashboardMetric(value: unknown): value is Readonly<{ key: string; value: number }> {
  return isRecord(value) && typeof value.key === "string" && isNonNegativeInteger(value.value);
}

export function isDashboardResponse(value: unknown): value is { data: Dashboard } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isPublicProfileId(data.profile_id) &&
    Array.isArray(data.metrics) && data.metrics.every(isDashboardMetric) &&
    isCapabilities(data.capabilities) &&
    isAccessResponse({ data: data.access });
}

export function dashboardPath(profileId: string): string {
  return `/api/backend/v1/profiles/${profileId}/dashboard`;
}

/** 202 de POST /me/change-email: el cambio queda pendiente de verificación. */
export function isAcceptedResponse(value: unknown): value is { data: { accepted: true } } {
  return isRecord(value) && isRecord(value.data) && value.data.accepted === true;
}

export function isMessageResponse(value: unknown): value is { data: { message: string } } {
  return isRecord(value) && isRecord(value.data) && typeof value.data.message === "string";
}
