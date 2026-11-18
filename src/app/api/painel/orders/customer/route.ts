import { z } from "zod";
import { query, execute } from "@/lib/db";
import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { isValidCPF, isValidCNPJ } from "@/lib/validation";

// PATCH /api/painel/orders/customer
//
// "Editar cliente" na tela do pedido: nome, e-mail, CPF/CNPJ, WhatsApp e
// endereço. Corrige o CADASTRO do pedido e nada mais: não dispara e-mail, não
// mexe em pagamento e não altera a Shopify (o pedido de lá é editado lá).
//
// Grava no mesmo formato do checkout (documento e telefone só com dígitos):
// outras partes comparam esses campos, como o limite de Pix por CPF.
const digitos = (v: string) => v.replace(/\D/g, "");

const schema = z.object({
  orderId: z.string().min(1).max(64),
  name: z.string().trim().min(2, "Informe o nome do cliente.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(254),
  document: z
    .string()
    .transform(digitos)
    .refine((d) => (d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false), {
      message: "CPF ou CNPJ inválido.",
    }),
  phone: z
    .string()
    .transform((v) => digitos(v).replace(/^55(?=\d{10,11}$)/, ""))
    .refine((d) => d.length === 10 || d.length === 11, { message: "WhatsApp inválido (DDD + número)." }),
  address: z.object({
    cep: z.string().transform(digitos).refine((d) => d.length === 8, { message: "CEP inválido." }),
    street: z.string().trim().min(1, "Informe a rua.").max(160),
    number: z.string().trim().min(1, "Informe o número.").max(20),
    complement: z.string().trim().max(120).optional().default(""),
    neighborhood: z.string().trim().min(1, "Informe o bairro.").max(120),
    city: z.string().trim().min(1, "Informe a cidade.").max(120),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .refine((u) => /^[A-Z]{2}$/.test(u), { message: "UF inválida." }),
  }),
});

export async function PATCH(req: Request) {
  try {
    const { store } = await requireStore();
    const d = schema.parse(await req.json());

    const [pedido] = await query<{ customerEmail: string | null; customerAddress: string | null }>(
      `SELECT customerEmail, customerAddress FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [d.orderId, store.id],
    );
    // A loja na consulta é o que impede editar pedido de outra loja pelo id.
    if (!pedido) return json({ error: "Pedido não encontrado." }, 404);

    // Mescla com o endereço salvo: chaves que o checkout grava e este formulário
    // não mostra continuam como estavam.
    let anterior: Record<string, unknown> = {};
    try {
      anterior = pedido.customerAddress ? JSON.parse(pedido.customerAddress) : {};
    } catch {
      anterior = {};
    }
    const endereco = { ...anterior, ...d.address };

    await execute(
      `UPDATE orders
          SET customerName = ?, customerEmail = ?, customerDocument = ?, customerPhone = ?, customerAddress = ?
        WHERE id = ? AND storeId = ?`,
      [d.name, d.email, d.document, d.phone, JSON.stringify(endereco), d.orderId, store.id],
    );

    // O carrinho abandonado do mesmo contato carrega o e-mail antigo e alimenta
    // recuperação e relatórios; corrigir só o pedido deixaria os dois em
    // desacordo (mesma regra que valia no antigo "corrigir e-mail").
    if (pedido.customerEmail && pedido.customerEmail !== d.email) {
      await execute(
        `UPDATE abandoned_carts SET email = ?, updatedAt = updatedAt WHERE storeId = ? AND email = ?`,
        [d.email, store.id, pedido.customerEmail],
      ).catch(() => {});
    }

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
