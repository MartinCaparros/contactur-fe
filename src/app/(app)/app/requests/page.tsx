import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// Las solicitudes son privadas del perfil participante y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function RequestsPage() {
  return <PrivateApp view="requests" />;
}
