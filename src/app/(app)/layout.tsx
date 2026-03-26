import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar userRole={profile.role} userEmail={profile.email} />
      <main className="lg:pl-64 h-full">
        <div className="pt-16 lg:pt-0 h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
