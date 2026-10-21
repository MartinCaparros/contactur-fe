"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  ACCOUNT_SUSPENDED_EVENT,
  type CurrentAccount,
  getBrowserJson as getAppBrowserJson,
  isCurrentAccountResponse,
} from "@/features/app/api";
import { useAccountLocale } from "@/features/app/accountLocale";
import { BrandMark } from "@/lib/brand/BrandMark";
import { browserMutation } from "@/lib/browser/auth";
import { browserTranslate } from "@/lib/i18n/browser";
import { LanguageSwitch } from "@/lib/i18n/LanguageSwitch";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tk } from "@/lib/i18n/translate";

import { AuditLogsPanel } from "./AuditLogsPanel";
import { DocumentsQueuePanel } from "./DocumentsQueuePanel";
import { MetricsPanel } from "./MetricsPanel";
import { ProfilesPanel } from "./ProfilesPanel";
import { ReferencesModerationPanel } from "./ReferencesModerationPanel";
import { UsersPanel } from "./UsersPanel";
import { messageFrom, redirectIfUnauthorized, redirectToUserShell } from "./api";
import styles from "./AdminShell.module.css";

export type AdminView = "dashboard" | "users" | "profiles" | "documents" | "references" | "audit-logs";

type AdminAccount = CurrentAccount["user"];

type GuardState =
  | { status: "loading" }
  | { status: "leaving" }
  | { status: "ready"; user: AdminAccount }
  | { status: "error"; message: string };

type NavigationItem = Readonly<{
  /** Texto fuente en español; se traduce al mostrarlo. */
  label: string;
  href: string;
  view: AdminView;
}>;

/**
 * Los seis destinos del backoffice están implementados contra endpoints reales. T20
 * sumó la moderación de referencias; T21 retiró el renderer de destinos pendientes
 * porque ya no queda ninguno.
 */
export const ADMIN_NAVIGATION: readonly NavigationItem[] = [
  { label: tk("Panel"), href: "/admin", view: "dashboard" },
  { label: tk("Cuentas"), href: "/admin/users", view: "users" },
  { label: tk("Perfiles"), href: "/admin/profiles", view: "profiles" },
  { label: tk("Documentos"), href: "/admin/documents", view: "documents" },
  { label: tk("Referencias"), href: "/admin/references", view: "references" },
  { label: tk("Auditoría"), href: "/admin/audit-logs", view: "audit-logs" },
];

