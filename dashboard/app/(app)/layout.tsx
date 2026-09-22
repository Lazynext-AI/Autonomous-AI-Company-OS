import Sidebar from "@/components/Sidebar";
import MaintenanceGate from "@/components/MaintenanceGate";
import CommandPalette from "@/components/CommandPalette";
import OnboardingModal from "@/components/OnboardingModal";
import ShortcutsModal from "@/components/ShortcutsModal";
import InstallPrompt from "@/components/InstallPrompt";
import Toaster from "@/components/Toast";
import Splash from "@/components/Splash";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <CommandPalette />
      <OnboardingModal />
      <ShortcutsModal />
      <InstallPrompt />
      <Toaster />
      <Splash />
      {/* desktop: left margin for sidebar · mobile: top padding for bar */}
      <main className="md:ml-60 min-h-screen px-4 md:px-10 pt-20 md:py-8 pb-8">
        <MaintenanceGate>{children}</MaintenanceGate>
      </main>
    </>
  );
}
