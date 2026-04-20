import { redirect } from "next/navigation";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "toritavi admin",
  robots: { index: false, follow: false },
};

/**
 * Admin route group layout. Middleware already gates /admin behind a
 * live session, but that only checks "are you logged in at all". The
 * actual role-based authorisation happens here — a logged-in but
 * non-admin user lands in /login with ?from=/admin so their session
 * isn't lost when they come back.
 *
 * Every /admin/* API route does the SAME requireAdmin() call. Layout
 * auth is for UX (can't see the shell), API auth is for security.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx;
  try {
    ctx = await requireAdmin("support_viewer");
  } catch (e) {
    if (e instanceof AdminAuthError && e.status === 403) {
      redirect("/?admin_denied=1");
    }
    redirect("/login?from=/admin");
  }

  return (
    <AdminShell role={ctx.role} email={ctx.email}>
      {children}
    </AdminShell>
  );
}
