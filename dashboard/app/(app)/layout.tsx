import Sidebar from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <main className="ml-60 min-h-screen px-10 py-8">{children}</main>
    </>
  );
}
