import { AppShell } from "@/components/app-shell";
import { BrandingProvider } from "@/lib/branding-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider>
      <AppShell>{children}</AppShell>
    </BrandingProvider>
  );
}