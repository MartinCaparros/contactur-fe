import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// Las solicitudes son privadas del perfil participante y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type RequestDetailPageProps = Readonly<{ params: Promise<{ id: string }> }>;

/**
 * El servidor solo pasa el identificador de la URL: la solicitud se pide desde el
 * navegador por el BFF y el contacto solo tras un click explícito, así que el
 * HTML/RSC nunca contiene datos de la solicitud ni de contacto.
 */
export default async function RequestDetailPage({ params }: RequestDetailPageProps) {
  const { id } = await params;
  return <PrivateApp view="request" requestId={id} />;
}
