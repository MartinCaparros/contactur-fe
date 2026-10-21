"use client";

import Link from "next/link";
import {
  type FormEvent,
  Fragment,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { BrandMark } from "@/lib/brand/BrandMark";
import { browserMutation, readBrowserApiError, type BrowserApiError } from "@/lib/browser/auth";
import type { Locale } from "@/lib/i18n/config";
import { LanguageSwitch } from "@/lib/i18n/LanguageSwitch";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { tk, type TranslateParams } from "@/lib/i18n/translate";
import { safeReturnTo } from "@/lib/bff/return-to";

import styles from "./LandingPage.module.css";

/*
 * Textos fuente en español (docs/i18n.md): las constantes de módulo se marcan con `tk()`
 * y se traducen al mostrarse con `t(...)`. Los mensajes de estado y error se guardan en
 * español y se traducen en el render, así cambiar de idioma también los traduce; los
 * mensajes que llegan de Laravel ya vienen en el idioma de la request y `t` los deja igual.
 */

const profiles = [
  {
    icon: "🏢",
    name: tk("Empresa turística"),
    tools: tk("Logotipo · Imágenes · Propuestas · Habilitaciones · Datos de empresa"),
  },
  {
    icon: "🧭",
    name: tk("Guía profesional"),
    tools: tk("Formación · Servicios · Disponibilidad · Ciudades · Habilitaciones"),
  },
  {
    icon: "🚗",
    name: tk("Conductor profesional"),
    tools: tk("Licencia · Permisos · Disponibilidad · Ciudades de operación"),
  },
  {
    icon: "🎿",
    name: tk("Instructor especializado"),
    tools: tk("Especialidad · Formación · Habilitaciones · Disponibilidad · Zona"),
  },
  {
    icon: "🚌",
    name: tk("Transporte de pasajeros"),
    tools: tk("Flota · Habilitaciones · Servicios · Disponibilidad · Cobertura"),
  },
] as const;

const features = [
  {
    icon: "📅",
    title: tk("Disponibilidad declarada"),
    text: tk("Los perfiles receptores parten de fechas bloqueadas y publican únicamente los días y ciudades en que pueden recibir solicitudes."),
  },
  {
    icon: "🔍",
    title: tk("Búsqueda precisa"),
    text: tk("La empresa turística filtra por perfil, ubicación, habilitaciones y rango de fechas para encontrar coincidencias relevantes."),
  },
  {
    icon: "✉️",
    title: tk("Solicitudes protegidas"),
    text: tk("Los datos de contacto no se exponen en el directorio. Primero se envía una solicitud y la contraparte decide si la acepta."),
  },
  {
    icon: "✓",
    title: tk("Verificación documental"),
    text: tk("La verificación depende de documentos aprobados y vigentes. Una carga pendiente nunca se presenta como verificada."),
  },
  {
    icon: "📍",
    title: tk("Cobertura por ciudad"),
    text: tk("Cada perfil informa dónde opera y, cuando corresponde, asocia una ciudad a cada día publicado."),
  },
  {
    icon: "🔐",
    title: tk("Acceso habilitado"),
    text: tk("Las capacidades se conceden manualmente por perfil y se muestran separadas del estado de verificación."),
  },
] as const;

const faqs = [
  {
    question: tk("¿Contactur es para turistas?"),
    answer: tk(
      "No. Contactur está pensado para empresas y profesionales del sector turístico. No es un portal de viajes para público general.",
    ),
  },
  {
    question: tk("¿Quién puede iniciar una solicitud?"),
    answer: tk(
      "Solo una empresa turística con acceso habilitado puede iniciar una solicitud hacia un perfil receptor. Aceptarla habilita la consulta de los datos declarados, pero no confirma una contratación ni reserva fechas.",
    ),
  },
  {
    question: tk("¿Cómo funciona la disponibilidad?"),
    answer: tk(
      "Guías, conductores, instructores y transportes parten de fechas bloqueadas y publican manualmente días futuros por ciudad. Las empresas turísticas buscan disponibilidad, pero no tienen calendario propio.",
    ),
  },
  {
    question: tk("¿Acceso activo significa perfil verificado?"),
    answer: tk(
      "No. Son estados independientes. El acceso define capacidades de uso; la verificación exige que la documentación requerida esté aprobada y vigente.",
    ),
  },
  {
    question: tk("¿Puedo administrar más de un perfil?"),
    answer: tk(
      "Sí. Una cuenta puede tener perfiles independientes para actividades distintas. Cada perfil conserva su categoría, acceso, solicitudes y notificaciones.",
    ),
  },
  {
    question: tk("¿Cómo se habilita un perfil nuevo?"),
    answer: tk(
      "Después de completar datos, documentos, revisión y términos, el perfil queda pendiente. La habilitación es manual y no se activa de forma automática.",
    ),
  },
] as const;

// Nombres de personas ficticias: son datos de la demo, no se traducen.
const demoResults = [
  ["🧭", "Lucía Álvarez", tk("Ushuaia · Naturaleza · documentación vigente")],
  ["🧭", "Tomás Pereyra", tk("Río Grande · Senderismo · documentación vigente")],
  ["🚗", "Marina Costa", tk("Ushuaia · Licencia habilitante vigente")],
] as const;

const demoTags = [
  tk("Naturaleza"),
  tk("Senderismo"),
  tk("Interpretación ambiental"),
  tk("Grupos reducidos"),
] as const;

/** Iniciales de lunes a domingo de los calendarios de demostración (decorativas, aria-hidden). */
const WEEKDAY_INITIALS: Readonly<Record<Locale, readonly string[]>> = {
  es: ["L", "M", "X", "J", "V", "S", "D"],
  en: ["M", "T", "W", "T", "F", "S", "S"],
};

/**
 * Título con saltos de línea: el texto traducido marca cada línea con "\n", así cada
 * idioma decide dónde cortar sin partir la frase en fragmentos sueltos.
 */
function Lines({ text }: Readonly<{ text: string }>) {
  return text.split("\n").map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <span className={styles.logo} aria-label="Contactur">
      <BrandMark />
      <span className={dark ? styles.logoTextDark : styles.logoTextLight}>
        Contac<span>tur</span>
      </span>
    </span>
  );
}

