import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// Las notificaciones son privadas del titular del perfil y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NotificationsPage() {
  return <PrivateApp view="notifications" />;
}
