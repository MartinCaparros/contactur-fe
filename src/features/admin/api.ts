import {
  ApiRequestError,
  downloadProfileDocument,
  getBrowserJson,
  isAccessResponse,
  isCatalogsResponse,
  isDocument,
  isDocumentResponse,
  isOwnedProfileSummary,
  isProfile,
  isPublicProfileId,
  isReference,
  isReferenceResponse,
  mutateBrowserJson,
} from "@/features/app/api";
import type { components } from "@/lib/api/generated";
import { DEFAULT_LOCALE, intlLocale, type Locale } from "@/lib/i18n/config";
import { type Translate, tk, translate, translator } from "@/lib/i18n/translate";

export {
  ApiRequestError,
  downloadProfileDocument,
  getBrowserJson,
  isAccessResponse,
  isCatalogsResponse,
  isDocumentResponse,
  isPublicProfileId,
  isReferenceResponse,
  mutateBrowserJson,
};

export type AdminUser = components["schemas"]["AdminUser"];
export type AdminProfileEntry = components["schemas"]["AdminProfile"];
export type AdminDocumentEntry = components["schemas"]["AdminDocument"];
export type AdminMetrics = components["schemas"]["AdminMetrics"];
export type PaginationMeta = components["schemas"]["PaginationMeta"];
export type UserStatus = components["schemas"]["UserStatus"];
export type ProfileStatus = components["schemas"]["ProfileStatus"];
export type DocumentStatus = components["schemas"]["DocumentStatus"];
export type DocumentRecord = components["schemas"]["Document"];
export type DocumentTypeItem = components["schemas"]["DocumentType"];
export type AccessEffectiveState = components["schemas"]["AccessEffectiveState"];
export type AccessGrant = components["schemas"]["AccessGrant"];
export type AccessGrantStatus = components["schemas"]["AccessGrantStatus"];
export type AccessEvaluation = components["schemas"]["AccessEvaluation"];
export type ProfileCategory = components["schemas"]["ProfileCategory"];
export type City = components["schemas"]["City"];
export type AuditLog = components["schemas"]["AuditLog"];
export type AdminReferenceEntry = components["schemas"]["AdminReference"];
export type ReferenceRecord = components["schemas"]["Reference"];
export type AdminReferenceModerationInput = components["schemas"]["AdminReferenceModerationRequest"];
export type ReferenceModerationAction = AdminReferenceModerationInput["action"];
export type AdminUserStatusInput = components["schemas"]["AdminUserStatusRequest"];
export type AdminProfileStatusInput = components["schemas"]["AdminProfileStatusRequest"];
export type AdminDocumentReviewInput = components["schemas"]["AdminDocumentReviewRequest"];
export type AdminAccessGrantInput = components["schemas"]["AdminAccessGrantRequest"];
/** El contrato solo admite estas dos intenciones; `draft` no se puede pedir. */
export type ProfileStatusIntent = AdminProfileStatusInput["status"];
/** Las dos decisiones de revisión documental del contrato. */
export type DocumentReviewAction = "approve" | "reject";

type UnknownRecord = Record<string, unknown>;

/**
 * `per_page` del contrato admite hasta 50 y el backend responde 422 por encima.
 * 25 mantiene la densidad del shell sin acercarse al techo.
 */
export const ADMIN_PER_PAGE = 25;

const API_BASE = "/api/backend/v1";

export const USER_STATUSES = ["active", "suspended"] as const satisfies readonly UserStatus[];
export const PROFILE_STATUSES = ["draft", "published", "suspended"] as const satisfies readonly ProfileStatus[];
export const ACCESS_STATES = [
  "inactive",
  "active",
  "expired",
  "suspended",
] as const satisfies readonly AccessEffectiveState[];
export const ADMIN_CATEGORIES = [
  "tourism_company",
  "guide",
  "driver",
  "instructor",
  "transport_company",
] as const satisfies readonly ProfileCategory[];

/**
 * Los tres únicos estados documentales revisables del contrato. Los estados internos
 * que el backend usa al reemplazar o retirar una carga no se ofrecen como filtro:
 * no son decisiones de revisión y el backend responde 422 si llegan en `status`.
 */
export const DOCUMENT_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const satisfies readonly DocumentStatus[];

export const ACCESS_GRANT_STATUSES = [
  "inactive",
  "active",
  "suspended",
] as const satisfies readonly AccessGrantStatus[];

