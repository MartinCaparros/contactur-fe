import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// Los ajustes son privados de la cuenta y no se indexan.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SettingsPage() {
  return <PrivateApp view="settings" />;
}
