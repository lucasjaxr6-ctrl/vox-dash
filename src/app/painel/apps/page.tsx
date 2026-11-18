import Link from "next/link";
import { getActiveStore } from "@/lib/stores";
import { getShopifyCredentials, getUtmifyToken } from "@/lib/settings";
import { APP_CATEGORIES, type AppItem } from "@/lib/apps";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const store = await getActiveStore();
  const [shopifyActive, utmifyActive] = store
    ? await Promise.all([
        getShopifyCredentials(store.id).then((c) => !!c),
        getUtmifyToken(store.id).then((t) => !!t),
      ])
    : [false, false];
  const isActive = (a: AppItem) =>
    (a.statusKey === "shopify" && shopifyActive) || (a.statusKey === "utmify" && utmifyActive);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">Apps</h1>
      <p className="mt-1 text-sm text-low">Conecte sua loja às plataformas, logística, tracking e mais.</p>

      <div className="mt-6 space-y-8">
        {APP_CATEGORIES.map((cat) => (
          <section key={cat.title}>
            <h2 className="text-[15px] font-semibold text-hi">{cat.title}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cat.apps.map((a) => {
                const active = isActive(a);
                const card = (
                  <div
                    className={`flex items-center gap-4 rounded-2xl bg-card p-5 transition-colors ${
                      a.href ? "hover:bg-soft" : "opacity-70"
                    }`}
                  >
                    {/* Logo oficial do app, em ladrilho com cantos arredondados. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.logo}
                      alt={a.name}
                      width={48}
                      height={48}
                      className="h-12 w-12 flex-shrink-0 rounded-xl object-cover ring-1 ring-inset ring-black/10"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-hi">{a.name}</span>
                        {active ? (
                          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Ativo</span>
                        ) : a.href ? (
                          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-400">Instalar</span>
                        ) : (
                          <span className="rounded-md bg-hover px-2 py-0.5 text-[11px] font-semibold text-low">Em breve</span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-sm text-low">{a.desc}</span>
                    </span>
                  </div>
                );
                return a.href ? (
                  <Link key={a.key} href={a.href} className="group block">{card}</Link>
                ) : (
                  <div key={a.key} className="cursor-default">{card}</div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