/**
 * Acciones que el backend emite hoy. La lista se ofrece como sugerencia del filtro,
 * no como enum cerrado: el campo acepta cualquier acción y el listado muestra las
 * que existan, aunque todavía no estén acá.
 */
export const AUDIT_ACTION_SUGGESTIONS = [
  "access_grant.replaced",
  "document.approved",
  "document.rejected",
  "document.uploaded",
  "document.retired",
  "user.suspended",
  "user.reactivated",
  "profile.suspended",
  "profile.restored",
  "avatar.replaced",
  "gallery.added",
  "gallery.deleted",
  "reference.hidden",
  "reference.restored",
] as const;

/** Tipos de destino que el backend escribe hoy en la auditoría. */
export const AUDIT_TARGET_TYPES = [
  "user",
  "profile",
  "profile_document",
  "profile_gallery",
  "reference",
] as const;

/**
 * Los rótulos son texto fuente en español (`tk`) y se traducen al pedirlos: cada
 * función recibe `t` como último parámetro opcional (por defecto español), así quien
 * ya las llamaba sin idioma sigue recibiendo el mismo texto.
 */
export const CATEGORY_LABELS: Readonly<Record<ProfileCategory, string>> = {
  tourism_company: tk("Empresa turística"),
  guide: tk("Guía"),
  driver: tk("Conductor"),
  instructor: tk("Instructor"),
  transport_company: tk("Empresa de transporte"),
};

const USER_STATUS_LABELS: Readonly<Record<UserStatus, string>> = {
  active: tk("Activa"),
  suspended: tk("Suspendida"),
};

const PROFILE_STATUS_LABELS: Readonly<Record<ProfileStatus, string>> = {
  draft: tk("Borrador"),
  published: tk("Publicado"),
  suspended: tk("Suspendido"),
};

const ACCESS_STATE_LABELS: Readonly<Record<AccessEffectiveState, string>> = {
  inactive: tk("Inactivo"),
  active: tk("Activo"),
  expired: tk("Vencido"),
  suspended: tk("Suspendido"),
};

const DOCUMENT_STATUS_LABELS: Readonly<Record<DocumentStatus, string>> = {
  pending: tk("Pendiente de revisión"),
  approved: tk("Aprobado"),
  rejected: tk("Rechazado"),
};

const ACCESS_GRANT_STATUS_LABELS: Readonly<Record<AccessGrantStatus, string>> = {
  inactive: tk("Inactivo"),
  active: tk("Activo"),
  suspended: tk("Suspendido"),
};

const AUDIT_TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  user: tk("Cuenta"),
  profile: tk("Perfil"),
  profile_document: tk("Documento de perfil"),
  profile_gallery: tk("Galería de perfil"),
  reference: tk("Referencia"),
};

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  "access_grant.replaced": tk("Habilitación manual reemplazada"),
  "document.approved": tk("Documento aprobado"),
  "document.rejected": tk("Documento rechazado"),
  "document.uploaded": tk("Documento cargado"),
  "document.retired": tk("Documento retirado"),
  "user.suspended": tk("Cuenta suspendida"),
  "user.reactivated": tk("Cuenta reactivada"),
  "profile.suspended": tk("Perfil suspendido"),
  "profile.restored": tk("Perfil restaurado"),
  "avatar.replaced": tk("Imagen principal reemplazada"),
  "gallery.added": tk("Imagen agregada a la galería"),
  "gallery.deleted": tk("Imagen eliminada de la galería"),
  "reference.hidden": tk("Referencia ocultada por moderación"),
  "reference.restored": tk("Referencia restaurada por moderación"),
};

export function userStatusLabel(status: UserStatus, t: Translate = translator()): string {
  return t(USER_STATUS_LABELS[status]);
}

export function documentStatusLabel(status: DocumentStatus, t: Translate = translator()): string {
  return t(DOCUMENT_STATUS_LABELS[status]);
}

export function accessGrantStatusLabel(status: AccessGrantStatus, t: Translate = translator()): string {
  return t(ACCESS_GRANT_STATUS_LABELS[status]);
}

export function profileStatusLabel(status: ProfileStatus, t: Translate = translator()): string {
  return t(PROFILE_STATUS_LABELS[status]);
}

export function accessStateLabel(state: AccessEffectiveState, t: Translate = translator()): string {
  return t(ACCESS_STATE_LABELS[state]);
}

