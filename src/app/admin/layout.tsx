import { AdminNav } from "@/components/admin/admin-nav";

// Shell for every /admin page. Each page runs its own requireRole check:
// a layout does not re-render on client navigation, so it cannot guard.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="admin-shell">
      <AdminNav />
      <main className="admin">{children}</main>
    </div>
  );
}
