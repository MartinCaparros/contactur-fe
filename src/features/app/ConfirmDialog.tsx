"use client";

import { type KeyboardEvent, useEffect, useId, useRef } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

import styles from "./Requests.module.css";

const FOCUSABLE_SELECTOR = "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]";

/**
 * Confirmación modal del área privada. Sigue el patrón de `AdminDialog` (foco
 * atrapado, `Escape`, foco devuelto al cerrar) sin importar estilos del backoffice:
 * acá no hay formulario, solo confirmar o volver. El foco inicial va a "Volver",
 * así un Enter accidental no ejecuta la acción.
 */
export function ConfirmDialog({
  title,
  subject,
  description,
  confirmLabel,
  tone = "default",
  pending,
  error,
  onConfirm,
  onClose,
}: Readonly<{
  title: string;
  subject: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}>) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
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
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p className={styles.dialogSubject}>{subject}</p>
        <p className={styles.dialogDescription} id={descriptionId}>{description}</p>
        {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} ref={cancelRef} onClick={onClose} disabled={pending}>
            {t("Volver")}
          </button>
          <button
            type="button"
            className={tone === "danger" ? styles.dangerButton : styles.confirmButton}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? t("Procesando…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
