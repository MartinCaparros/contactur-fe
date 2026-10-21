"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useLocale, useT } from "@/lib/i18n/LocaleProvider";

import { ApiRequestError, type City, availabilityPath, getBrowserJson, isAvailabilityResponse } from "./api";
import {
  type ServerDay,
  addDays,
  businessToday,
  cityCodes,
  longDateLabel,
  mondayIndex,
  monthOf,
  weekdayShortNames,
} from "./availabilityModel";
import styles from "./AvailabilityCalendar.module.css";

const MINI_DAYS = 14;

/** `message: null` = error sin mensaje propio; se muestra el texto genérico en el idioma activo. */
type MiniState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; days: ReadonlyMap<string, ServerDay> }>
  | Readonly<{ status: "error"; message: string | null }>;

/**
 * Resumen de solo lectura: los próximos 14 días desde mañana (fecha de negocio),
 * leídos del GET real del mes o de los dos meses que abarcan.
 */
export function AvailabilityMiniCalendar({ profileId, cities }: Readonly<{ profileId: string; cities: readonly City[] }>) {
  const t = useT();
  const locale = useLocale();
  const [start] = useState(() => addDays(businessToday(), 1));
  const codes = cityCodes(cities);
  const [state, setState] = useState<MiniState>({ status: "loading" });
  const dates = Array.from({ length: MINI_DAYS }, (_, index) => addDays(start, index));
  const monthsKey = [...new Set(dates.map(monthOf))].join(",");
  const weekdaysShort = weekdayShortNames(locale);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(monthsKey.split(",").map((month) => getBrowserJson(
      availabilityPath(profileId, month),
      isAvailabilityResponse,
      controller.signal,
    )))
      .then((responses) => {
        if (controller.signal.aborted) return;
        const days = new Map<string, ServerDay>();
        for (const { data } of responses) {
          for (const day of data.days) days.set(day.date, { available: day.available, city: day.city });
        }
        setState({ status: "ready", days });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiRequestError && reason.status === 401) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        setState({
          status: "error",
          message: reason instanceof Error && reason.message ? reason.message : null,
        });
      });
    return () => controller.abort();
  }, [profileId, monthsKey]);

  const available = state.status === "ready"
    ? dates.filter((date) => state.days.get(date)?.available === true).length
    : 0;

  return (
    <section className={styles.miniPanel} aria-labelledby="mini-availability-title" data-testid="mini-availability">
      <div className={styles.miniHeading}>
        <div>
          <p className={styles.eyebrow}>{t("Disponibilidad")}</p>
          <h2 id="mini-availability-title">{t("Próximos 14 días")}</h2>
        </div>
        <Link className={styles.secondaryLink} href={`/app/availability?profile=${encodeURIComponent(profileId)}`}>
          {t("Editar disponibilidad")}
        </Link>
      </div>

      {state.status === "loading" ? <p className={styles.miniSummary} aria-busy="true">{t("Cargando disponibilidad…")}</p> : null}
      {state.status === "error" ? (
        <p className={styles.miniError}>
          {t("No pudimos cargar la disponibilidad.")} {state.message ?? t("No pudimos cargar la disponibilidad.")}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p className={styles.miniSummary}>
            {available === 0
              ? t("Sin disponibilidad publicada en los próximos 14 días.")
              : t("{available} de {total} días disponibles desde mañana.", { available, total: MINI_DAYS })}
          </p>
          <ol className={styles.miniGrid} aria-label={t("Próximos 14 días desde mañana")}>
            {dates.map((date) => {
              const day = state.days.get(date);
              const isAvailable = day?.available === true;
              const cityName = day?.city?.name ?? null;
              return (
                <li key={date} data-date={date} data-state={isAvailable ? "available" : "blocked"}>
                  <span aria-hidden="true">{weekdaysShort[mondayIndex(date)]}</span>
                  <strong aria-hidden="true">{Number(date.slice(8, 10))}</strong>
                  <small aria-hidden="true">
                    {isAvailable
                      ? day?.city ? codes.get(day.city.id) ?? day.city.name.slice(0, 3).toLocaleUpperCase("es") : "✓"
                      : "—"}
                  </small>
                  <span className={styles.srOnly}>
                    {longDateLabel(date, locale)},{" "}
                    {isAvailable ? cityName ? t("disponible en {city}", { city: cityName }) : t("disponible") : t("bloqueado")}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </section>
  );
}
