"use client";

import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import {
  ApiRequestError,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type CurrentAccount,
  type UpdateAccountInput,
  firstFieldError,
  isAcceptedResponse,
  isCurrentAccountResponse,
  isMessageResponse,
  mutateBrowserJson,
} from "./api";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { Translate } from "@/lib/i18n/translate";

import { EmailPreferences } from "./NotificationsView";
import directoryStyles from "./Directory.module.css";
import styles from "./Settings.module.css";

type FieldErrors = Readonly<Record<string, readonly string[]>>;

type FormState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "saving" }>
  | Readonly<{ status: "saved"; message: string }>
  | Readonly<{ status: "error"; message: string | null; fields: FieldErrors }>;

const NAME_MIN = 2;
const NAME_MAX = 120;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function redirectIfUnauthorized(reason: unknown): boolean {
  if (!(reason instanceof ApiRequestError) || reason.status !== 401) return false;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

/** Laravel cuenta caracteres (mb_strlen), no unidades UTF-16. */
function characters(value: string): number {
  return [...value].length;
}

function describedBy(...ids: ReadonlyArray<string | false | null | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

/**
 * Mensaje general de un envío fallido. `null` = los errores ya se muestran junto a
 * cada campo (422/409 con campo asociado).
 */
function generalErrorText(reason: unknown, fallback: string, t: Translate): string | null {
  if (!(reason instanceof ApiRequestError)) return t("No pudimos guardar por un problema de conexión. Probá de nuevo.");
  if (reason.status === 429) return t("Hiciste demasiados intentos seguidos. Esperá un momento y volvé a probar.");
  if (reason.status === 422 && Object.keys(reason.fields).length > 0) return null;
  if (reason.status === 422) return t("Revisá los datos del formulario.");
  if (reason.status === 403 && reason.code === "account_suspended") {
    return t("Tu cuenta está suspendida y no puede realizar esta acción.");
  }
  // El mensaje de Laravel ya llega en el idioma de la request; `fallback` ya viene traducido.
  return reason.message || fallback;
}

/** `fallback` llega traducido por quien llama (`t("…")` con literal, para la paridad). */
function errorState(reason: unknown, fallback: string, t: Translate, fields: FieldErrors = {}): FormState {
  const serverFields = reason instanceof ApiRequestError ? reason.fields : {};
  const merged = { ...serverFields, ...fields };
  const message = Object.keys(fields).length > 0 ? null : generalErrorText(reason, fallback, t);
  return { status: "error", message, fields: merged };
}

/** Lleva el foco al primer campo inválido después de un error (cliente o servidor). */
function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, state: FormState): void {
  useEffect(() => {
    if (state.status !== "error") return;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [formRef, state]);
}

function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function FieldError({ id, message }: Readonly<{ id: string; message: string | undefined }>) {
  return message ? <span id={id} className={directoryStyles.fieldError}>{message}</span> : null;
}

function FormFeedback({ state }: Readonly<{ state: FormState }>) {
  return (
    <>
      <p className={styles.success} role="status" aria-live="polite">
        {state.status === "saved" ? state.message : ""}
      </p>
      {state.status === "error" && state.message ? (
        <p className={directoryStyles.fieldError} role="alert">{state.message}</p>
      ) : null}
    </>
  );
}

/**
 * `/app/settings`: ajustes de la CUENTA (no del perfil activo): nombre, email,
 * contraseña y preferencias de correo se aplican a todos los perfiles. Cada envío
 * lo vuelve a validar Laravel; acá solo se evitan envíos obviamente inválidos.
 */
export function SettingsView({
  account,
  onAccountChange,
  onPasswordChanged,
}: Readonly<{
  account: CurrentAccount;
  onAccountChange: (account: CurrentAccount) => void;
  onPasswordChanged: () => Promise<void> | void;
}>) {
  const t = useT();
  return (
    <section className={directoryStyles.panel} aria-labelledby="settings-title">
      <p className={directoryStyles.eyebrow}>{t("Cuenta")}</p>
      <h1 id="settings-title">{t("Ajustes")}</h1>
      <p className={directoryStyles.lead}>
        {t("Estos ajustes son de tu cuenta y se aplican a todos tus perfiles, no solo al perfil activo.")}
      </p>
      <AccountDataForm account={account} onAccountChange={onAccountChange} />
      <ChangeEmailForm currentEmail={account.user.email} />
      <ChangePasswordForm email={account.user.email} onPasswordChanged={onPasswordChanged} />
      <EmailPreferences preferences={account.notification_preferences} onAccountChange={onAccountChange} />
    </section>
  );
}

function AccountDataForm({
  account,
  onAccountChange,
}: Readonly<{ account: CurrentAccount; onAccountChange: (account: CurrentAccount) => void }>) {
  const t = useT();
  const [name, setName] = useState(account.user.name);
  const [state, setState] = useState<FormState>({ status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useMounted();
  useFocusFirstInvalid(formRef, state);

  const fields = state.status === "error" ? state.fields : {};
  const nameError = firstFieldError(fields, "name");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status === "saving") return;
    const trimmed = name.trim();
    if (characters(trimmed) < NAME_MIN || characters(trimmed) > NAME_MAX) {
      setState({
        status: "error",
        message: null,
        fields: { name: [t("Ingresá un nombre de entre {min} y {max} caracteres.", { min: NAME_MIN, max: NAME_MAX })] },
      });
      return;
    }
    setState({ status: "saving" });
    try {
      const body: UpdateAccountInput = { name: trimmed };
      const response = await mutateBrowserJson("/api/backend/v1/me", "PATCH", body, isCurrentAccountResponse);
      if (!mounted.current) return;
      setName(response.data.user.name);
      onAccountChange(response.data);
      setState({ status: "saved", message: t("Guardamos el nombre de tu cuenta.") });
    } catch (reason) {
      if (!mounted.current || redirectIfUnauthorized(reason)) return;
      setState(errorState(reason, t("No pudimos guardar el nombre."), t));
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-account-title">
      <h2 id="settings-account-title">{t("Datos de la cuenta")}</h2>
      <dl className={styles.facts}>
        <div>
          <dt>{t("Email actual")}</dt>
          <dd>{account.user.email}</dd>
        </div>
        <div>
          <dt>{t("Verificación")}</dt>
          <dd>{account.user.email_verified_at ? t("Email verificado") : t("Email sin verificar")}</dd>
        </div>
      </dl>
      <p className={directoryStyles.hint}>{t("El email se cambia desde “Cambiar email” y se confirma con un enlace.")}</p>
      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        aria-label={t("Datos de la cuenta")}
        noValidate
      >
        <div className={directoryStyles.field}>
          <label htmlFor="settings-name">{t("Nombre")}</label>
          <input
            id="settings-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(nameError && "settings-name-error")}
            onChange={(event) => {
              setName(event.target.value);
              if (state.status === "saved") setState({ status: "idle" });
            }}
          />
          <FieldError id="settings-name-error" message={nameError} />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={directoryStyles.primaryButton} disabled={state.status === "saving"}>
            {state.status === "saving" ? t("Guardando…") : t("Guardar nombre")}
          </button>
        </div>
        <FormFeedback state={state} />
      </form>
    </section>
  );
}

function ChangeEmailForm({ currentEmail }: Readonly<{ currentEmail: string }>) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useMounted();
  useFocusFirstInvalid(formRef, state);

  const fields = state.status === "error" ? state.fields : {};
  const emailError = firstFieldError(fields, "email");
  const passwordError = firstFieldError(fields, "password");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status === "saving") return;
    const requested = email.trim();
    const clientFields: Record<string, string[]> = {};
    if (!requested) clientFields.email = [t("Ingresá el nuevo email.")];
    if (!password) clientFields.password = [t("Ingresá tu contraseña actual.")];
    if (Object.keys(clientFields).length > 0) {
      setState({ status: "error", message: null, fields: clientFields });
      return;
    }
    setState({ status: "saving" });
    try {
      const body: ChangeEmailInput = { email: requested, password };
      await mutateBrowserJson("/api/backend/v1/me/change-email", "POST", body, isAcceptedResponse);
      if (!mounted.current) return;
      setEmail("");
      setPassword("");
      setState({
        status: "saved",
        message: t(
          "Te enviamos un enlace a {email} para confirmar el cambio. Hasta entonces seguís usando {current}.",
          { email: requested, current: currentEmail },
        ),
      });
    } catch (reason) {
      if (!mounted.current || redirectIfUnauthorized(reason)) return;
      setPassword("");
      // 409: el email pedido es el actual o ya pertenece a otra cuenta (sin distinguir cuál).
      const conflict: FieldErrors = reason instanceof ApiRequestError && reason.status === 409
        ? { email: [t("Ese email no está disponible. Probá con otra dirección.")] }
        : {};
      setState(errorState(reason, t("No pudimos solicitar el cambio de email."), t, conflict));
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-email-title">
      <h2 id="settings-email-title">{t("Cambiar email")}</h2>
      <p className={directoryStyles.muted}>
        {t("Te enviamos un enlace al email nuevo. El cambio se aplica recién cuando lo confirmás; después avisamos al email anterior.")}
      </p>
      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        aria-label={t("Cambiar email")}
        noValidate
      >
        <div className={directoryStyles.field}>
          <label htmlFor="settings-new-email">{t("Nuevo email")}</label>
          <input
            id="settings-new-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={describedBy(emailError && "settings-new-email-error")}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id="settings-new-email-error" message={emailError} />
        </div>
        <div className={directoryStyles.field}>
          <label htmlFor="settings-email-password">{t("Contraseña actual")}</label>
          <input
            id="settings-email-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            value={password}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={describedBy("settings-email-password-hint", passwordError && "settings-email-password-error")}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id="settings-email-password-hint" className={directoryStyles.hint}>
            {t("La pedimos para confirmar que sos vos.")}
          </span>
          <FieldError id="settings-email-password-error" message={passwordError} />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={directoryStyles.primaryButton} disabled={state.status === "saving"}>
            {state.status === "saving" ? t("Enviando…") : t("Enviar enlace de confirmación")}
          </button>
        </div>
        <FormFeedback state={state} />
      </form>
    </section>
  );
}

function ChangePasswordForm({
  email,
  onPasswordChanged,
}: Readonly<{ email: string; onPasswordChanged: () => Promise<void> | void }>) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useMounted();
  useFocusFirstInvalid(formRef, state);

  const fields = state.status === "error" ? state.fields : {};
  const currentError = firstFieldError(fields, "current_password");
  const nextError = firstFieldError(fields, "new_password");
  const confirmationError = firstFieldError(fields, "new_password_confirmation");
  // Tras el éxito la sesión ya está revocada: el formulario queda cerrado hasta el redirect.
  const locked = state.status === "saving" || state.status === "saved";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return;
    const clientFields: Record<string, string[]> = {};
    if (!current) clientFields.current_password = [t("Ingresá tu contraseña actual.")];
    if (characters(next) < PASSWORD_MIN || characters(next) > PASSWORD_MAX) {
      clientFields.new_password = [
        t("La nueva contraseña debe tener entre {min} y {max} caracteres.", { min: PASSWORD_MIN, max: PASSWORD_MAX }),
      ];
    }
    if (confirmation !== next) {
      clientFields.new_password_confirmation = [t("La confirmación no coincide con la nueva contraseña.")];
    }
    if (Object.keys(clientFields).length > 0) {
      setState({ status: "error", message: null, fields: clientFields });
      return;
    }
    setState({ status: "saving" });
    try {
      const body: ChangePasswordInput = {
        current_password: current,
        new_password: next,
        new_password_confirmation: confirmation,
      };
      await mutateBrowserJson("/api/backend/v1/me/change-password", "POST", body, isMessageResponse);
      if (!mounted.current) return;
      setCurrent("");
      setNext("");
      setConfirmation("");
      setState({
        status: "saved",
        message: t(
          "Actualizamos tu contraseña. Por seguridad cerramos todas tus sesiones, incluida esta. Te llevamos a iniciar sesión con la contraseña nueva…",
        ),
      });
      await onPasswordChanged();
    } catch (reason) {
      if (!mounted.current || redirectIfUnauthorized(reason)) return;
      setCurrent("");
      setState(errorState(reason, t("No pudimos cambiar la contraseña."), t));
    }
  };

  return (
    <section className={styles.section} aria-labelledby="settings-password-title">
      <h2 id="settings-password-title">{t("Cambiar contraseña")}</h2>
      <p className={directoryStyles.muted}>
        {t("Al cambiarla cerramos todas tus sesiones abiertas, incluida esta, y tenés que volver a ingresar.")}
      </p>
      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => void submit(event)}
        aria-label={t("Cambiar contraseña")}
        noValidate
      >
        {/* Los gestores de contraseñas asocian el cambio a esta cuenta. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <div className={directoryStyles.field}>
          <label htmlFor="settings-current-password">{t("Contraseña actual")}</label>
          <input
            id="settings-current-password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            value={current}
            disabled={locked}
            aria-invalid={currentError ? true : undefined}
            aria-describedby={describedBy(currentError && "settings-current-password-error")}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <FieldError id="settings-current-password-error" message={currentError} />
        </div>
        <div className={directoryStyles.field}>
          <label htmlFor="settings-new-password">{t("Nueva contraseña")}</label>
          <input
            id="settings-new-password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={next}
            disabled={locked}
            aria-invalid={nextError ? true : undefined}
            aria-describedby={describedBy("settings-new-password-hint", nextError && "settings-new-password-error")}
            onChange={(event) => setNext(event.target.value)}
          />
          <span id="settings-new-password-hint" className={directoryStyles.hint}>
            {t("Entre {min} y {max} caracteres.", { min: PASSWORD_MIN, max: PASSWORD_MAX })}
          </span>
          <FieldError id="settings-new-password-error" message={nextError} />
        </div>
        <div className={directoryStyles.field}>
          <label htmlFor="settings-new-password-confirmation">{t("Repetí la nueva contraseña")}</label>
          <input
            id="settings-new-password-confirmation"
            name="new_password_confirmation"
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={confirmation}
            disabled={locked}
            aria-invalid={confirmationError ? true : undefined}
            aria-describedby={describedBy(confirmationError && "settings-new-password-confirmation-error")}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FieldError id="settings-new-password-confirmation-error" message={confirmationError} />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={directoryStyles.primaryButton} disabled={locked}>
            {state.status === "saving" ? t("Cambiando…") : t("Cambiar contraseña")}
          </button>
        </div>
        <FormFeedback state={state} />
      </form>
    </section>
  );
}
