import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import OnboardingModal from "@/components/OnboardingModal";
import Toaster from "@/components/Toast";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <CommandPalette />
      <OnboardingModal />
      <Toaster />
      {/* desktop: left margin for sidebar · mobile: top padding for bar */}
      <main className="md:ml-60 min-h-screen px-4 md:px-10 pt-20 md:py-8 pb-8">
        {children}
      </main>
    </>
  );
}
