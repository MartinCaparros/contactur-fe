import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// Las referencias propias (recibidas y escritas) son privadas del perfil y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * El servidor no pasa ningún dato: el listado se pide desde el navegador por el BFF,
 * así que el HTML/RSC nunca contiene el texto de una referencia.
 */
export default function ReferencesPage() {
  return <PrivateApp view="references" />;
}
