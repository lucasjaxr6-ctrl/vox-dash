import crypto from "crypto";
import { json } from "@/lib/http";
import { getTrack17Token, aplicarTrackInfo, garantirRemessa } from "@/lib/track17";

// POST /api/webhooks/track17
//
// Push do 17TRACK ("Package Webhook"). Sem ele, a página só sabe de uma
// novidade quando alguém abre e o cache de 30 min venceu; com ele, o evento
// chega em segundos e a tela lê direto do nosso banco.
//
// Assinatura: header `sign` = SHA256(<corpo bruto> + "/" + <chave da API>), em
// hex. Não é HMAC — é hash de concatenação.
//
// ⚠️ A primeira versão calculava SHA256("<event>/<data>/<chave>"), seguindo
// uma frase da documentação. O EXEMPLO DE CÓDIGO oficial deles (help center,
// "Webhook Development Example Code") e implementações independentes usam o
// CORPO INTEIRO. Com a fórmula errada, todo push verdadeiro era recusado — o
// webhook estava ativo no painel do 17TRACK e nada chegava aqui.
//
// A fórmula do corpo é tentada primeiro; as outras duas ficam como reserva.
// Todas exigem a chave da API, então aceitar mais de uma não afrouxa nada.
//
// Toda recusa é REGISTRADA. Um webhook que descarta em silêncio já custou um
// dia de depuração nesta base (a caixa de entrada do admin); aqui não repete.

/** Recorta o JSON cru de `data` — reserializar não reproduz os bytes deles. */
function recortarData(bruto: string): string | null {
  const marca = bruto.indexOf('"data"');
  if (marca < 0) return null;
  const inicio = bruto.indexOf("{", marca);
  if (inicio < 0) return null;
  let nivel = 0;
  let dentroDeTexto = false;
  let escapado = false;
  for (let i = inicio; i < bruto.length; i++) {
    const ch = bruto[i];
    if (escapado) { escapado = false; continue; }
    if (ch === "\\") { escapado = true; continue; }
    if (ch === '"') { dentroDeTexto = !dentroDeTexto; continue; }
    if (dentroDeTexto) continue;
    if (ch === "{") nivel++;
    else if (ch === "}") {
      nivel--;
      if (nivel === 0) return bruto.slice(inicio, i + 1);
    }
  }
  return null;
}

/** SHA256 em hex de um texto já montado, comparado em tempo constante. */
function confere(texto: string, assinatura: string): boolean {
  const calculado = crypto.createHash("sha256").update(texto, "utf8").digest("hex");
  // timingSafeEqual exige mesmo tamanho; comparar antes evita a exceção.
  if (calculado.length !== assinatura.length) return false;
  return crypto.timingSafeEqual(Buffer.from(calculado), Buffer.from(assinatura.toLowerCase()));
}

export async function POST(req: Request) {
  try {
    const bruto = await req.text();
    const corpo = JSON.parse(bruto) as Record<string, any>;
    const evento = String(corpo?.event ?? "");

    const token = await getTrack17Token();
    if (!token) {
      console.error("[track17-webhook] descartado: sem token configurado — não dá para verificar a assinatura");
      return json({ ok: true });
    }

    const assinatura = (req.headers.get("sign") ?? "").trim();
    if (!assinatura) {
      console.error("[track17-webhook] descartado: requisição sem header `sign`");
      return json({ ok: true });
    }

    // Em ordem de probabilidade. A primeira é a do exemplo de código oficial.
    const recorte = recortarData(bruto);
    const candidatos: [string, string | null][] = [
      ["corpo", `${bruto}/${token}`],
      ["evento/data", recorte ? `${evento}/${recorte}/${token}` : null],
      ["evento/json", corpo?.data !== undefined ? `${evento}/${JSON.stringify(corpo.data)}/${token}` : null],
    ];
    const casou = candidatos.find(([, texto]) => texto !== null && confere(texto, assinatura));
    if (!casou) {
      // Loga o tamanho do corpo e o começo da assinatura recebida — nunca a
      // chave. Com isso dá para investigar um formato novo sem expor segredo.
      console.error(
        `[track17-webhook] assinatura inválida | evento=${evento} | corpo=${bruto.length}B | sign=${assinatura.slice(0, 12)}…`,
      );
      return json({ ok: true });
    }
    // Registrar QUAL fórmula casou confirma a hipótese com tráfego real — e
    // se um dia o 17TRACK mudar o cálculo, o log mostra a troca.
    console.log(`[track17-webhook] assinatura ok (${casou[0]})`);

    if (evento !== "TRACKING_UPDATED") {
      // TRACKING_STOPPED e afins não trazem eventos novos.
      console.log(`[track17-webhook] evento ignorado: ${evento}`);
      return json({ ok: true });
    }

    // Dois formatos aparecem na documentação: `data.accepted[]` (lote) e
    // `data` como o próprio item (um número só). Aceita os dois — ler só um
    // deles descartaria em silêncio o push que viesse no outro.
    const aceitos: any[] = Array.isArray(corpo?.data?.accepted)
      ? corpo.data.accepted
      : corpo?.data?.number
        ? [corpo.data]
        : [];
    let gravados = 0;
    for (const item of aceitos) {
      const numero = String(item?.number ?? "").trim().toUpperCase();
      if (!numero) continue;
      // Código que não é de pedido nosso não abre remessa: a tabela não pode
      // virar depósito de número alheio.
      if (!(await garantirRemessa(numero))) {
        console.warn(`[track17-webhook] ${numero} não pertence a nenhum pedido`);
        continue;
      }
      gravados += await aplicarTrackInfo(numero, item);
    }
    console.log(`[track17-webhook] ${aceitos.length} remessa(s), ${gravados} evento(s) novo(s)`);
    return json({ ok: true });
  } catch (e) {
    console.error("[track17-webhook] falhou:", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
