"use client";

import { type FormEvent, useRef, useState } from "react";

import { useT } from "@/lib/i18n/LocaleProvider";

import {
  AdminDialog,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  ReasonField,
  reasonProblem,
} from "./AdminDialog";
import styles from "./AdminPanels.module.css";

export { REASON_MAX_LENGTH, REASON_MIN_LENGTH };

export type StatusChangeDialogProps = Readonly<{
  /** Título del diálogo; describe la acción, no el recurso. */
  title: string;
  /** Recurso afectado, ya legible para una persona. */
  subject: string;
  /** Qué hace y qué NO hace la acción. Se muestra antes del motivo. */
  description: string;
  submitLabel: string;
  pending: boolean;
  /** Error de campo del backend (`error.fields.reason` de un 422). */
  reasonError: string | null;
  /** Conflicto de estado del recurso (409) con mensaje propio. */
  conflictMessage: string | null;
  /** Cualquier otro fallo de la mutación. */
  generalError: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}>;

export function StatusChangeDialog({
  title,
  subject,
  description,
  submitLabel,
  pending,
  reasonError,
  conflictMessage,
  generalError,
  onSubmit,
  onClose,
}: StatusChangeDialogProps) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // El error local de validación tiene prioridad sobre el del backend: es el que
  // corresponde al contenido que la persona tiene delante en este momento.
  const activeReasonError = localError ?? reasonError;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = reasonProblem(reason, t);
    if (problem) {
      setLocalError(problem);
      textareaRef.current?.focus();
      return;
    }
    setLocalError(null);
    onSubmit(reason.trim());
  };

  return (
    <AdminDialog
      title={title}
      subject={subject}
      description={description}
      pending={pending}
      conflictMessage={conflictMessage}
      generalError={generalError}
      initialFocusRef={textareaRef}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <ReasonField
          label={t("Motivo (obligatorio)")}
          hint={t("Queda registrado en la auditoría junto con el cambio de estado. Entre {min} y {max} caracteres.", {
            min: REASON_MIN_LENGTH,
            max: REASON_MAX_LENGTH,
          })}
          value={reason}
          error={activeReasonError}
          textareaRef={textareaRef}
          onChange={(value) => {
            setReason(value);
            if (localError) setLocalError(null);
          }}
        />

        <div className={styles.dialogActions}>
          <button type="button" data-variant="ghost" onClick={onClose} disabled={pending}>
            {t("Cancelar")}
          </button>
          <button type="submit" disabled={pending}>
            {pending ? t("Aplicando…") : submitLabel}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
