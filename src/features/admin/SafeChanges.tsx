"use client";

import { useT } from "@/lib/i18n/LocaleProvider";

import { humanizeKey } from "./api";
import styles from "./AdminPanels.module.css";

/**
 * `safe_changes` es un objeto libre: el backend lo arma con una allowlist por acción,
 * así que su forma cambia según la acción y crece con cada etapa. Este renderizador no
 * conoce ninguna clave y no infiere significado: recorre lo que llegó y lo muestra con
 * la clave cruda humanizada. Si una acción nueva trae otra forma, se ve igual de bien
 * sin tocar la UI, y ningún dato se descarta por no estar previsto.
 *
 * La profundidad se acota para que un objeto anidado inesperado no derive en un árbol
 * de nodos arbitrariamente grande; a partir del tope se muestra el valor serializado.
 */
const MAX_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function SafeChangeValue({ value, depth }: Readonly<{ value: unknown; depth: number }>) {
  const t = useT();
  if (value === null) return <span className={styles.changeAbsent}>{t("sin valor")}</span>;
  if (typeof value === "boolean") return <span>{value ? t("sí") : t("no")}</span>;
  if (typeof value === "number") return <span>{value}</span>;
  if (typeof value === "string") {
    return value === ""
      ? <span className={styles.changeAbsent}>{t("texto vacío")}</span>
      : <span>{value}</span>;
  }

  if (depth >= MAX_DEPTH) return <span className={styles.changeRaw}>{JSON.stringify(value)}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.changeAbsent}>{t("lista vacía")}</span>;
    return (
      <ul className={styles.changeList}>
        {value.map((item, index) => (
          <li key={`${depth}-${index}`}>
            <SafeChangeValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className={styles.changeAbsent}>{t("sin datos")}</span>;
    return (
      <dl className={styles.changeTree}>
        {entries.map(([key, nested]) => (
          <div key={key}>
            <dt>{humanizeKey(key)}</dt>
            <dd><SafeChangeValue value={nested} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className={styles.changeRaw}>{String(value)}</span>;
}

export function SafeChanges({ changes }: Readonly<{ changes: Record<string, unknown> }>) {
  const t = useT();
  const entries = Object.entries(changes);
  if (entries.length === 0) {
    return <p className={styles.changeAbsent}>{t("El evento no registró cambios detallados.")}</p>;
  }
  return <SafeChangeValue value={changes} depth={0} />;
}
