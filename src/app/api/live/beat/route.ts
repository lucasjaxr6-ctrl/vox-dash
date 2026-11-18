import { headers } from "next/headers";
import { after } from "next/server";
import { execute } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";
import { sweepCartRecovery } from "@/lib/email";

// GET /api/live/beat?sid=...&scope=store|checkout&step=0..4[&pid=<id shopify>]
// "Batida" de presença do visitante (checkout ou loja). GET de propósito: roda
// via <img>/sendBeacon sem CORS/preflight e não é bloqueado pelo middleware CSRF
// (que só barra métodos que mutam). A loja é resolvida pelo domínio (Host).
//
// `pid` só vem quando a batida sai de uma PÁGINA DE PRODUTO da vitrine, e é o
// que dá visita por produto — dado que o checkout não tem como enxergar.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sid = (url.searchParams.get("sid") || "").slice(0, 191);
  const scope = url.searchParams.get("scope") === "checkout" ? "checkout" : "store";
  const step = Math.max(0, Math.min(4, parseInt(url.searchParams.get("step") || "0", 10) || 0));
  // Id da Shopify: só dígitos. Filtrar aqui evita gravar lixo vindo da URL.
  const pid = (url.searchParams.get("pid") || "").replace(/\D/g, "").slice(0, 64);
  // `exit=1` não é uma batida: é o aviso de que o cliente FECHOU o checkout.
  const saiu = url.searchParams.get("exit") === "1";
  const noContent = new Response(null, { status: 204 });

  if (!sid) return noContent;

  const h = await headers();
  const store = await resolveStoreByHost(h.get("host"));
  if (!store) return noContent;

  // Geolocalização fornecida pela Vercel (sem serviço externo).
  const state = (h.get("x-vercel-ip-country-region") || "").slice(0, 8) || null;
  const cityRaw = h.get("x-vercel-ip-city") || "";
  const city = cityRaw ? decodeURIComponent(cityRaw).slice(0, 120) : null;

  try {
    await execute(
      `INSERT INTO live_sessions (id, storeId, scope, step, state, city)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         scope = VALUES(scope),
         step = GREATEST(step, VALUES(step)),
         state = COALESCE(VALUES(state), state),
         city = COALESCE(VALUES(city), city),
         updatedAt = NOW(3)`,
      [sid, store.id, scope, step, state, city],
    );
  } catch {
    /* silencioso — presença não pode derrubar nada */
  }

  // Funil do checkout: registro PERMANENTE, uma linha por sessão, guardando o
  // passo MÁXIMO alcançado. PK (storeId, sessionId) => a sessão conta uma única
  // vez por mais batidas que mande, e o step nunca regride.
  // live_sessions não serve para isso (é apagada após 15 min, só responde "quem
  // está online agora"), e abandoned_carts existe para recuperação de carrinho.
  if (scope === "checkout") {
    try {
      await execute(
        `INSERT INTO checkout_funnel (storeId, sessionId, step) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE step = GREATEST(step, VALUES(step)), updatedAt = NOW(3)`,
        [store.id, sid, step],
      );
    } catch {
      /* silencioso — idem */
    }

    // PRESENÇA = sinal de vida do carrinho.
    //
    // Enquanto esta batida chega, o cliente está com o checkout aberto. O
    // `updatedAt` é o relógio que decide as duas coisas: quando o carrinho vira
    // "abandonado" na lista do painel, e quando o e-mail de recuperação sai.
    // Sem isto, quem está parado na tela de pagamento (buscando o cartão)
    // apareceria como abandonado e receberia o e-mail com a página aberta.
    //
    // A trava de 60s existe porque a batida é a cada 20s: sem ela seriam três
    // escritas por minuto por visitante, para marcar a mesma coisa.
    try {
      if (saiu) {
        // SAÍDA: carimba a hora e NÃO mexe no updatedAt — fechar a aba é o
        // oposto de sinal de vida. É isto que deixa o carrinho virar abandonado
        // na hora, sem esperar o cronômetro de silêncio.
        await execute(
          `UPDATE abandoned_carts SET exitedAt = NOW(3), updatedAt = updatedAt
            WHERE storeId = ? AND sessionId = ? AND status = 'OPEN' AND exitedAt IS NULL`,
          [store.id, sid],
        );
      } else {
        // PRESENÇA = sinal de vida. Se havia saída marcada, o cliente VOLTOU:
        // limpar é o que tira o carrinho da lista sem esperar nada.
        await execute(
          `UPDATE abandoned_carts SET updatedAt = NOW(3), exitedAt = NULL
            WHERE storeId = ? AND sessionId = ? AND status = 'OPEN'
              AND (updatedAt < DATE_SUB(NOW(3), INTERVAL 60 SECOND) OR exitedAt IS NOT NULL)`,
          [store.id, sid],
        );
      }
    } catch {
      /* presença nunca pode derrubar nada */
    }

  }

  // Visita na página do produto. A PK (loja, sessão, produto) faz a mesma pessoa
  // contar uma vez só por produto; `views` guarda quantas vezes ela voltou.
  if (pid) {
    try {
      await execute(
        `INSERT INTO product_views (storeId, sessionId, shopifyProductId) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE views = views + 1, updatedAt = NOW(3)`,
        [store.id, sid, pid],
      );
    } catch {
      /* tabela pode não existir ainda (migrate-product-views pendente) */
    }
  }

  // Varredura de recuperação, de carona em QUALQUER batida — inclusive as da
  // vitrine.
  //
  // Rodava só nas batidas do CHECKOUT, e aí o e-mail ficava preso quando
  // ninguém estava no checkout: um Pix gerado 19:24 venceu 19:39, mas a última
  // batida de checkout tinha sido 19:36 — nada rodou, enquanto a vitrine batia
  // a cada poucos segundos. Quem vence o prazo é o relógio do cliente, não o
  // movimento em uma página específica.
  //
  // `after` devolve o 204 primeiro: a batida é beacon de fundo e não pode
  // esperar o varrimento. O freio próprio (1 min por loja) continua valendo.
  after(async () => {
    try {
      await sweepCartRecovery(store.id);
    } catch {
      /* recuperação nunca pode derrubar a presença */
    }
  });

  return noContent;
}
