import { AppShell } from "@/components/app-shell";
import { PrivacyProvider } from "@/lib/privacy";
import { ToastProvider } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PrivacyProvider>
      <ToastProvider>
        <AppShell>{children}</AppShell>
        <CommandPalette />
      </ToastProvider>
    </PrivacyProvider>
  );
}
