import { AdminShell } from "./admin-shell";

type AdminPlaceholderProps = {
  title: string;
  subtitle: string;
};

export function AdminPlaceholder({ title, subtitle }: AdminPlaceholderProps) {
  return (
    <AdminShell subtitle={subtitle} title={title}>
      <div className="admin-message">This section is being migrated to the new admin panel.</div>
    </AdminShell>
  );
}
