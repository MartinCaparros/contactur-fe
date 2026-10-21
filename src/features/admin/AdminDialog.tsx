"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";

import { type Translate, translator } from "@/lib/i18n/translate";

import styles from "./AdminPanels.module.css";

const FOCUSABLE_SELECTOR = "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]";

/**
 * Cáscara común de los diálogos del backoffice: overlay, foco atrapado, `Escape`,
 * encabezado con sujeto y descripción, y los tres canales de error que ya usaban los
 * paneles de cuentas y perfiles. No conoce ningún campo: cada acción arma su propio
 * formulario como `children`. Se extrajo de `StatusChangeDialog` cuando la revisión
 * documental y la habilitación manual necesitaron más campos que solo el motivo, para
 * no duplicar el comportamiento modal en tres componentes.
 */
export type AdminDialogProps = Readonly<{
  /** Describe la acción, no el recurso. */
  title: string;
  /** Recurso afectado, ya legible para una persona. */
  subject: string;
  /** Qué hace y qué NO hace la acción. Se muestra antes del formulario. */
  description: string;
  /** Bloquea el cierre mientras la mutación está en vuelo. */
  pending: boolean;
  /** Conflicto de estado del recurso (409) con mensaje propio. */
  conflictMessage: string | null;
  /** Acción opcional del conflicto, por ejemplo recargar antes de reintentar. */
  conflictAction?: ReactNode;
  /** Cualquier otro fallo de la mutación. */
  generalError: string | null;
  /** Aviso informativo del diálogo, sin ser error. */
  notice?: string | null;
  /** Elemento que recibe el foco al abrir; por defecto el primero enfocable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `wide` deja respirar un formulario con varios campos sin cambiar la densidad. */
  size?: "default" | "wide";
  onClose: () => void;
  children: ReactNode;
}>;

export function AdminDialog({
  title,
  subject,
  description,
  pending,
  conflictMessage,
  conflictAction,
  generalError,
  notice = null,
  initialFocusRef,
  size = "default",
  onClose,
  children,
}: AdminDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const subjectId = `${baseId}-subject`;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const explicit = initialFocusRef?.current;
    if (explicit) {
      explicit.focus();
    } else {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }
    return () => previouslyFocused?.focus();
    // El foco inicial se resuelve una sola vez al abrir: reenfocar en cada render
    // pelearía con la navegación por teclado dentro del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!pending) onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const container = dialogRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && container.contains(active);

    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last?.focus();
      return;
    }
    if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className={styles.dialogOverlay}>
      <div
        className={styles.dialog}
        ref={dialogRef}
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subjectId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p className={styles.dialogSubject} id={subjectId}>{subject}</p>
        <p className={styles.dialogDescription}>{description}</p>

        {conflictMessage ? (
          <div className={styles.dialogConflict} role="alert">
            <p>{conflictMessage}</p>
            {conflictAction}
          </div>
        ) : null}
        {generalError ? (
          <p className={styles.dialogError} role="alert">{generalError}</p>
        ) : null}
        {notice ? (
          <p className={styles.dialogNotice} role="status">{notice}</p>
        ) : null}

        {children}
      </div>
    </div>
  );
}

export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 1000;

/**
 * Campo de motivo compartido por las tres mutaciones administrativas que lo exigen:
 * cambio de estado, rechazo documental y habilitación manual. El error del backend se
 * vincula por `aria-describedby` junto a la ayuda, no en un cartel suelto.
 */
export function ReasonField({
  label,
  hint,
  value,
  error,
  textareaRef,
  onChange,
}: Readonly<{
  label: string;
  hint: string;
  value: string;
  error: string | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}>) {
  const baseId = useId();
  const fieldId = `${baseId}-reason`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  return (
    <>
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        name="reason"
        ref={textareaRef}
        value={value}
        maxLength={REASON_MAX_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
      />
      <span className={styles.dialogHint} id={hintId}>{hint}</span>
      {error ? (
        <span className={styles.dialogError} id={errorId} role="alert">{error}</span>
      ) : null}
    </>
  );
}

/**
 * Validación local del motivo antes de gastar una mutación. Devuelve el mensaje de
 * error o `null`; el recorte lo hace quien envía, nunca el backend por nosotros.
 */
export function reasonProblem(reason: string, t: Translate = translator()): string | null {
  return reason.trim().length < REASON_MIN_LENGTH
    ? t("El motivo es obligatorio y necesita al menos {min} caracteres. No se acepta vacío ni solo espacios.", { min: REASON_MIN_LENGTH })
    : null;
}
