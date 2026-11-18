import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getWebhooks, setWebhooks, newWebhookToken, type StoredWebhook } from "@/lib/settings";
import { sendWebhookNotification } from "@/lib/notifications";
import { updateWebhooksSchema, testWebhookSchema } from "@/lib/validation";
import { newId } from "@/lib/db";

// GET /api/painel/webhooks -> lista de webhooks da loja ativa.
export async function GET() {
  try {
    const { store } = await requireStore();
    return json({ webhooks: await getWebhooks(store.id) });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/painel/webhooks -> salva a lista de webhooks (todas as URLs https).
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const { webhooks } = updateWebhooksSchema.parse(await req.json());
    for (const w of webhooks) {
      if (!w.url.startsWith("https://")) {
        return json({ error: "Todas as URLs de webhook precisam começar com https://." }, 400);
      }
    }
    const list: StoredWebhook[] = webhooks.map((w) => ({
      id: w.id || newId(),
      name: (w.name || "").trim() || "Webhook",
      url: w.url,
      // Token gerado no servidor e preservado entre salvamentos: o destino já
      // pode ter configurado a validação com ele.
      token: w.token || newWebhookToken(),
      events: w.events,
      enabled: w.enabled,
    }));
    await setWebhooks(store.id, list);
    return json({ ok: true, webhooks: list });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/painel/webhooks -> envia uma notificação de TESTE para a URL informada.
export async function POST(req: Request) {
  try {
    await requireStore();
    const { url, token } = testWebhookSchema.parse(await req.json());
    if (!url.startsWith("https://")) {
      return json({ error: "A URL precisa começar com https://." }, 400);
    }
    const r = await sendWebhookNotification(
      url,
      {
        event: "test",
        title: "Teste de webhook ✅",
        text: "Se você recebeu isto, seu webhook está funcionando!",
        occurredAt: new Date().toISOString(),
      },
      { token, event: "test" },
    );
    if (!r.ok) return json({ error: r.error || "Não foi possível enviar a notificação." }, 502);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
