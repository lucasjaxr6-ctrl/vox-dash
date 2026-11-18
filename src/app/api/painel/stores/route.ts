import { requireMerchant } from "@/lib/auth";
import { getStoresForOwner, createStore, getActiveStore } from "@/lib/stores";
import { setActiveStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { z } from "zod";

const createStoreSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da loja").max(191),
});

// GET /api/painel/stores -> lojas da conta + qual está ativa.
export async function GET() {
  try {
    const user = await requireMerchant();
    const [stores, active] = await Promise.all([
      getStoresForOwner(user.id),
      getActiveStore(),
    ]);
    // ADMIN impersonando uma loja de outro dono: ela não vem em
    // getStoresForOwner, então o seletor ficava sem a opção correspondente e o
    // navegador mostrava a primeira da lista ("Minha loja"), como se o admin
    // estivesse em outra loja. Inclui a loja ativa quando ela não está na lista.
    // Só acontece para ADMIN: getActiveStore só devolve loja de terceiro nesse caso.
    const list = active && !stores.some((s) => s.id === active.id) ? [active, ...stores] : stores;
    return json({ stores: list, activeStoreId: active?.id ?? null });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/painel/stores -> cria uma loja e a deixa ativa.
export async function POST(req: Request) {
  try {
    const user = await requireMerchant();
    const body = await req.json();
    const { name } = createStoreSchema.parse(body);
    const store = await createStore(user.id, name);
    await setActiveStore(store.id);
    return json({ store }, 201);
  } catch (err) {
    return handleError(err);
  }
}
