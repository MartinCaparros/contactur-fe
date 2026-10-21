"use client";

import { type FormEvent, useRef, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { tk } from "@/lib/i18n/translate";

import {
  AdminDialog,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  ReasonField,
  reasonProblem,
} from "./AdminDialog";
import {
  type AdminDocumentEntry,
  type DocumentReviewAction,
  categoryLabel,
  documentValidityLabel,
} from "./api";
import styles from "./AdminPanels.module.css";

/**
 * Aprobar y rechazar son la misma operación del backend con cuerpos incompatibles:
 * el motivo es obligatorio al rechazar y está prohibido al aprobar. El diálogo refleja
 * esa asimetría mostrando el campo solo cuando corresponde, en lugar de pedir un dato
 * que el backend rechazaría con 422.
 */
export type DocumentReviewDialogProps = Readonly<{
  entry: AdminDocumentEntry;
  action: DocumentReviewAction;
  pending: boolean;
  /** `error.fields.rejection_reason` de un 422. */
  reasonError: string | null;
  conflictMessage: string | null;
  generalError: string | null;
  onSubmit: (rejectionReason: string | null) => void;
  onClose: () => void;
}>;

const APPROVE_DESCRIPTION = tk(
  "El documento queda aprobado y la verificación del perfil se recalcula con los documentos obligatorios aprobados y vigentes. No concede acceso: la habilitación depende del grant manual del perfil. Aprobar no admite motivo, así que no se envía ninguno.",
);

const REJECT_DESCRIPTION = tk(
  "El documento queda rechazado y deja de contar para la verificación del perfil. El titular puede cargar un reemplazo. Rechazar no suspende el perfil ni toca su grant de acceso.",
);

export function DocumentReviewDialog({
  entry,
  action,
  pending,
  reasonError,
  conflictMessage,
  generalError,
  onSubmit,
  onClose,
}: DocumentReviewDialogProps) {
  const t = useT();
  const locale = useLocale();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const rejecting = action === "reject";
  const activeReasonError = localError ?? reasonError;
  const document_ = entry.document;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rejecting) {
      onSubmit(null);
      return;
    }
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
      title={rejecting ? t("Rechazar el documento") : t("Aprobar el documento")}
      subject={`${document_.document_type.label} · ${document_.original_filename} · ${entry.profile.display_name} (${categoryLabel(entry.profile.category, t)})`}
      description={rejecting ? t(REJECT_DESCRIPTION) : t(APPROVE_DESCRIPTION)}
      pending={pending}
      conflictMessage={conflictMessage}
      generalError={generalError}
      initialFocusRef={rejecting ? textareaRef : undefined}
      onClose={onClose}
    >
      <p className={styles.dialogDescription}>
        {t("Vigencia declarada: {validity}.", { validity: documentValidityLabel(document_, locale) })}
      </p>

      <form onSubmit={submit} noValidate>
        {rejecting ? (
          <ReasonField
            label={t("Motivo del rechazo (obligatorio)")}
            hint={t("Lo lee el titular del perfil y queda en la auditoría. Entre {min} y {max} caracteres.", {
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
        ) : null}

        <div className={styles.dialogActions}>
          <button type="button" data-variant="ghost" onClick={onClose} disabled={pending}>
            {t("Cancelar")}
          </button>
          <button type="submit" data-variant={rejecting ? "danger" : undefined} disabled={pending}>
            {pending ? t("Aplicando…") : rejecting ? t("Rechazar documento") : t("Aprobar documento")}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