export function categoryLabel(category: ProfileCategory, t: Translate = translator()): string {
  return t(CATEGORY_LABELS[category]);
}

function readableKey(key: string): string {
  return key.replaceAll("_", " ");
}

/** Rótulo traducido de un mapa libre, o `null` si la clave no está prevista. */
function knownLabel(labels: Readonly<Record<string, string>>, key: string, t: Translate): string | null {
  const label = labels[key];
  return label === undefined ? null : t(label);
}

/**
 * Los mapas de métricas llegan con claves `string`: el backend documenta que un valor
 * fuera del enum se agrega en lugar de descartarse. Se muestra la clave cruda antes que
 * ocultar un dato real.
 */
export function categoryKeyLabel(key: string, t: Translate = translator()): string {
  return knownLabel(CATEGORY_LABELS, key, t) ?? readableKey(key);
}

export function accessStateKeyLabel(key: string, t: Translate = translator()): string {
  return knownLabel(ACCESS_STATE_LABELS, key, t) ?? readableKey(key);
}

export function userStatusKeyLabel(key: string, t: Translate = translator()): string {
  return knownLabel(USER_STATUS_LABELS, key, t) ?? readableKey(key);
}

/**
 * La auditoría crece con cada etapa: `action` y `target_type` son cadenas libres del
 * backend. Cuando la clave todavía no tiene traducción se devuelve `null` y la UI
 * muestra el código crudo, en lugar de inventar una etiqueta o esconder el evento.
 */
export function auditActionLabel(action: string, t: Translate = translator()): string | null {
  return knownLabel(AUDIT_ACTION_LABELS, action, t);
}

export function auditTargetTypeLabel(targetType: string, t: Translate = translator()): string | null {
  return knownLabel(AUDIT_TARGET_TYPE_LABELS, targetType, t);
}

/** Claves de `safe_changes` y de cualquier mapa libre, legibles sin traducirlas. */
export function humanizeKey(key: string): string {
  return readableKey(key);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCounterMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isCount);
}

function isPaginationMeta(value: unknown): value is PaginationMeta {
  return isRecord(value) &&
    (value.next_cursor === null || typeof value.next_cursor === "string") &&
    isCount(value.per_page) &&
    (value.total === undefined || value.total === null || isCount(value.total));
}

export function isAdminUser(value: unknown): value is AdminUser {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    (value.email_verified_at === null || typeof value.email_verified_at === "string") &&
    (value.system_role === "user" || value.system_role === "admin") &&
    (value.status === "active" || value.status === "suspended") &&
    typeof value.created_at === "string" &&
    isCount(value.profile_count);
}

/**
 * `AccessEvaluation` no tiene un guard suelto exportado en `features/app/api`, así que
 * se reutiliza el del sobre `{ data }` en lugar de duplicar sus reglas acá.
 */
function isAccessEvaluation(value: unknown): boolean {
  return isAccessResponse({ data: value });
}

export function isAdminProfileEntry(value: unknown): value is AdminProfileEntry {
  return isRecord(value) &&
    isProfile(value.profile) &&
    isAdminUser(value.owner) &&
    isAccessEvaluation(value.access);
}

export function isAdminUserResponse(value: unknown): value is { data: AdminUser } {
  return isRecord(value) && isAdminUser(value.data);
}

export function isAdminUsersResponse(
  value: unknown,
): value is { data: AdminUser[]; meta: PaginationMeta } {
  return isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isAdminUser) &&
    isPaginationMeta(value.meta);
}

export function isAdminProfileResponse(value: unknown): value is { data: AdminProfileEntry } {
  return isRecord(value) && isAdminProfileEntry(value.data);
}

export function isAdminProfilesResponse(
  value: unknown,
): value is { data: AdminProfileEntry[]; meta: PaginationMeta } {
  return isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isAdminProfileEntry) &&
    isPaginationMeta(value.meta);
}

export function isAdminDocumentEntry(value: unknown): value is AdminDocumentEntry {
  return isRecord(value) &&
    isDocument(value.document) &&
    isOwnedProfileSummary(value.profile) &&
    isAdminUser(value.owner);
}

export function isAdminDocumentsResponse(
  value: unknown,
): value is { data: AdminDocumentEntry[]; meta: PaginationMeta } {
  return isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isAdminDocumentEntry) &&
    isPaginationMeta(value.meta);
}

/**
 * `safe_changes` es un objeto libre con allowlist del backend: su forma cambia por
 * acción, así que el guard solo verifica que sea un objeto y jamás exige claves.
 */
