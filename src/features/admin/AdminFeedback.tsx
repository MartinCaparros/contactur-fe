"use client";

import { useT } from "@/lib/i18n/LocaleProvider";

import type { AccessEffectiveState, DocumentStatus, ProfileStatus, UserStatus } from "./api";
import { accessStateLabel, documentStatusLabel, profileStatusLabel, userStatusLabel } from "./api";
import styles from "./AdminPanels.module.css";

type Tone = "active" | "warn" | "danger" | "muted";

/**
 * Un cambio aplicado y un listado refrescado son dos hechos distintos. `refreshed`
 * nunca se infiere del éxito de la mutación: lo escribe quien pudo releer el listado.
 */
export type MutationOutcome = Readonly<{ message: string; refreshed: boolean }>;

const TONE_GLYPHS: Readonly<Record<Tone, string>> = {
  active: "●",
  warn: "▲",
  danger: "■",
  muted: "○",
};

const ACCOUNT_TONES: Readonly<Record<UserStatus, Tone>> = {
  active: "active",
  suspended: "danger",
};

const PROFILE_TONES: Readonly<Record<ProfileStatus, Tone>> = {
  draft: "warn",
  published: "active",
  suspended: "danger",
};

const DOCUMENT_TONES: Readonly<Record<DocumentStatus, Tone>> = {
  pending: "warn",
  approved: "active",
  rejected: "danger",
};

const ACCESS_TONES: Readonly<Record<AccessEffectiveState, Tone>> = {
  inactive: "muted",
  active: "active",
  expired: "warn",
  suspended: "danger",
};

/**
 * El estado se comunica con prefijo textual además del color y del glifo, porque
 * `profile.status` y `access.effective_state` comparten la etiqueta "Suspendido" y
 * significan cosas distintas: uno es la ficha, el otro la habilitación.
 */
function StatePill({
  kind,
  prefix,
  value,
  tone,
}: Readonly<{ kind: string; prefix: string; value: string; tone: Tone }>) {
  return (
    <span className={styles.statePill} data-kind={kind} data-tone={tone}>
      <span aria-hidden="true">{TONE_GLYPHS[tone]}</span>
      {prefix}: {value}
    </span>
  );
}

export function AccountStatePill({ status }: Readonly<{ status: UserStatus }>) {
  const t = useT();
  return <StatePill kind="account" prefix={t("Cuenta")} value={userStatusLabel(status, t)} tone={ACCOUNT_TONES[status]} />;
}

export function ProfileStatePill({ status }: Readonly<{ status: ProfileStatus }>) {
  const t = useT();
  return <StatePill kind="profile" prefix={t("Perfil")} value={profileStatusLabel(status, t)} tone={PROFILE_TONES[status]} />;
}

export function AccessStatePill({ state }: Readonly<{ state: AccessEffectiveState }>) {
  const t = useT();
  return <StatePill kind="access" prefix={t("Acceso")} value={accessStateLabel(state, t)} tone={ACCESS_TONES[state]} />;
}

export function DocumentStatePill({ status }: Readonly<{ status: DocumentStatus }>) {
  const t = useT();
  return (
    <StatePill
      kind="document"
      prefix={t("Documento")}
      value={documentStatusLabel(status, t)}
      tone={DOCUMENT_TONES[status]}
    />
  );
}

export function PermissionNotice({ message }: Readonly<{ message: string }>) {
  const t = useT();
  return (
    <div className={styles.permissionNotice} role="alert">
      <strong>{t("No tenés permisos sobre esta información")}</strong>
      <p>
        {t("El backend respondió 403 para esta consulta administrativa. No es un listado vacío: los datos existen pero tu cuenta no puede leerlos. La autorización la decide el backend, no esta pantalla.")}
      </p>
      <p>{message}</p>
    </div>
  );
}

export function ListErrorNotice({
  title,
  message,
}: Readonly<{ title: string; message: string }>) {
  return (
    <div className={styles.errorNotice} role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function OutcomeNotice({
  outcome,
  retrying,
  onRetry,
}: Readonly<{ outcome: MutationOutcome | null; retrying: boolean; onRetry: () => void }>) {
  const t = useT();
  if (!outcome) return null;

  if (outcome.refreshed) {
    return (
      <div className={styles.statusNotice} role="status">
        <strong>{t("Cambio aplicado y listado actualizado")}</strong>
        <p>{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className={styles.statusNotice} role="status" data-partial="true">
      <strong>{t("Cambio aplicado; el listado no se pudo refrescar")}</strong>
      <p>{outcome.message}</p>
      <p>
        {t("El cambio quedó guardado y auditado en el backend. Lo único que falló fue volver a leer el listado, así que lo que ves debajo puede estar desactualizado. Reintentá la actualización; no repitas la acción.")}
      </p>
      <button type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? t("Actualizando…") : t("Reintentar actualización del listado")}
      </button>
    </div>
  );
}

export function CursorPagination({
  pageIndex,
  shown,
  total,
  hasNext,
  busy,
  onPrevious,
  onNext,
}: Readonly<{
  pageIndex: number;
  shown: number;
  total: number | null;
  hasNext: boolean;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  const t = useT();
  // Partes independientes de un mismo resumen, separadas por " · " igual que antes.
  const summary = [
    t("Página {page}", { page: pageIndex + 1 }),
    t("{count} registros en pantalla", { count: shown }),
    total === null ? null : t("{total} en total", { total }),
    hasNext ? null : t("última página"),
  ].filter((part): part is string => part !== null).join(" · ");

  return (
    <nav className={styles.pagination} aria-label={t("Paginación por cursor")}>
      <button type="button" onClick={onPrevious} disabled={busy || pageIndex === 0}>
        {t("Página anterior")}
      </button>
      <button type="button" onClick={onNext} disabled={busy || !hasNext}>
        {t("Página siguiente")}
      </button>
      <span aria-live="polite">{summary}</span>
    </nav>
  );
}