function AdminNavigation({ view }: Readonly<{ view: AdminView }>) {
  const t = useT();
  return (
    <aside className={styles.sidebar} aria-label={t("Navegación del backoffice")}>
      <span className={styles.sidebarHeading}>{t("Administración")}</span>
      <nav>
        {ADMIN_NAVIGATION.map((item) => (
          <Link
            className={item.view === view ? styles.activeLink : undefined}
            href={item.href}
            key={item.href}
            aria-current={item.view === view ? "page" : undefined}
          >
            {t(item.label)}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function AdminBackoffice({ view }: Readonly<{ view: AdminView }>) {
  const t = useT();
  const [guard, setGuard] = useState<GuardState>({ status: "loading" });
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutStarted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    void getAppBrowserJson("/api/backend/v1/me", isCurrentAccountResponse, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted || logoutStarted.current) return;
        // Guard de experiencia, no de seguridad: evita mostrar un backoffice inútil a
        // quien no lo administra. La autorización real la aplica el backend, que
        // responde 403 en cada endpoint admin. Esta pantalla nunca asume permisos por
        // haber pasado este chequeo: cada panel trata el 403 como falta de permisos.
        if (data.user.system_role !== "admin") {
          setGuard({ status: "leaving" });
          redirectToUserShell();
          return;
        }
        setGuard({ status: "ready", user: data.user });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || logoutStarted.current) return;
        if (redirectIfUnauthorized(reason)) {
          setGuard({ status: "leaving" });
          return;
        }
        setGuard({ status: "error", message: messageFrom(reason, browserTranslate("No pudimos verificar tu cuenta.")) });
      });

    return () => controller.abort();
  }, []);

  /**
   * T23 (P27 en el backoffice): un 403 `account_suspended` de cualquier panel dispara
   * ACCOUNT_SUSPENDED_EVENT (desde `apiError`). Se re-consulta `/me`, que responde aun
   * suspendida, y el shell pasa a la vista restringida sin recargar. Si `/me` falla, el
   * backend ya informó la suspensión: se restringe igual, nunca se amplía un permiso.
   */
  useEffect(() => {
    let refresh: AbortController | null = null;
    const onSuspended = () => {
      if (logoutStarted.current) return;
      refresh?.abort();
      const controller = new AbortController();
      refresh = controller;
      void getAppBrowserJson("/api/backend/v1/me", isCurrentAccountResponse, controller.signal)
        .then(({ data }) => {
          if (controller.signal.aborted || logoutStarted.current) return;
          if (data.user.system_role !== "admin") {
            setGuard({ status: "leaving" });
            redirectToUserShell();
            return;
          }
          setGuard({ status: "ready", user: data.user });
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || logoutStarted.current) return;
          if (redirectIfUnauthorized(reason)) {
            setGuard({ status: "leaving" });
            return;
          }
          setGuard((current) => current.status === "ready"
            ? { status: "ready", user: { ...current.user, status: "suspended" } }
            : current);
        });
    };
    window.addEventListener(ACCOUNT_SUSPENDED_EVENT, onSuspended);
    return () => {
      window.removeEventListener(ACCOUNT_SUSPENDED_EVENT, onSuspended);
      refresh?.abort();
    };
  }, []);

  const logout = async () => {
    logoutStarted.current = true;
    setLogoutPending(true);
    try {
      const response = await browserMutation("/api/auth/logout");
      window.location.replace(response.ok ? "/" : "/?logout=local");
    } catch {
      window.location.replace("/?logout=local");
    }
  };

  const user = guard.status === "ready" ? guard.user : null;
  const suspended = user?.status === "suspended";
  const persistLocale = useAccountLocale(user);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label={t("Ir a Contactur")}>
          <BrandMark /> <span className={styles.brandWord}>Contactur</span>
        </Link>
        <span className={styles.scopeTag}>{t("Backoffice")}</span>
        <div className={styles.headerActions}>
          <LanguageSwitch onChange={user ? persistLocale : undefined} />
          {user ? <span className={styles.accountName}>{user.name}</span> : null}
          <button type="button" onClick={() => void logout()} disabled={logoutPending}>
            {logoutPending ? t("Cerrando…") : t("Cerrar sesión")}
          </button>
        </div>
      </header>

      {guard.status === "loading" ? (
        <main className={styles.centerState} role="status">{t("Verificando tu cuenta…")}</main>
      ) : null}

      {guard.status === "leaving" ? (
        <main className={styles.centerState} role="status">{t("Redirigiendo…")}</main>
      ) : null}

      {guard.status === "error" ? (
        <main className={styles.centerState}>
          <div className={styles.errorNotice} role="alert">
            <h1>{t("No pudimos abrir el backoffice")}</h1>
            <p>{guard.message}</p>
            {/* T23: la sesión sigue vigente ante un 5xx; reintentar es recargar la vista. */}
            <button className={`${styles.primaryAction} ${styles.retryAction}`} type="button" onClick={() => window.location.reload()}>
              {t("Reintentar")}
            </button>
          </div>
        </main>
      ) : null}

      {user && suspended ? (
        <main className={styles.centerState}>
          <div className={styles.restrictedNotice} role="alert">
            <p className={styles.eyebrow}>{t("Cuenta suspendida")}</p>
            <h1>{t("El backoffice está restringido")}</h1>
            <p>
              {t("Tu cuenta tiene rol de administración pero está suspendida, así que el backend rechaza toda consulta administrativa. Podés contactar soporte o cerrar la sesión.")}
            </p>
            <Link className={styles.primaryAction} href="/#contacto">{t("Contactar soporte")}</Link>
          </div>
        </main>
      ) : null}

      {user && !suspended ? (
        <div className={styles.layout}>
          <AdminNavigation view={view} />
          <main className={styles.mainContent}>
            {view === "dashboard" ? <MetricsPanel /> : null}
            {view === "users" ? <UsersPanel /> : null}
            {view === "profiles" ? <ProfilesPanel /> : null}
            {view === "documents" ? <DocumentsQueuePanel /> : null}
            {view === "references" ? <ReferencesModerationPanel /> : null}
            {view === "audit-logs" ? <AuditLogsPanel /> : null}
          </main>
        </div>
      ) : null}
    </div>
  );
}