export function isAuditLog(value: unknown): value is AuditLog {
  return isRecord(value) &&
    isPublicProfileId(value.id) &&
    isPublicProfileId(value.actor_user_id) &&
    typeof value.target_type === "string" &&
    typeof value.target_id === "string" &&
    typeof value.action === "string" &&
    (value.reason === null || typeof value.reason === "string") &&
    isRecord(value.safe_changes) &&
    typeof value.request_id === "string" &&
    typeof value.created_at === "string";
}

export function isAuditLogsResponse(
  value: unknown,
): value is { data: AuditLog[]; meta: PaginationMeta } {
  return isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isAuditLog) &&
    isPaginationMeta(value.meta);
}

/** `AdminReference` = `Reference` + `moderated_at`; se reutiliza el guard de la app. */
export function isAdminReference(value: unknown): value is AdminReferenceEntry {
  return isRecord(value) &&
    (value.moderated_at === null || typeof value.moderated_at === "string") &&
    isReference(value);
}

export function isAdminReferencesResponse(
  value: unknown,
): value is { data: AdminReferenceEntry[]; meta: PaginationMeta } {
  return isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isAdminReference) &&
    isPaginationMeta(value.meta);
}

export function isAdminMetricsResponse(value: unknown): value is { data: AdminMetrics } {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return isCounterMap(data.users) &&
    isCounterMap(data.profiles_by_category) &&
    isCounterMap(data.profiles_by_access_state) &&
    isCount(data.documents_pending) &&
    isCounterMap(data.contact_requests_by_status) &&
    (data.support_inquiries_pending === null || isCount(data.support_inquiries_pending));
}

type QueryEntries = readonly (readonly [string, string | number | null | undefined])[];

export function adminQuery(entries: QueryEntries): string {
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "number" ? String(value) : value.trim();
    if (text === "") continue;
    search.set(key, text);
  }
  const query = search.toString();
  return query === "" ? "" : `?${query}`;
}

export type UsersFilters = Readonly<{
  q: string;
  status: "" | UserStatus;
  cursor: string | null;
}>;

export type ProfilesFilters = Readonly<{
  q: string;
  category: "" | ProfileCategory;
  status: "" | ProfileStatus;
  accessState: "" | AccessEffectiveState;
  cursor: string | null;
}>;

export type MetricsRange = Readonly<{ dateFrom: string; dateTo: string }>;

/**
 * `status` vacío no significa "todos": el backend responde solo la cola de
 * pendientes cuando el filtro no viaja, y la UI lo comunica así.
 */
export type DocumentsFilters = Readonly<{
  status: "" | DocumentStatus;
  category: "" | ProfileCategory;
  documentTypeId: string;
  cursor: string | null;
}>;

export type AuditFilters = Readonly<{
  action: string;
  targetType: string;
  dateFrom: string;
  dateTo: string;
  cursor: string | null;
}>;

/**
 * `moderated` vacío = todas. El perfil filtra por autor o destinatario y llega ya
 * validado como ULID: el backend responde 422 ante cualquier otra forma.
 */
export type ReferencesModerationFilter = "" | "true" | "false";

export type ReferencesFilters = Readonly<{
  moderated: ReferencesModerationFilter;
  profile: string;
  cursor: string | null;
}>;

export function adminUsersPath(filters: UsersFilters): string {
  return `${API_BASE}/admin/users${adminQuery([
    ["q", filters.q],
    ["status", filters.status],
    ["cursor", filters.cursor],
    ["per_page", ADMIN_PER_PAGE],
  ])}`;
}

export function adminProfilesPath(filters: ProfilesFilters): string {
  return `${API_BASE}/admin/profiles${adminQuery([
    ["q", filters.q],
    ["category", filters.category],
    ["status", filters.status],
    ["access_state", filters.accessState],
    ["cursor", filters.cursor],
    ["per_page", ADMIN_PER_PAGE],
  ])}`;
}

export function adminMetricsPath(range: MetricsRange): string {
  return `${API_BASE}/admin/metrics${adminQuery([
    ["date_from", range.dateFrom],
    ["date_to", range.dateTo],
  ])}`;
}

export function adminDocumentsPath(filters: DocumentsFilters): string {
  return `${API_BASE}/admin/documents${adminQuery([
    ["status", filters.status],
    ["category", filters.category],
    ["document_type_id", filters.documentTypeId],
    ["cursor", filters.cursor],
    ["per_page", ADMIN_PER_PAGE],
  ])}`;
}