function Header({ onLogin }: { onLogin: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={styles.header}>
      <a className={styles.brandLink} href="#inicio" onClick={closeMenu}>
        <Logo />
      </a>
      <button
        className={styles.menuButton}
        type="button"
        aria-expanded={menuOpen}
        aria-controls="main-navigation"
        aria-label={menuOpen ? t("Cerrar navegación") : t("Abrir navegación")}
        onClick={() => setMenuOpen((current) => !current)}
      >
        {menuOpen ? "×" : "☰"}
      </button>
      <nav
        className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`}
        id="main-navigation"
        aria-label={t("Navegación principal")}
      >
        <a href="#quienes" onClick={closeMenu}>{t("Quiénes somos")}</a>
        <a href="#perfiles" onClick={closeMenu}>{t("Perfiles")}</a>
        <a href="#como-funciona" onClick={closeMenu}>{t("Cómo funciona")}</a>
        <a href="#acceso" onClick={closeMenu}>{t("Acceso")}</a>
        <a href="#faq" onClick={closeMenu}>{t("FAQ")}</a>
        <a href="#contacto" onClick={closeMenu}>{t("Contacto")}</a>
        {/* ≤1120 px el selector vive dentro del menú (en la barra no entra junto a las acciones). */}
        <LanguageSwitch className={styles.languageInMenu} />
      </nav>
      <div className={styles.navActions}>
        <LanguageSwitch className={styles.language} />
        <button className={styles.ghostButton} type="button" onClick={onLogin}>
          {t("Iniciar sesión")}
        </button>
        <a className={styles.blueButton} href="#onboarding">
          {t("Crear perfil")}
        </a>
      </div>
    </header>
  );
}

function Hero() {
  const t = useT();
  const [lead, accent, dim] = t("Conectá con\nprofesionales\ndel turismo").split("\n");

  return (
    <section className={styles.hero} id="inicio" aria-labelledby="hero-title">
      <div className={styles.heroNoise} />
      <div className={styles.heroGlow} />
      <div className={styles.heroGlowSecondary} />
      <div className={styles.heroInner}>
        <div className={styles.heroCopy}>
          <p className={styles.heroTag}>{t("Plataforma B2B · Turismo profesional")}</p>
          <h1 id="hero-title">
            {lead}<br />
            <span className={styles.accent}>{accent}</span><br />
            <span className={styles.dim}>{dim}</span>
          </h1>
          <p className={styles.heroDescription}>
            {t("Una herramienta para coordinar disponibilidad y solicitudes entre empresas, guías, conductores, instructores y transportes del sector turístico.")}
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#onboarding">{t("Crear mi perfil →")}</a>
            <a className={styles.outlineButton} href="#como-funciona">{t("Ver cómo funciona")}</a>
          </div>
        </div>
        <div className={styles.heroCards} aria-label={t("Perfiles de demostración")}>
          <span className={styles.demoLabel}>{t("Demostración")}</span>
          {profiles.map((profile, index) => (
            <article className={styles.heroCard} key={profile.name}>
              <span className={styles.heroCardIcon} aria-hidden="true">{profile.icon}</span>
              <div>
                <h2>{t(profile.name)}</h2>
                <p>{index === 0 ? t("Inicia búsquedas y solicitudes") : t("Perfil receptor de ejemplo")}</p>
              </div>
              <span className={index === 3 ? styles.statusPending : styles.statusActive}>
                {index === 3 ? t("En revisión") : t("Acceso activo")}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const t = useT();
  const locale = useLocale();
  // El idioma de la interfaz se muestra como código ("ES" / "EN").
  const stats = [
    ["5", t("Tipos de perfil")],
    ["B2B", t("Red profesional")],
    [locale.toUpperCase(), t("Interfaz actual")],
    [t("Manual"), t("Habilitación de acceso")],
  ] as const;

  return (
    <section className={styles.statsStrip} aria-label={t("Características de Contactur")}>
      {stats.map(([value, label]) => (
        <div className={styles.stat} key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}

function About() {
  const t = useT();

  return (
    <section className={styles.lightSection} id="quienes" aria-labelledby="about-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Quiénes somos")}</p>
        <h2 className={styles.sectionTitle} id="about-title">
          <Lines text={t("Una herramienta para\nel turismo profesional")} />
        </h2>
        <p className={styles.sectionDescription}>
          {t("Contactur no es una bolsa de trabajo ni un portal de viajes. Es un espacio para que actores del sector encuentren perfiles, coordinen disponibilidad y gestionen solicitudes con reglas claras.")}
        </p>
        <div className={styles.featuresGrid}>
          {features.map((feature) => (
            <article className={styles.featureCard} key={feature.title}>
              <span className={styles.featureIcon} aria-hidden="true">{feature.icon}</span>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.text)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Profiles() {
  const t = useT();

  return (
    <section className={`${styles.darkSection} ${styles.profilesSection}`} id="perfiles" aria-labelledby="profiles-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Perfiles disponibles")}</p>
        <h2 className={`${styles.sectionTitle} ${styles.lightTitle}`} id="profiles-title">
          <Lines text={t("Cinco perfiles,\nuna plataforma")} />
        </h2>
        <p className={`${styles.sectionDescription} ${styles.darkDescription}`}>
          {t("Cada categoría muestra herramientas acordes a su actividad. La empresa turística inicia búsquedas; los otros perfiles publican disponibilidad.")}
        </p>
        <div className={styles.profilesGrid}>
          {profiles.map((profile) => (
            <article className={styles.profileCard} key={profile.name}>
              <span className={styles.profileIcon} aria-hidden="true">{profile.icon}</span>
              <h3>{t(profile.name)}</h3>
              <p>{t(profile.tools)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function AvailabilityDemo() {
  const t = useT();
  const locale = useLocale();
  const [availableDays, setAvailableDays] = useState(() => new Set([5, 6, 9, 12, 13, 19, 20, 23, 26]));
  const [searched, setSearched] = useState(false);
  const days = Array.from({ length: 30 }, (_, index) => index + 1);

  const dayLabel = (day: number, isReference: boolean, isAvailable: boolean) => {
    if (isReference) return t("{day} de abril de 2027, día de referencia. Demostración", { day });
    return isAvailable
      ? t("{day} de abril de 2027, disponible. Demostración", { day })
      : t("{day} de abril de 2027, bloqueado. Demostración", { day });
  };

  const toggleDay = (day: number) => {
    setAvailableDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const submitDemoSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearched(true);
  };

  return (
    <section className={`${styles.darkSection} ${styles.calendarSection}`} id="como-funciona" aria-labelledby="availability-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Demostración · disponibilidad")}</p>
        <h2 className={`${styles.sectionTitle} ${styles.lightTitle}`} id="availability-title">
          <Lines text={t("Fechas bloqueadas\npor defecto")} />
        </h2>
        <p className={`${styles.sectionDescription} ${styles.darkDescription}`}>
          {t("Un perfil receptor habilita días futuros y la empresa turística consulta coincidencias. Esta interacción usa datos ficticios y no guarda cambios.")}
        </p>
        <div className={styles.calendarDemo}>
          <article className={styles.demoPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h3>🧭 {t("Perfil guía — Demostración")}</h3>
                <p>{t("Abril de 2027 · datos ficticios")}</p>
              </div>
              <span className={styles.demoPill}>{t("Demo")}</span>
            </div>
            <div className={styles.legend}>
              <span><i className={styles.legendBlocked} />{t("Bloqueado")}</span>
              <span><i className={styles.legendAvailable} />{t("Disponible")}</span>
              <span><i className={styles.legendReference} />{t("Referencia demo")}</span>
            </div>
            <div className={styles.calendarBody}>
              <div className={styles.monthNavigation}>
                <button type="button" aria-label={t("Mes anterior, demostración")} disabled>‹</button>
                <strong>{t("Abril 2027 · Demostración")}</strong>
                <button type="button" aria-label={t("Mes siguiente, demostración")} disabled>›</button>
              </div>
              <div className={styles.weekdays} aria-hidden="true">
                {WEEKDAY_INITIALS[locale].map((day, index) => <span key={index}>{day}</span>)}
              </div>
              <div className={styles.calendarDays}>
                {[0, 1, 2].map((empty) => <span key={`empty-${empty}`} aria-hidden="true" />)}
                {days.map((day) => {
                  const isReference = day === 12;
                  const isAvailable = availableDays.has(day);
                  return (
                    <button
                      className={`${styles.calendarDay} ${isReference ? styles.referenceDay : isAvailable ? styles.availableDay : styles.blockedDay}`}
                      type="button"
                      key={day}
                      aria-label={dayLabel(day, isReference, isAvailable)}
                      aria-pressed={isAvailable}
                      disabled={isReference}
                      onClick={() => toggleDay(day)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <p className={styles.demoNote}>
                {t("Interacción de demostración: los cambios son locales y no publican disponibilidad real.")}
              </p>
            </div>
          </article>

          <article className={styles.demoPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h3>🏢 {t("Empresa turística — Búsqueda")}</h3>
                <p>{t("Demostración con perfiles ficticios")}</p>
              </div>
              <span className={styles.demoPill}>{t("Demo")}</span>
            </div>
            <form className={styles.searchFilters} onSubmit={submitDemoSearch}>
              <label>
                {t("Tipo de perfil")}
                <select defaultValue="Guía profesional">
                  <option value="Guía profesional">{t("Guía profesional")}</option>
                  <option value="Conductor profesional">{t("Conductor profesional")}</option>
                  <option value="Instructor especializado">{t("Instructor especializado")}</option>
                  <option value="Transporte de pasajeros">{t("Transporte de pasajeros")}</option>
                </select>
              </label>
              <label>
                {t("Ciudad o destino")}
                <input type="text" defaultValue="Ushuaia" />
              </label>
              <div className={styles.searchDates}>
                {/* `key` por idioma: el valor inicial (una fecha de ejemplo) se vuelve a escribir al cambiar de idioma. */}
                <label>
                  {t("Desde · demo")}
                  <input key={locale} type="text" defaultValue={t("12 abr 2027")} />
                </label>
                <label>
                  {t("Hasta · demo")}
                  <input key={locale} type="text" defaultValue={t("18 abr 2027")} />
                </label>
              </div>
              <button className={styles.searchButton} type="submit">{t("Buscar en la demostración →")}</button>
              {searched ? (
                <p className={styles.inlineStatus} role="status">
                  {t("Demostración local: los filtros se aplicaron sobre datos ficticios.")}
                </p>
              ) : null}
            </form>
            <div className={styles.searchResults}>
              <p className={styles.resultsLabel}>{t("3 resultados ficticios · Demostración")}</p>
              {demoResults.map(([icon, name, description], resultIndex) => (
                <div className={styles.searchResult} key={name}>
                  <span className={styles.resultAvatar} aria-hidden="true">{icon}</span>
                  <div>
                    <strong>{name}</strong>
                    <span>{t(description)}</span>
                  </div>
                  <div className={styles.availabilityDots} aria-label={t("Disponibilidad ficticia de {name}", { name })}>
                    {[0, 1, 2, 3, 4].map((dot) => (
                      <i className={dot === resultIndex + 2 ? styles.dotOff : styles.dotOn} key={dot} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

const dashboardRows = [
  ["🧭", "Lucía Álvarez", tk("Ushuaia · Naturaleza"), tk("Guía")],
  ["🧭", "Tomás Pereyra", tk("Río Grande · Senderismo"), tk("Guía")],
  ["🚗", "Marina Costa", tk("Ushuaia · Traslados turísticos"), tk("Conductor")],
] as const;

function DashboardDemo() {
  const t = useT();

  return (
    <section className={styles.dashboardSection} aria-labelledby="dashboard-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Demostración · panel")}</p>
        <h2 className={styles.sectionTitle} id="dashboard-title">{t("Tu espacio de trabajo")}</h2>
        <p className={styles.sectionDescription}>
          {t("Vista conceptual del panel de una empresa turística. Todos los nombres, resultados y valores son ficticios.")}
        </p>
        <div className={styles.dashboardWindow}>
          <div className={styles.titleBar}>
            <div className={styles.windowDots} aria-hidden="true"><i /><i /><i /></div>
            <div className={styles.titleUrl}>contactur.local/app · {t("DEMOSTRACIÓN")}</div>
          </div>
          <div className={styles.dashboardLayout}>
            <aside className={styles.dashboardSidebar} aria-label={t("Navegación del panel de demostración")}>
              <div className={styles.sidebarProfile}>
                <span aria-hidden="true">🏢</span>
                <div><strong>Empresa Austral</strong><small>{t("Empresa · Acceso activo")}</small></div>
              </div>
              <ul>
                <li className={styles.activeMenu}>⌕ {t("Búsqueda")}</li>
                <li>✉ {t("Solicitudes")}</li>
                <li>◯ {t("Perfil")}</li>
                <li>✦ {t("Referencias")}</li>
                <li>◇ {t("Acceso")}</li>
                <li>⚙ {t("Ajustes")}</li>
              </ul>
            </aside>
            <div className={styles.dashboardMain}>
              <div className={styles.dashboardTopRow}>
                <div><h3>{t("Búsqueda de profesionales")}</h3><p>{t("Datos ficticios · Demostración")}</p></div>
                <span className={styles.fakeSearch}>⌕ {t("Guías en Ushuaia…")}</span>
              </div>
              <div className={styles.kpis} aria-label={t("Indicadores ficticios de demostración")}>
                <div><span>{t("Resultados demo")}</span><strong>24</strong><small>{t("Datos ficticios")}</small></div>
                <div><span>{t("Coincidencias demo")}</span><strong>11</strong><small>{t("Datos ficticios")}</small></div>
                <div><span>{t("Solicitudes demo")}</span><strong>3</strong><small>{t("Datos ficticios")}</small></div>
              </div>
              <div className={styles.resultsTable}>
                {dashboardRows.map(([icon, name, location, category]) => (
                  <div className={styles.resultRow} key={name}>
                    <span className={styles.tableAvatar} aria-hidden="true">{icon}</span>
                    <i className={styles.availableSignal} aria-label={t("Coincidencia disponible en la demostración")} />
                    <div><strong>{name}</strong><small>📍 {t("{location} · Perfil ficticio", { location: t(location) })}</small></div>
                    <span className={styles.categoryTag}>{t(category)}</span>
                    <a href="#ficha">{t("Ver ficha demo")}</a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.mobileNote}>
          <span aria-hidden="true">📱</span>
          <p><strong>{t("Responsive y accesible:")}</strong> {t("el panel reorganiza su contenido para mantener lectura, foco y acciones táctiles en pantallas pequeñas.")}</p>
        </div>
      </div>
    </section>
  );
}

function MiniCalendar() {
  const t = useT();
  const locale = useLocale();
  const available = new Set([5, 6, 9, 12, 13, 19, 20, 23, 26]);
  return (
    <div className={styles.miniCalendar} aria-label={t("Calendario ficticio de abril de 2027")}>
      {WEEKDAY_INITIALS[locale].map((day, index) => <span className={styles.miniHeading} key={index}>{day}</span>)}
      {[0, 1, 2].map((empty) => <span key={`mini-empty-${empty}`} />)}
      {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => (
        <span className={available.has(day) ? styles.miniAvailable : styles.miniBlocked} key={day}>{day}</span>
      ))}
    </div>
  );
}

function ProfileDemo() {
  const t = useT();

  return (
    <section className={`${styles.darkSection} ${styles.profileViewSection}`} id="ficha" aria-labelledby="profile-demo-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Demostración · ficha")}</p>
        <h2 className={`${styles.sectionTitle} ${styles.lightTitle}`} id="profile-demo-title">
          <Lines text={t("Información útil,\nestados claros")} />
        </h2>
        <p className={`${styles.sectionDescription} ${styles.darkDescription}`}>
          {t("Ejemplo ficticio de la información que un miembro habilitado podría consultar. No contiene datos personales reales.")}
        </p>
        <div className={styles.profileView}>
          <aside className={styles.profileSummary}>
            <div className={styles.profileIdentity}>
              <span className={styles.largeAvatar} aria-hidden="true">🧭</span>
              <h3>Lucía Álvarez</h3>
              <span className={styles.profileType}>{t("Guía profesional · Demo")}</span>
            </div>
            <dl className={styles.profileFacts}>
              <div><dt>{t("Ubicación")}</dt><dd>Ushuaia, TDF</dd></div>
              <div><dt>{t("Opera en")}</dt><dd>Ushuaia</dd></div>
              <div><dt>{t("Verificación")}</dt><dd className={styles.verifiedText}>{t("Verificado")}</dd></div>
              <div><dt>{t("Acceso")}</dt><dd className={styles.accessText}>{t("Acceso activo")}</dd></div>
              <div><dt>{t("Idioma")}</dt><dd>{t("Español")}</dd></div>
            </dl>
            <a className={styles.contactRequestButton} href="#onboarding">{t("Enviar solicitud de contacto")}</a>
            <p className={styles.restrictedNote}>{t("Acción ilustrativa: requiere empresa habilitada y no se envía desde esta landing.")}</p>
          </aside>
          <div className={styles.profileDetails}>
            <article>
              <h3>{t("Descripción profesional · Demostración")}</h3>
              <p>{t("Perfil ficticio especializado en interpretación ambiental y recorridos de naturaleza en Tierra del Fuego. El texto ilustra la estructura de una ficha, no acredita servicios realizados.")}</p>
            </article>
            <article>
              <h3>{t("Servicios declarados · Demostración")}</h3>
              <div className={styles.tags}>
                {demoTags.map((tag) => <span key={tag}>{t(tag)}</span>)}
              </div>
            </article>
            <article>
              <h3>{t("Formación y documentos · Demostración")}</h3>
              <div className={styles.tags}>
                <span className={styles.greenTag}>{t("Documento aprobado y vigente")}</span>
                <span className={styles.greenTag}>{t("Formación declarada")}</span>
              </div>
            </article>
            <article>
              <h3>{t("Disponibilidad · Abril 2027 · Demostración")}</h3>
              <MiniCalendar />
              <p className={styles.calendarCaption}>{t("Azul: disponible · Gris: bloqueado · Datos ficticios.")}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

const onboardingSteps = [
  {
    icon: "🎯",
    title: tk("Elegí una categoría"),
    description: tk("Definí la actividad del perfil para mostrar los campos correspondientes."),
    items: [tk("Empresa turística"), tk("Guía"), tk("Conductor"), tk("Instructor"), tk("Transporte")],
  },
  {
    icon: "▤",
    title: tk("Completá datos y cuenta"),
    description: tk("Cargá identidad, credenciales, actividad, ubicación y datos declarados."),
    items: [tk("Datos personales o de empresa"), tk("Email y contraseña"), tk("Servicios y ciudades"), tk("Foto o logotipo")],
  },
  {
    icon: "▧",
    title: tk("Cargá documentación"),
    description: tk("Adjuntá los documentos requeridos para que puedan revisarse."),
    items: [tk("Archivos por categoría"), tk("Estado inicial pendiente"), tk("Revisión administrativa"), tk("Motivo ante rechazo")],
  },
  {
    icon: "✓",
    title: tk("Revisión y términos"),
    description: tk("Revisá la información y aceptá los términos versionados antes de enviar."),
    items: [tk("Confirmación de datos"), tk("Aceptación registrada"), tk("Envío a revisión"), tk("Habilitación manual pendiente")],
  },
] as const;

function Onboarding() {
  const t = useT();

  return (
    <section className={styles.onboardingSection} id="onboarding" aria-labelledby="onboarding-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Proceso de alta")}</p>
        <h2 className={styles.sectionTitle} id="onboarding-title"><Lines text={t("Cuatro pasos y\nrevisión responsable")} /></h2>
        <p className={styles.sectionDescription}>
          {t("El alta es guiada. Al finalizar, el perfil queda pendiente de revisión y habilitación manual; completar el formulario no activa capacidades.")}
        </p>
        <div className={styles.onboardingFlow}>
          {onboardingSteps.map((step, index) => (
            <article className={styles.onboardingStep} key={step.title}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={styles.stepIcon} aria-hidden="true">{step.icon}</span>
              <h3>{t(step.title)}</h3>
              <p>{t(step.description)}</p>
              <ul>{step.items.map((item) => <li key={item}>{t(item)}</li>)}</ul>
            </article>
          ))}
        </div>
        <div className={styles.onboardingAction}>
          <p>{t("El flujo transaccional se integrará con el BFF en una etapa posterior.")}</p>
          <a className={styles.primaryButton} href="#contacto">{t("Consultar alta de perfil")}</a>
        </div>
      </div>
    </section>
  );
}

const accessCards = [
  {
    name: tk("Acceso inicial"),
    description: tk("Capacidades orientativas para comenzar con un perfil profesional."),
    items: [tk("Ficha visible a miembros habilitados"), tk("Búsqueda según categoría"), tk("Solicitudes con límite configurable"), tk("Una ciudad orientativa")],
    featured: false,
  },
  {
    name: tk("Acceso ampliado"),
    description: tk("Capacidades orientativas para perfiles con mayor cobertura operativa."),
    items: [tk("Más ciudades configurables"), tk("Galería cuando esté habilitada"), tk("Límite de solicitudes configurable"), tk("Estado de acceso independiente")],
    featured: true,
  },
  {
    name: tk("Acceso organización"),
    description: tk("Capacidades orientativas para empresas turísticas con más destinos."),
    items: [tk("Identidad visual del perfil"), tk("Cobertura configurable"), tk("Búsqueda y solicitudes"), tk("Soporte sobre habilitación")],
    featured: false,
  },
] as const;

function AccessCards() {
  const t = useT();

  return (
    <section className={styles.accessSection} id="acceso" aria-labelledby="access-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Acceso")}</p>
        <h2 className={styles.sectionTitle} id="access-title"><Lines text={t("Capacidades según\ncada necesidad")} /></h2>
        <p className={styles.sectionDescription}>
          {t("Estas tarjetas son informativas. Las capacidades definitivas se configuran por perfil y la habilitación siempre es manual.")}
        </p>
        <div className={styles.accessGrid}>
          {accessCards.map((card) => (
            <article className={`${styles.accessCard} ${card.featured ? styles.featuredAccess : ""}`} key={card.name}>
              {card.featured ? <span className={styles.orientativeBadge}>{t("Orientativo")}</span> : null}
              <h3>{t(card.name)}</h3>
              <p>{t(card.description)}</p>
              <ul>{card.items.map((item) => <li key={item}>{t(item)}</li>)}</ul>
              <a className={card.featured ? styles.primaryButton : styles.accessOutlineButton} href="#contacto">{t("Consultar acceso")}</a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const t = useT();
  const [openItem, setOpenItem] = useState<number | null>(0);

  return (
    <section className={styles.faqSection} id="faq" aria-labelledby="faq-title">
      <div className={styles.sectionWrap}>
        <p className={styles.sectionTag}>{t("Preguntas frecuentes")}</p>
        <h2 className={styles.sectionTitle} id="faq-title">{t("Todo lo que necesitás saber")}</h2>
        <div className={styles.faqList}>
          {faqs.map((faq, index) => {
            const open = openItem === index;
            const answerId = `faq-answer-${index}`;
            return (
              <article className={`${styles.faqItem} ${open ? styles.faqItemOpen : ""}`} key={faq.question}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={answerId}
                    onClick={() => setOpenItem(open ? null : index)}
                  >
                    <span>{t(faq.question)}</span>
                    <i aria-hidden="true">{open ? "−" : "+"}</i>
                  </button>
                </h3>
                <div className={styles.faqAnswer} id={answerId} hidden={!open}>
                  <p>{t(faq.answer)}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type ContactField = "name" | "email" | "category" | "message";
type ContactFieldErrors = Partial<Record<ContactField, string>>;
/** `message` es texto fuente en español (o el mensaje de Laravel) y se traduce al mostrarse. */
type ContactState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "error"; message: string; params?: TranslateParams; fields: ContactFieldErrors };

const CONTACT_FIELDS: readonly ContactField[] = ["name", "email", "category", "message"];
const CONTACT_UNAVAILABLE = tk("No pudimos enviar tu consulta. Intentá de nuevo en unos minutos.");

function isSupportInquiryAccepted(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "accepted" in value.data &&
    value.data.accepted === true;
}

function rateLimitedNotice(response: Response): { message: string; params?: TranslateParams } {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1
      ? { message: tk("Hiciste demasiados envíos seguidos. Esperá 1 minuto y volvé a intentar.") }
      : { message: tk("Hiciste demasiados envíos seguidos. Esperá {minutes} minutos y volvé a intentar."), params: { minutes } };
  }
  return { message: tk("Hiciste demasiados envíos seguidos. Esperá unos minutos y volvé a intentar.") };
}

/**
 * Formulario público de soporte (T19, R23). Envía de verdad por el BFF con CSRF y
 * solo confirma la recepción con un 202 del backend. `website` es un honeypot: queda
 * fuera de la vista y del árbol de accesibilidad y se envía tal cual (vacío para una
 * persona); si un bot lo completa, el backend responde 422 y acá no se explica por qué.
 */
function Contact() {
  const t = useT();
  const [state, setState] = useState<ContactState>({ status: "idle" });
  const sending = state.status === "sending";
  const fields: ContactFieldErrors = state.status === "error" ? state.fields : {};

  const fieldProps = (field: ContactField) => fields[field]
    ? { "aria-invalid": true as const, "aria-describedby": `contact-${field}-error` }
    : {};
  // Los errores por campo llegan de Laravel ya traducidos: se muestran tal cual.
  const fieldError = (field: ContactField) => fields[field]
    ? <p className={styles.contactFieldError} id={`contact-${field}-error`}>{fields[field]}</p>
    : null;

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const payload = new FormData(form);
    const category = String(payload.get("category") ?? "");
    const body = {
      name: String(payload.get("name") ?? "").trim(),
      email: String(payload.get("email") ?? "").trim(),
      category: category || null,
      message: String(payload.get("message") ?? "").trim(),
      website: String(payload.get("website") ?? ""),
    };
    setState({ status: "sending" });

    let response: Response;
    try {
      response = await browserMutation("/api/backend/v1/support-inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setState({ status: "error", message: CONTACT_UNAVAILABLE, fields: {} });
      return;
    }

    if (response.status === 202) {
      let accepted = false;
      try {
        accepted = isSupportInquiryAccepted(await response.json());
      } catch {
        accepted = false;
      }
      if (accepted) {
        form.reset();
        setState({ status: "sent" });
        return;
      }
      setState({ status: "error", message: CONTACT_UNAVAILABLE, fields: {} });
      return;
    }

    if (response.status === 429) {
      setState({ status: "error", ...rateLimitedNotice(response), fields: {} });
      return;
    }

    if (response.status === 422) {
      const apiError = await readBrowserApiError(response);
      const raw: unknown = apiError?.error.fields;
      const mapped: ContactFieldErrors = {};
      for (const field of CONTACT_FIELDS) {
        const messages: unknown = typeof raw === "object" && raw !== null && field in raw
          ? (raw as Record<string, unknown>)[field]
          : null;
        const message: unknown = Array.isArray(messages) ? messages[0] : null;
        if (typeof message === "string" && message) mapped[field] = message;
      }
      setState({
        status: "error",
        // Un error en `website` (honeypot) recibe el mensaje genérico, sin nombrar el campo.
        message: Object.keys(mapped).length > 0
          ? tk("Revisá los datos marcados en el formulario.")
          : tk("No pudimos procesar tu consulta. Revisá los datos e intentá de nuevo."),
        fields: mapped,
      });
      const first = CONTACT_FIELDS.find((field) => mapped[field]);
      const element = first ? form.elements.namedItem(first) : null;
      if (element instanceof HTMLElement) element.focus();
      return;
    }

    setState({ status: "error", message: CONTACT_UNAVAILABLE, fields: {} });
  };

  return (
    <section className={`${styles.darkSection} ${styles.contactSection}`} id="contacto" aria-labelledby="contact-title">
      <div className={`${styles.sectionWrap} ${styles.contactGrid}`}>
        <div>
          <p className={styles.sectionTag}>{t("Contacto")}</p>
          <h2 className={`${styles.sectionTitle} ${styles.lightTitle}`} id="contact-title">{t("¿Tenés alguna consulta?")}</h2>
          <p className={styles.contactDescription}>
            {t("Escribinos sobre acceso, alta de perfiles, privacidad o soporte general. Te respondemos por email a la dirección que indiques.")}
          </p>
          <div className={styles.contactChip}><span aria-hidden="true">✉</span>{t("Respuesta por email")}</div>
          <div className={styles.contactChip}><span aria-hidden="true">⌖</span>Argentina</div>
        </div>
        {/*
          noValidate (T19, hallado en E2E): sin él Chrome frena el envío con su globo nativo
          (en el idioma del navegador, p. ej. "Please lengthen this text…") y nunca llegan los
          errores en español con aria-invalid/aria-describedby. Valida Laravel, como en el resto
          de los formularios de la app; required/minLength quedan como pistas.
        */}
        <form
          className={styles.contactForm}
          onSubmit={(event) => void submitContact(event)}
          aria-labelledby="contact-title"
          aria-describedby="contact-form-status"
          aria-busy={sending}
          noValidate
        >
          <div className={styles.formRow}>
            <div className={styles.contactField}>
              <label>
                {t("Nombre")}
                <input name="name" type="text" autoComplete="name" required minLength={2} maxLength={120} placeholder={t("Tu nombre")} {...fieldProps("name")} />
              </label>
              {fieldError("name")}
            </div>
            <div className={styles.contactField}>
              <label>
                {t("Email")}
                <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder={t("tu@email.com")} {...fieldProps("email")} />
              </label>
              {fieldError("email")}
            </div>
          </div>
          <div className={styles.contactField}>
            <label>
              {t("Categoría (opcional)")}
              <select name="category" defaultValue="" {...fieldProps("category")}>
                <option value="">{t("Sin categoría")}</option>
                <option value="access">{t("Consulta de acceso")}</option>
                <option value="registration">{t("Alta de perfil")}</option>
                <option value="support">{t("Soporte general")}</option>
                <option value="privacy">{t("Privacidad o términos")}</option>
              </select>
            </label>
            {fieldError("category")}
          </div>
          <div className={styles.contactField}>
            <label>
              {t("Mensaje")}
              <textarea name="message" rows={4} required minLength={10} maxLength={5000} placeholder={t("Contanos tu consulta")} {...fieldProps("message")} />
            </label>
            {fieldError("message")}
          </div>
          {/* Honeypot: fuera de la vista y del árbol de accesibilidad, no se traduce. */}
          <label className={styles.honeypot} aria-hidden="true">
            Sitio web
            <input name="website" type="text" tabIndex={-1} autoComplete="off" />
          </label>
          <button className={styles.primaryButton} type="submit" disabled={sending}>
            {sending ? t("Enviando…") : t("Enviar consulta →")}
          </button>
          <p className={styles.formStatus} id="contact-form-status" role="status" aria-live="polite">
            {state.status === "sent"
              ? t("Recibimos tu consulta. Te vamos a responder por email.")
              : sending
                ? t("Enviando tu consulta…")
                : ""}
          </p>
          {state.status === "error" ? <p className={styles.contactError} role="alert">{t(state.message, state.params)}</p> : null}
        </form>
      </div>
    </section>
  );
}

function Footer() {
  const t = useT();

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div><Logo /><p>{t("Coordinación profesional para el ecosistema turístico, con acceso y verificación como estados independientes.")}</p></div>
        <div><h2>{t("Plataforma")}</h2><a href="#quienes">{t("Quiénes somos")}</a><a href="#como-funciona">{t("Cómo funciona")}</a><a href="#acceso">{t("Acceso")}</a></div>
        <div><h2>{t("Perfiles")}</h2><a href="#perfiles">{t("Empresas")}</a><a href="#perfiles">{t("Guías")}</a><a href="#perfiles">{t("Conductores")}</a><a href="#perfiles">{t("Instructores y transportes")}</a></div>
        <div><h2>{t("Soporte")}</h2><a href="#faq">{t("Preguntas frecuentes")}</a><a href="#contacto">{t("Contacto")}</a><a href="#contacto">{t("Solicitar términos")}</a><a href="#contacto">{t("Solicitar aviso de privacidad")}</a></div>
      </div>
      <div className={styles.footerBottom}>
        <span><i />© {new Date().getFullYear()} Contactur</span>
        {/* Indica el idioma activo de la interfaz: en inglés dice "Interface in English". */}
        <span>{t("Interfaz en español")}</span>
      </div>
    </footer>
  );
}

type AuthMode = "login" | "register" | "forgot-password" | "reset" | "verify";

type AuthLinkData = Readonly<{
  token: string | null;
  email: string;
}>;

type AuthState = Readonly<{
  mode: AuthMode;
  link: AuthLinkData;
}>;

const EMPTY_AUTH_LINK: AuthLinkData = { token: null, email: "" };

type AuthModalProps = {
  mode: AuthMode | null;
  link: AuthLinkData;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
};

const AUTH_TITLES: Record<AuthMode, { title: string; description: string }> = {
  login: {
    title: tk("Bienvenido"),
    description: tk("Iniciá sesión con tu cuenta de Contactur."),
  },
  register: {
    title: tk("Crear una cuenta"),
    description: tk("El alta crea tu cuenta. No crea perfiles ni concede acceso automáticamente."),
  },
  "forgot-password": {
    title: tk("Recuperar contraseña"),
    description: tk("Te enviaremos instrucciones si el email corresponde a una cuenta."),
  },
  reset: {
    title: tk("Nueva contraseña"),
    description: tk("Elegí una contraseña nueva para cerrar las sesiones anteriores."),
  },
  verify: {
    title: tk("Verificar correo"),
    description: tk("Estamos validando el enlace de verificación."),
  },
};

function jsonBody(value: Record<string, string>) {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

function replaceBrowserUrl(url: URL): void {
  const query = url.searchParams.toString();
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
  );
}

type AuthField = "name" | "email" | "password" | "password_confirmation";
type AuthFieldErrors = Partial<Record<AuthField, string>>;
type AuthFormMode = "login" | "register" | "forgot-password" | "reset";

const AUTH_FIELDS: readonly AuthField[] = ["name", "email", "password", "password_confirmation"];
const AUTH_PASSWORD_MIN_LENGTH = 12;
const AUTH_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTH_FIELDS_SUMMARY = tk("Revisá los datos marcados en el formulario.");

/**
 * Validación de cortesía (T23, P28). Sin `noValidate` Chrome frenaba el envío con su
 * globo nativo, en el idioma del navegador y sin asociarse al campo. Acá se aplican las
 * mismas reglas que valida Laravel para mostrar el error en el idioma de la interfaz junto
 * a cada campo; el servidor sigue siendo la fuente de verdad y sus 422 se muestran de la
 * misma forma. En login no se informa la política de contraseñas: solo que falta completarla.
 * Devuelve textos fuente (`tk`); el modal los traduce al mostrarlos.
 */
function validateAuthFields(mode: AuthFormMode, form: FormData): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const text = (field: AuthField) => String(form.get(field) ?? "");

  if (mode === "register") {
    const name = text("name").trim();
    if (!name) errors.name = tk("Ingresá tu nombre.");
    else if (name.length < 2) errors.name = tk("El nombre debe tener al menos 2 caracteres.");
  }

  const email = text("email").trim();
  if (!email) errors.email = tk("Ingresá tu email.");
  else if (!AUTH_EMAIL_PATTERN.test(email)) errors.email = tk("Ingresá un email válido, por ejemplo nombre@dominio.com.");
  if (mode === "forgot-password") return errors;

  const password = text("password");
  if (mode === "login") {
    if (!password) errors.password = tk("Ingresá tu contraseña.");
    return errors;
  }
  if (!password) errors.password = tk("Elegí una contraseña de al menos 12 caracteres.");
  else if (password.length < AUTH_PASSWORD_MIN_LENGTH) errors.password = tk("La contraseña debe tener al menos 12 caracteres.");

  const confirmation = text("password_confirmation");
  if (!confirmation) errors.password_confirmation = tk("Repetí la contraseña.");
  else if (confirmation !== password) errors.password_confirmation = tk("Las contraseñas no coinciden.");
  return errors;
}

/** Primer mensaje por campo de un 422 del backend (`error.fields`), solo para campos del formulario. */
function authFieldsFromApiError(apiError: BrowserApiError | null): AuthFieldErrors {
  const raw: unknown = apiError?.error.fields;
  const mapped: AuthFieldErrors = {};
  if (typeof raw !== "object" || raw === null) return mapped;
  for (const field of AUTH_FIELDS) {
    const messages: unknown = (raw as Record<string, unknown>)[field];
    const message: unknown = Array.isArray(messages) ? messages[0] : null;
    if (typeof message === "string" && message) mapped[field] = message;
  }
  return mapped;
}

/**
 * `error`, `status` y los errores por campo guardan el texto fuente en español (o el
 * mensaje de Laravel, que ya llega en el idioma de la request) y se traducen al mostrarse.
 */
function AuthModal({ mode, link, onClose, onModeChange }: AuthModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const verificationRequest = useRef<{
    token: string;
    promise: Promise<{ error: string } | { status: string }>;
  } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const focusAfterErrors = useRef<AuthField | null>(null);

  // El foco va al primer campo inválido después del render que le agrega
  // aria-invalid/aria-describedby, para que el lector lea el error al llegar.
  useEffect(() => {
    const field = focusAfterErrors.current;
    if (!field) return;
    focusAfterErrors.current = null;
    dialogRef.current?.querySelector<HTMLElement>(`form [name="${field}"]`)?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!mode) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Foco inicial en el primer campo, salvo que el foco ya esté dentro del diálogo
    // (T23): si alguien tipea o envía antes de este frame, no se le mueve el foco ni se
    // pisa el foco del primer campo inválido.
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      dialog.querySelector<HTMLElement>("[data-auth-focus]")?.focus();
    });

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [mode, onClose]);

  useEffect(() => {
    if (mode !== "verify") return;

    let active = true;
    const token = link.token;
    if (!token) {
      queueMicrotask(() => {
        if (active) setError(tk("El enlace de verificación no es válido."));
      });
      return () => {
        active = false;
      };
    }

    if (verificationRequest.current?.token !== token) {
      verificationRequest.current = {
        token,
        promise: (async () => {
          try {
            const response = await browserMutation(
              "/api/auth/email/verify",
              jsonBody({ token }),
            );
            if (response.ok) {
              return { status: tk("Tu correo quedó verificado. Ya podés iniciar sesión.") };
            }
            const apiError = await readBrowserApiError(response);
            return {
              error: apiError?.error.message ?? tk("No pudimos verificar el correo."),
            };
          } catch {
            return { error: tk("No pudimos verificar el correo.") };
          }
        })(),
      };
    }

    const request = verificationRequest.current.promise;
    queueMicrotask(() => {
      if (active) setPending(true);
    });
    void request
      .then((result) => {
        if (!active) return;
        if ("status" in result) setStatus(result.status);
        else setError(result.error);
      })
      .finally(() => {
        if (active) setPending(false);
      });

    return () => {
      active = false;
    };
  }, [link.token, mode]);

  if (!mode) return null;
  const content = AUTH_TITLES[mode];

  /** Muestra los errores por campo y enfoca el primero; `false` si no hay ninguno. */
  const showFieldErrors = (errors: AuthFieldErrors, summary = AUTH_FIELDS_SUMMARY): boolean => {
    const first = AUTH_FIELDS.find((field) => errors[field]);
    setFieldErrors(errors);
    if (!first) return false;
    focusAfterErrors.current = first;
    setError(summary);
    return true;
  };

  const fieldProps = (field: AuthField, id: string) => fieldErrors[field]
    ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` }
    : {};
  const fieldError = (field: AuthField, id: string) => {
    const message = fieldErrors[field];
    return message ? <p className={styles.authFieldError} id={`${id}-error`}>{t(message)}</p> : null;
  };
  /** Editar un campo retira su error: el resto queda hasta el próximo envío. */
  const clearFieldError = (event: FormEvent<HTMLFormElement>) => {
    const name = (event.target as HTMLInputElement).name as AuthField;
    if (!fieldErrors[name]) return;
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (showFieldErrors(validateAuthFields("login", form))) return;
    setPending(true);
    try {
      const response = await browserMutation(
        "/api/auth/login",
        jsonBody({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      );
      if (!response.ok) {
        setError(tk("No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente."));
        return;
      }
      const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      window.location.assign(returnTo);
    } catch {
      setError(tk("No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente."));
    } finally {
      setPending(false);
    }
  };

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (showFieldErrors(validateAuthFields("register", form))) return;
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");

    setPending(true);
    try {
      const response = await browserMutation(
        "/api/auth/register",
        jsonBody({
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
          password_confirmation: confirmation,
        }),
      );
      if (!response.ok) {
        const apiError = await readBrowserApiError(response);
        if (response.status === 422 && showFieldErrors(authFieldsFromApiError(apiError))) return;
        setError(apiError?.error.message ?? tk("No pudimos crear la cuenta. Revisá los datos."));
        return;
      }
      setRegistrationComplete(true);
    } catch {
      setError(tk("No pudimos crear la cuenta. Intentá nuevamente."));
    } finally {
      setPending(false);
    }
  };

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (showFieldErrors(validateAuthFields("forgot-password", form))) return;
    setPending(true);
    try {
      const response = await browserMutation(
        "/api/auth/forgot-password",
        jsonBody({ email: String(form.get("email") ?? "") }),
      );
      if (!response.ok) {
        setError(tk("No pudimos enviar las instrucciones. Intentá nuevamente más tarde."));
        return;
      }
      setRecoveryComplete(true);
    } catch {
      setError(tk("No pudimos enviar las instrucciones. Intentá nuevamente más tarde."));
    } finally {
      setPending(false);
    }
  };

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (showFieldErrors(validateAuthFields("reset", form))) return;
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");

    setPending(true);
    try {
      const response = await browserMutation(
        "/api/auth/reset-password",
        jsonBody({
          token: link.token ?? "",
          email: String(form.get("email") ?? ""),
          password,
          password_confirmation: confirmation,
        }),
      );
      if (!response.ok) {
        const apiError = await readBrowserApiError(response);
        if (response.status === 422 && showFieldErrors(authFieldsFromApiError(apiError))) return;
        setError(apiError?.error.message ?? tk("No pudimos restablecer la contraseña."));
        return;
      }
      setStatus(tk("Contraseña actualizada. Las sesiones anteriores fueron cerradas."));
    } catch {
      setError(tk("No pudimos restablecer la contraseña."));
    } finally {
      setPending(false);
    }
  };

  const resendVerification = async () => {
    setPending(true);
    setError("");
    try {
      const response = await browserMutation("/api/auth/email/resend");
      setStatus(
        response.ok
          ? tk("Enviamos un nuevo correo de verificación.")
          : tk("No pudimos reenviar el correo en este momento."),
      );
    } catch {
      setStatus(tk("No pudimos reenviar el correo en este momento."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        aria-describedby="auth-description"
      >
        <button className={styles.modalClose} type="button" aria-label={t("Cerrar inicio de sesión")} onClick={onClose}>×</button>
        <Logo />
        <h2 id="auth-title">{t(content.title)}</h2>
        <p id="auth-description">{t(content.description)}</p>

        {mode === "login" ? (
          <>
            <form onSubmit={submitLogin} onChange={clearFieldError} noValidate>
              <label htmlFor="login-email">{t("Email")}</label>
              <input data-auth-focus id="login-email" name="email" type="email" autoComplete="email" required placeholder={t("tu@email.com")} {...fieldProps("email", "login-email")} />
              {fieldError("email", "login-email")}
              <label htmlFor="login-password">{t("Contraseña")}</label>
              <input id="login-password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" {...fieldProps("password", "login-password")} />
              {fieldError("password", "login-password")}
              {error ? <p className={styles.loginError} role="alert">{t(error)}</p> : null}
              <button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? t("Ingresando…") : t("Iniciar sesión →")}</button>
            </form>
            <Link className={styles.recoveryLink} href="/?auth=forgot-password" onClick={(event) => { event.preventDefault(); onModeChange("forgot-password"); }}>{t("¿Olvidaste tu contraseña?")}</Link>
            <div className={styles.modalDivider}><span>{t("o")}</span></div>
            <Link className={styles.modalRegistration} href="/?auth=register" onClick={(event) => { event.preventDefault(); onModeChange("register"); }}>{t("Conocer el proceso de alta")}</Link>
          </>
        ) : null}

        {mode === "register" ? registrationComplete ? (
          <div className={styles.authResult} role="status">
            <strong>{t("Cuenta creada")}</strong>
            <p>{t("Revisá tu correo para verificarla. El alta no creó un perfil ni concedió habilitación o capacidades.")}</p>
            {status ? <p>{t(status)}</p> : null}
            <button className={styles.secondaryButton} type="button" onClick={resendVerification} disabled={pending}>{t("Reenviar verificación")}</button>
            <button className={styles.textButton} type="button" onClick={() => onModeChange("login")}>{t("Ir al inicio de sesión")}</button>
          </div>
        ) : (
          <>
            <form onSubmit={submitRegistration} onChange={clearFieldError} noValidate>
              <label htmlFor="register-name">{t("Nombre")}</label>
              <input data-auth-focus id="register-name" name="name" autoComplete="name" required {...fieldProps("name", "register-name")} />
              {fieldError("name", "register-name")}
              <label htmlFor="register-email">{t("Email")}</label>
              <input id="register-email" name="email" type="email" autoComplete="email" required {...fieldProps("email", "register-email")} />
              {fieldError("email", "register-email")}
              <label htmlFor="register-password">{t("Contraseña")}</label>
              <input id="register-password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby={fieldErrors.password ? "register-password-error register-password-hint" : "register-password-hint"} aria-invalid={fieldErrors.password ? true : undefined} />
              <p className={styles.authFieldHint} id="register-password-hint">{t("Al menos 12 caracteres.")}</p>
              {fieldError("password", "register-password")}
              <label htmlFor="register-confirmation">{t("Confirmar contraseña")}</label>
              <input id="register-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={12} required {...fieldProps("password_confirmation", "register-confirmation")} />
              {fieldError("password_confirmation", "register-confirmation")}
              {error ? <p className={styles.loginError} role="alert">{t(error)}</p> : null}
              <button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? t("Creando cuenta…") : t("Crear cuenta →")}</button>
            </form>
            <button className={styles.textButton} type="button" onClick={() => onModeChange("login")}>{t("Ya tengo una cuenta")}</button>
          </>
        ) : null}

        {mode === "forgot-password" ? recoveryComplete ? (
          <div className={styles.authResult} role="status">
            <strong>{t("Revisá tu correo")}</strong>
            <p>{t("Si el email corresponde a una cuenta, recibirás instrucciones para restablecer la contraseña.")}</p>
            <button className={styles.textButton} type="button" onClick={() => onModeChange("login")}>{t("Volver al inicio de sesión")}</button>
          </div>
        ) : (
          <>
            <form onSubmit={submitRecovery} onChange={clearFieldError} noValidate>
              <label htmlFor="recovery-email">{t("Email")}</label>
              <input data-auth-focus id="recovery-email" name="email" type="email" autoComplete="email" required {...fieldProps("email", "recovery-email")} />
              {fieldError("email", "recovery-email")}
              {error ? <p className={styles.loginError} role="alert">{t(error)}</p> : null}
              <button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? t("Enviando…") : t("Enviar instrucciones →")}</button>
            </form>
            <button className={styles.textButton} type="button" onClick={() => onModeChange("login")}>{t("Volver")}</button>
          </>
        ) : null}

        {mode === "reset" ? (
          <form onSubmit={submitReset} onChange={clearFieldError} noValidate>
            <label htmlFor="reset-email">{t("Email")}</label>
            <input id="reset-email" name="email" type="email" autoComplete="email" required defaultValue={link.email} {...fieldProps("email", "reset-email")} />
            {fieldError("email", "reset-email")}
            <label htmlFor="reset-password">{t("Nueva contraseña")}</label>
            <input data-auth-focus id="reset-password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby={fieldErrors.password ? "reset-password-error reset-password-hint" : "reset-password-hint"} aria-invalid={fieldErrors.password ? true : undefined} />
            <p className={styles.authFieldHint} id="reset-password-hint">{t("Al menos 12 caracteres.")}</p>
            {fieldError("password", "reset-password")}
            <label htmlFor="reset-confirmation">{t("Confirmar contraseña")}</label>
            <input id="reset-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={12} required {...fieldProps("password_confirmation", "reset-confirmation")} />
            {fieldError("password_confirmation", "reset-confirmation")}
            {error ? <p className={styles.loginError} role="alert">{t(error)}</p> : null}
            {status ? <p className={styles.successMessage} role="status">{t(status)}</p> : null}
            <button className={styles.primaryButton} type="submit" disabled={pending || Boolean(status)}>{pending ? t("Actualizando…") : t("Guardar contraseña →")}</button>
          </form>
        ) : null}

        {mode === "verify" ? (
          <div className={styles.authResult} aria-live="polite">
            {pending ? <p>{t("Verificando…")}</p> : null}
            {error ? <p className={styles.loginError} role="alert">{t(error)}</p> : null}
            {status ? <p className={styles.successMessage} role="status">{t(status)}</p> : null}
            <button data-auth-focus className={styles.textButton} type="button" onClick={() => onModeChange("login")}>{t("Ir al inicio de sesión")}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function authModeFromUrl(url: URL): AuthMode | null {
  const candidate = url.searchParams.get("auth");
  if (candidate === "verify-email") return "verify";
  if (candidate === "reset-password") return "reset";
  return candidate === "login" ||
    candidate === "register" ||
    candidate === "forgot-password" ||
    candidate === "reset" ||
    candidate === "verify"
    ? candidate
    : null;
}

function captureAuthLinkFromUrl(
  url: URL,
  mode: AuthMode | null,
): { link: AuthLinkData; urlChanged: boolean } {
  if (mode !== "verify" && mode !== "reset") {
    return { link: EMPTY_AUTH_LINK, urlChanged: false };
  }

  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  const link: AuthLinkData = {
    token: fragmentParams.get("token") ?? url.searchParams.get("token"),
    email: mode === "reset"
      ? fragmentParams.get("email") ?? url.searchParams.get("email") ?? ""
      : "",
  };
  let urlChanged = false;

  for (const parameter of ["token", "email"]) {
    if (url.searchParams.has(parameter)) {
      url.searchParams.delete(parameter);
      urlChanged = true;
    }
  }

  if (fragmentParams.has("token") || fragmentParams.has("email")) {
    fragmentParams.delete("token");
    fragmentParams.delete("email");
    const remainingFragment = fragmentParams.toString();
    url.hash = remainingFragment ? `#${remainingFragment}` : "";
    urlChanged = true;
  }

  return { link, urlChanged };
}

export function LandingPage() {
  const t = useT();
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [localLogoutNotice, setLocalLogoutNotice] = useState(false);
  const triggerRef: RefObject<HTMLElement | null> = useRef<HTMLElement>(null);
  const authMode = authState?.mode ?? null;

  useLayoutEffect(() => {
    const syncAuthFromUrl = () => {
      const url = new URL(window.location.href);
      const mode = authModeFromUrl(url);
      const capturedLink = captureAuthLinkFromUrl(url, mode);
      let urlChanged = capturedLink.urlChanged;

      const locallyClosed = url.searchParams.get("logout") === "local";
      if (locallyClosed) {
        url.searchParams.delete("logout");
        urlChanged = true;
      }

      if (urlChanged) replaceBrowserUrl(url);
      setLocalLogoutNotice(locallyClosed);
      setAuthState((current) => {
        if (!mode) return null;
        if (
          (mode === "verify" || mode === "reset") &&
          capturedLink.link.token === null &&
          current?.mode === mode &&
          current.link.token
        ) {
          return current;
        }
        return { mode, link: capturedLink.link };
      });
    };

    syncAuthFromUrl();
    window.addEventListener("popstate", syncAuthFromUrl);
    return () => window.removeEventListener("popstate", syncAuthFromUrl);
  }, []);

  const openLogin = (event: MouseEvent<HTMLButtonElement>) => {
    triggerRef.current = event.currentTarget;
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "login");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setAuthState({ mode: "login", link: EMPTY_AUTH_LINK });
  };

  const changeAuthMode = (mode: AuthMode) => {
    const url = new URL(window.location.href);
    url.searchParams.set("auth", mode);
    if (mode !== "verify" && mode !== "reset") {
      url.searchParams.delete("token");
      url.searchParams.delete("email");
    }
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setAuthState({ mode, link: EMPTY_AUTH_LINK });
  };

  const closeAuth = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    url.searchParams.delete("token");
    if (authMode === "reset") url.searchParams.delete("email");
    replaceBrowserUrl(url);
    setAuthState(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [authMode]);

  return (
    <>
      <Header onLogin={openLogin} />
      {localLogoutNotice ? (
        <div className={styles.localLogoutNotice} role="status" aria-live="polite">
          {t("La sesión local se cerró. No pudimos confirmar la revocación remota.")}
        </div>
      ) : null}
      <main>
        <Hero />
        <Stats />
        <About />
        <Profiles />
        <AvailabilityDemo />
        <DashboardDemo />
        <ProfileDemo />
        <Onboarding />
        <AccessCards />
        <FAQ />
        <Contact />
      </main>
      <Footer />
      <AuthModal
        key={authMode ?? "auth-closed"}
        mode={authMode}
        link={authState?.link ?? EMPTY_AUTH_LINK}
        onClose={closeAuth}
        onModeChange={changeAuthMode}
      />
    </>
  );
}
