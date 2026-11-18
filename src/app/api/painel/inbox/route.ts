import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { markInboundRead, setInboundAddress, setInboundSecret } from "@/lib/inbound";

// PATCH /api/painel/inbox -> marca um e-mail como lido { id }
export async function PATCH(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json().catch(() => ({}) as any);
    const id = String(body?.id || "").trim();
    if (!id) return json({ error: "id obrigatório" }, 400);
    await markInboundRead(store.id, id);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/painel/inbox -> define o endereço que ESTA loja recebe { inboundEmail }
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json().catch(() => ({}) as any);
    const addr = String(body?.inboundEmail || "").trim();
    if (addr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return json({ error: "E-mail inválido." }, 400);
    }
    await setInboundAddress(store.id, addr);
    // Signing secret do webhook Inbound do Resend DA LOJA (em branco = mantém).
    if (typeof body?.inboundSecret === "string") {
      await setInboundSecret(store.id, body.inboundSecret);
    }
    return json({ ok: true, inboundEmail: addr.toLowerCase() || null });
  } catch (err) {
    return handleError(err);
  }
}
