import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// D19: las fichas son visibles solo a miembros y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type DirectoryProfilePageProps = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * El servidor solo pasa el identificador de la URL: la ficha se pide desde el
 * navegador por el BFF con la sesión del usuario, así que el HTML/RSC nunca
 * contiene datos del perfil (y menos contacto, que el backend no entrega).
 */
export default async function DirectoryProfilePage({ params }: DirectoryProfilePageProps) {
  const { id } = await params;
  return <PrivateApp view="directory" targetProfileId={id} />;
}