export function adminAuditLogsPath(filters: AuditFilters): string {
  return `${API_BASE}/admin/audit-logs${adminQuery([
    ["action", filters.action],
    ["target_type", filters.targetType],
    ["date_from", filters.dateFrom],
    ["date_to", filters.dateTo],
    ["cursor", filters.cursor],
    ["per_page", ADMIN_PER_PAGE],
  ])}`;
}

export function adminReferencesPath(filters: ReferencesFilters): string {
  return `${API_BASE}/admin/references${adminQuery([
    ["moderated", filters.moderated],
    ["profile", filters.profile],
    ["cursor", filters.cursor],
    ["per_page", ADMIN_PER_PAGE],
  ])}`;
}

export function adminReferenceModeratePath(referenceId: string): string {
  return `${API_BASE}/admin/references/${referenceId}/moderate`;
}

export function adminUserStatusPath(userId: string): string {
  return `${API_BASE}/admin/users/${userId}/status`;
}

export function adminProfileStatusPath(profileId: string): string {
  return `${API_BASE}/admin/profiles/${profileId}/status`;
}

export function adminDocumentReviewPath(documentId: string): string {
  return `${API_BASE}/admin/documents/${documentId}/review`;
}

export function adminProfileAccessPath(profileId: string): string {
  return `${API_BASE}/admin/profiles/${profileId}/access`;
}

export const CATALOGS_PATH = `${API_BASE}/catalogs`;

export function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function fieldErrorFrom(reason: unknown, field: string): string | null {
  return reason instanceof ApiRequestError ? reason.fields[field]?.[0] ?? null : null;
}

export function isStatus(reason: unknown, status: number): boolean {
  return reason instanceof ApiRequestError && reason.status === status;
}

export function errorCodeFrom(reason: unknown): string | null {
  return reason instanceof ApiRequestError ? reason.code : null;
}

/**
 * Mismo patrón que `features/app`: un 401 vuelve al login conservando el destino
 * interno para retomar el backoffice después de autenticarse.
 */
export function redirectIfUnauthorized(reason: unknown): boolean {
  if (!isStatus(reason, 401)) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

export function redirectToUserShell(): void {
  window.location.replace("/app");
}

export function formatDateTime(value: string | null, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return translate(locale, "Sin fecha");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

/** `valid_until` del documento es una fecha sin hora: se muestra sin inventar una. */
export function formatDate(value: string | null, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return translate(locale, "Sin vencimiento");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

/** Vigencia declarada de un documento: la fecha (o "Sin vencimiento") y si rige hoy. */
export function documentValidityLabel(
  document: Pick<DocumentRecord, "valid_until" | "is_currently_valid">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const date = formatDate(document.valid_until, locale);
  if (document.valid_until === null) return date;
  const current = document.is_currently_valid
    ? translate(locale, "vigente")
    : translate(locale, "sin vigencia actual");
  return `${date} · ${current}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} kB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * D12 fija fechas de negocio en America/Argentina/Buenos_Aires y timestamps en UTC.
 * El grant manda `starts_at` y `expires_at` como fecha-hora UTC, así que el formulario
 * trabaja en hora local de negocio y convierte en los dos sentidos. El desplazamiento
 * se deriva de la zona para el instante concreto en lugar de fijarse a mano.
 */
const BUSINESS_TIMEZONE = "America/Argentina/Buenos_Aires";

const BUSINESS_WALL_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wallClock(instant: Date): string {
  const parts = Object.fromEntries(
    BUSINESS_WALL_CLOCK.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** ISO UTC del backend al valor de un `datetime-local` en hora de negocio. */
export function grantDateTimeToInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : wallClock(parsed);
}

/** Valor de un `datetime-local` en hora de negocio al ISO UTC que espera el backend. */
export function inputToGrantDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const asUtc = Date.parse(`${trimmed}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  const offset = asUtc - Date.parse(`${wallClock(new Date(asUtc))}:00Z`);
  return new Date(asUtc + offset).toISOString();
}

/** Muestra un timestamp del grant en hora de negocio, con la zona explícita. */
export function formatBusinessDateTime(value: string | null, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return translate(locale, "Sin fecha");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BUSINESS_TIMEZONE,
  }).format(parsed);
  return translate(locale, "{date} (hora de Argentina)", { date });
}
