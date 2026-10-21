import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translate(locale, "Contactur | Turismo profesional"),
    description: translate(
      locale,
      "Plataforma B2B para coordinar disponibilidad y solicitudes entre profesionales del turismo.",
    ),
  };
}

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

/**
 * El idioma sale de la cookie `contactur_locale` en el servidor, así el primer HTML ya
 * llega en el idioma elegido (sin parpadeo en español) y `<html lang>` es correcto.
 */
export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
