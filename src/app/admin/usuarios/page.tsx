import { getUsersWithStats } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import AdminUsersManager, { type AdminUser } from "@/components/admin/AdminUsersManager";
import { PageHeader } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin();
  const q = ((await searchParams).q ?? "").trim();
  const rows = await getUsersWithStats(q);
  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    banned: Number(u.banned),
    suspended: Number(u.suspended),
    createdAt: new Date(u.createdAt).toISOString(),
    storeCount: Number(u.storeCount),
    gmvCents: Number(u.gmvCents),
    plan: u.plan,
    planExpiresAt: u.planExpiresAt ? new Date(u.planExpiresAt).toISOString() : null,
  }));

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Usuários"
        subtitle={
          q
            ? `${users.length} conta(s) encontrada(s) para "${q}"`
            : `${users.length} contas · abra a ficha para ver os dados, mudar o plano, definir a taxa ou aplicar uma ação`
        }
      />

      {/* Busca por GET: funciona sem JavaScript e o link com ?q= pode ser
          compartilhado entre admins. */}
      <form action="/admin/usuarios" method="get" role="search" className="flex max-w-xl gap-2">
        <label className="sr-only" htmlFor="busca-usuario">Buscar por e-mail, nome ou loja</label>
        <input
          id="busca-usuario"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Buscar por e-mail, nome ou loja"
          autoComplete="off"
          className="w-full rounded-lg border border-line-strong bg-card px-3.5 py-2 text-sm text-hi outline-none placeholder:text-dim focus:border-brand"
        />
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover">
          Buscar
        </button>
        {q && (
          <a href="/admin/usuarios" className="flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-mid transition hover:bg-hover">
            Limpar
          </a>
        )}
      </form>

      {users.length === 0 ? (
        <section className="rounded-2xl bg-card px-5 py-14 text-center text-sm text-low">Nenhuma conta com esse e-mail, nome ou loja.</section>
      ) : (
        <AdminUsersManager users={users} selfId={admin.id} />
      )}
    </div>
  );
}
