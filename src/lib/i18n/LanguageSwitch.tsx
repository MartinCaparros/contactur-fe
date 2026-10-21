"use client";

import { LOCALES, LOCALE_NAMES, type Locale } from "./config";
import { useLocale, useSetLocale, useT } from "./LocaleProvider";
import styles from "./LanguageSwitch.module.css";

/**
 * Selector ES | EN de los headers (landing, app, backoffice y alta). Dos botones con
 * `aria-pressed`; cada uno se anuncia en su propio idioma ("Español", "English") con
 * `lang`. Cambiar el idioma no recarga la página. `onChange` permite a quien tiene
 * sesión guardarlo también en la cuenta.
 */
export function LanguageSwitch({
  className,
  onChange,
}: Readonly<{ className?: string; onChange?: (locale: Locale) => void }>) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();

  return (
    <div className={`${styles.switch} ${className ?? ""}`} role="group" aria-label={t("Idioma")}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          className={styles.option}
          aria-pressed={locale === option}
          // Nombre accesible "ES Español" / "EN English": empieza por el texto visible
          // (WCAG 2.5.3) y, con `lang`, cada idioma se anuncia con su pronunciación.
          aria-label={`${option.toUpperCase()} ${LOCALE_NAMES[option]}`}
          title={t("Cambiar el idioma a {language}", { language: LOCALE_NAMES[option] })}
          onClick={() => {
            if (option === locale) return;
            setLocale(option);
            onChange?.(option);
          }}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
