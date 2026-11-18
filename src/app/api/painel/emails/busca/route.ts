import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { searchInbound } from "@/lib/inbound";
import { searchOutbound } from "@/lib/outbound";
import { separarResposta } from "@/lib/email-reply";

export const dynamic = "force-dynamic";

// GET /api/painel/emails/busca?q=cliente@exemplo.com
//
// Toda a conversa com um contato — recebidos e enviados juntos, em ordem de
// tempo. Serve para atendimento: antes de responder, o lojista vê de uma vez
// tudo que já foi trocado com aquela pessoa, sem alternar entre as duas abas
// e sem depender de elas estarem entre os 100 últimos.
export async function GET(req: Request) {
  try {
    const { store } = await requireStore();
    const q = (new URL(req.url).searchParams.get("q") || "").trim();
    // 3 caracteres é o piso: com menos, o LIKE devolveria a caixa inteira.
    if (q.length < 3) return json({ resultados: [], total: 0 });

    const [recebidos, enviados] = await Promise.all([
      searchInbound(store.id, q, 100),
      searchOutbound(store.id, q, 100),
    ]);

    const deRecebidos = recebidos.map((e) => {
      const { resposta, citado, temCitacao } = separarResposta(e.textBody);
      const texto = (temCitacao ? resposta : citado).replace(/\s+/g, " ").trim();
      return {
        id: e.id,
        direcao: "recebido" as const,
        contato: e.fromAddr,
        nome: e.fromName,
        subject: e.subject,
        preview: texto ? texto.slice(0, 160) : null,
        kind: null as string | null,
        isRead: e.isRead,
        quando: new Date(e.receivedAt).toISOString(),
      };
    });

    const deEnviados = enviados.map((e) => ({
      id: e.id,
      direcao: "enviado" as const,
      contato: e.toAddr,
      nome: null as string | null,
      subject: e.subject,
      preview: null as string | null,
      kind: e.kind,
      isRead: null as number | null,
      quando: new Date(e.createdAt).toISOString(),
    }));

    const resultados = [...deRecebidos, ...deEnviados].sort((a, b) => b.quando.localeCompare(a.quando));
    return json({ resultados, total: resultados.length });
  } catch (err) {
    return handleError(err);
  }
}
