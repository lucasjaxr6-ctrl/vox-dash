import crypto from "crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { pixChargeSchema } from "@/lib/validation";
import { query, execute, withTransaction, newId, inPlaceholders } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { validateCoupon } from "@/lib/coupons";
import { createProviderPixCharge } from "@/lib/payments";
import { resolveStoreByHost } from "@/lib/stores";
import { getCheckoutTheme, getPixRetentativa, getShopifyPushCredentials, resolveOrderGateway } from "@/lib/settings";
import { recordCharge } from "@/lib/order-charges";
import { mergeTheme } from "@/lib/checkout-theme";
import { createShopifyDraftOrder, completeShopifyDraftOrder } from "@/lib/shopify";
import { notifySale } from "@/lib/notifications";
import { cancelCartRecovery } from "@/lib/email";
import { sendUtmifyOrder, buildTrackingParams } from "@/lib/utmify";
import { dispararEmail } from "@/lib/email-agenda";
import { fraseDoGateway, PIX_GENERIC, safePixMessage } from "@/lib/customer-errors";
import { detectDevice } from "@/lib/device";

// POST /api/checkout/pix -> cria um pedido de VISITANTE e gera a cobrança Pix
// no gateway de Pix da loja. Rota PÚBLICA (checkout sem login).
//
// ⭐ Regra de ouro ⭐ NUNCA confie em valores do frontend: o cliente só envia
// { productId, quantity, customer, couponCode }. O preço vem do BANCO e o total
// (com cupom + desconto Pix de 5%) é recalculado aqui no servidor.
const PIX_DISCOUNT = 0.05; // mesmo desconto exibido no CheckoutForm
/** Passado disto, a retentativa não começa outra tentativa: o cliente está esperando. */
const LIMITE_RETENTATIVA_MS = 30_000;

export async function POST(req: Request) {
  try {
    // Loja resolvida pelo domínio próprio (Host) — o checkout é por loja.
    const h = await headers();
    const store = await resolveStoreByHost(h.get("host"));
    if (!store) return json({ error: "Loja não encontrada para este domínio" }, 404);

    const body = await req.json();
    const { items, customer, couponCode, shippingOptionId, pixBoost, address, sessionId, gclid, tracking, ga4, meta } = pixChargeSchema.parse(body);

    // IP do comprador (hasheado — não guardamos o IP em texto).
    const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim();
    const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : null;
    const trackingJson = buildTrackingParams({ ...tracking, ...ga4, ...meta }, ip || null);
    // Celular x computador, para a comparação de vendas no painel do lojista.
    const device = detectDevice(h.get("user-agent"));

    // Rate limit anti-abuso: no máximo 3 Pix por pessoa (mesmo IP OU mesmo CPF)
    // a cada 10 minutos. Evita flood/ataque de geração de cobranças.
    const rlConds = ["customerDocument = ?"];
    const rlParams: unknown[] = [store.id, customer.cpf];
    if (ipHash) {
      rlConds.push("ipHash = ?");
      rlParams.push(ipHash);
    }
    const recent = await query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders
       WHERE storeId = ? AND paymentMethod = 'PIX'
         AND createdAt >= DATE_SUB(NOW(3), INTERVAL 10 MINUTE)
         AND (${rlConds.join(" OR ")})`,
      rlParams,
    );
    if (Number(recent[0]?.n ?? 0) >= 3) {
      return json({ error: "Você gerou muitos Pix em pouco tempo. Aguarde alguns minutos e tente novamente." }, 429);
    }

    // Preços vêm do BANCO (regra de ouro). Busca todos os produtos do carrinho.
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await query<{ id: string; name: string; maskedName: string | null; priceCents: number }>(
      `SELECT id, name, maskedName, priceCents FROM products
       WHERE active = 1 AND storeId = ? AND id IN (${inPlaceholders(ids.length)})`,
      [store.id, ...ids],
    );
    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    // Nome enviado ao GATEWAY: mascarado (aba Criptografia) quando houver; senão,
    // o real. Shopify/e-mail/painel seguem com o nome real.
    const gwNameById = new Map(products.map((p) => [p.id, (p.maskedName?.trim() || p.name)]));
    for (const it of items) {
      if (!priceById.has(it.productId)) {
        return json({ error: "Produto indisponível no carrinho" }, 400);
      }
    }

    const subtotalCents = items.reduce(
      (sum, i) => sum + priceById.get(i.productId)! * i.quantity,
      0,
    );

    // Cupom (opcional) — validado no servidor, fonte de verdade do desconto.
    let couponCents = 0;
    if (couponCode) {
      const result = await validateCoupon(store.id, couponCode, subtotalCents);
      if (!result.ok) {
        return json({ error: result.error }, 400);
      }
      couponCents = result.discountCents;
    }

    const afterCoupon = Math.max(0, subtotalCents - couponCents);

    // Frete: o preço vem da configuração da loja (tema), nunca do frontend.
    let shippingCents = 0;
    if (shippingOptionId) {
      const theme = mergeTheme(await getCheckoutTheme(store.id));
      const opt = theme.shipping.options.find(
        (o) => o.id === shippingOptionId && o.enabled,
      );
      if (opt) shippingCents = opt.priceCents;
    }

    // Desconto Pix incide só sobre os produtos (após cupom); o frete entra por cima.
    // pixBoost = 15% (fluxo em que o cartão "fica indisponível" e leva ao Pix).
    const pixRate = pixBoost ? 0.15 : PIX_DISCOUNT;
    const amountCents = Math.round(afterCoupon * (1 - pixRate)) + shippingCents;
    if (amountCents <= 0) {
      return json({ error: "Valor do pedido inválido" }, 400);
    }

    // ── Reaproveita um Pix que este cliente já tem em aberto ──────────────────
    // Sem isto, cada clique em "Gerar Pix" criava pedido novo + cobrança nova.
    // O cliente que voltava (ou clicava de novo enquanto a página carregava)
    // aparecia com 2 ou 3 pedidos pendentes, cada um com sua transação no
    // gateway e seu pedido pendente na Shopify — e, pior, podia pagar dois.
    //
    // Só reaproveita quando é claramente o MESMO pedido: mesmo CPF, mesmo
    // valor, mesmos itens, QR ainda válido e gerado há pouco. Qualquer
    // diferença (mexeu no carrinho, mudou o frete, caiu no Pix de 15%) muda o
    // valor ou os itens e cai no caminho normal, criando um pedido novo.
    const REUSE_WINDOW_MIN = 30;
    const sig = [...items].map((i) => `${i.productId}:${i.quantity}`).sort().join(",");
    const [openOrder] = await query<{
      id: string; pixQrCode: string | null; pixQrCodeUrl: string | null; pixExpiresAt: Date | null; itemSig: string | null;
    }>(
      `SELECT o.id, o.pixQrCode, o.pixQrCodeUrl, o.pixExpiresAt,
              (SELECT GROUP_CONCAT(CONCAT(oi.productId, ':', oi.quantity) ORDER BY oi.productId SEPARATOR ',')
                 FROM order_items oi WHERE oi.orderId = o.id) AS itemSig
         FROM orders o
        WHERE o.storeId = ? AND o.paymentMethod = 'PIX' AND o.status = 'PENDING'
          AND o.customerDocument = ? AND o.totalCents = ?
          AND o.pixQrCode IS NOT NULL
          AND o.createdAt >= DATE_SUB(NOW(3), INTERVAL ${REUSE_WINDOW_MIN} MINUTE)
          AND (o.pixExpiresAt IS NULL OR o.pixExpiresAt > NOW(3))
        ORDER BY o.createdAt DESC
        LIMIT 1`,
      [store.id, customer.cpf, amountCents],
    );
    if (openOrder?.pixQrCode && openOrder.itemSig === sig) {
      return json({
        orderId: openOrder.id,
        amountCents,
        pix: {
          qrCode: openOrder.pixQrCode,
          qrCodeUrl: openOrder.pixQrCodeUrl,
          expiresAt: openOrder.pixExpiresAt ? new Date(openOrder.pixExpiresAt).toISOString() : null,
        },
        reused: true,
      });
    }

    // Pedido de visitante (PENDING) + item, numa transação.
    const orderId = await withTransaction(async (conn) => {
      const id = newId();
      await conn.execute(
        // shipping/discount ficam gravados para a página do pedido poder mostrar
        // a composição real (frete separado), em vez de só a diferença.
        `INSERT INTO orders
           (id, storeId, userId, status, totalCents, shippingCents, discountCents, customerName, customerEmail, customerDocument, customerPhone, customerAddress, paymentMethod, gclid, ipHash, trackingParams, device)
         VALUES (?, ?, NULL, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 'PIX', ?, ?, ?, ?)`,
        [id, store.id, amountCents, shippingCents, Math.max(0, subtotalCents - (amountCents - shippingCents)), customer.name, customer.email, customer.cpf, customer.phone, address ? JSON.stringify(address) : null, gclid || null, ipHash, trackingJson, device],
      );
      for (const it of items) {
        await conn.execute(
          `INSERT INTO order_items (id, orderId, productId, quantity, unitPriceCents)
           VALUES (?, ?, ?, ?, ?)`,
          [newId(), id, it.productId, it.quantity, priceById.get(it.productId)!],
        );
      }
      return id;
    });

    // Gera o Pix no provedor configurado (customer.document = CPF só dígitos).
    // Split: decide UM gateway pra este pedido (determinístico pelo orderId).
    // `amountCents` habilita a regra de ticket alto (gateway alternativo acima
    // de um valor) — sem ele a regra não teria como ser aplicada.
    const primeiroGateway = await resolveOrderGateway(store.id, "pix", orderId, amountCents);
    let pixProvider = primeiroGateway;
    let charge;
    const falhas: { gateway: string | null; error: string }[] = [];
    {
      const checkoutHost = h.get("host") || "";
      // Dados ricos p/ o antifraude (sobretudo Mercado Pago): itens reais,
      // telefone e endereço de cobrança do comprador. Dados pobres = transação
      // reprovada/estornada e conta bloqueada.
      const phoneDigits = (customer.phone || "").replace(/\D/g, "");
      const nameParts = customer.name.trim().split(/\s+/);
      const additionalInfo = {
        items: items.map((it) => ({
          id: it.productId,
          title: gwNameById.get(it.productId) || "Produto",
          quantity: it.quantity,
          unitPriceCents: priceById.get(it.productId)!,
        })),
        payer: {
          firstName: nameParts[0] || customer.name,
          lastName: nameParts.slice(1).join(" ") || ".",
          ...(phoneDigits.length >= 10
            ? { phone: { areaCode: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) } }
            : {}),
          ...(address && (address.cep || address.street)
            ? { address: { zip: address.cep, street: address.street, number: address.number } }
            : {}),
        },
      };
      // Descrição = nome do(s) produto(s), não "Pedido <id>". Usa o mascarado.
      const firstItemName = gwNameById.get(items[0].productId) || "Compra";
      const description = items.length > 1 ? `${firstItemName} +${items.length - 1}` : firstItemName;
      // statement_descriptor: nome da loja no extrato do pagador (sem acento, ≤22).
      const statementDescriptor =
        (store.name || "CHECKOUT")
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^A-Za-z0-9 ]/g, "")
          .trim()
          .slice(0, 22) || "CHECKOUT";

      // Retentativa do Smart Routing: se não gerar, tenta o próximo gateway da lista.
      // Sem risco de cobrança dupla: o cliente só paga o código que recebe. Cada
      // gateway reescreve o postback para o próprio webhook. A leitura da lista não
      // pode impedir a primeira tentativa.
      const reservas = await getPixRetentativa(store.id, primeiroGateway).catch(() => [] as string[]);
      const inicio = Date.now();
      for (const gateway of [primeiroGateway, ...reservas]) {
        // Gateway lento (já vimos 10 a 25 s por tentativa) não pode deixar o cliente
        // esperando indefinidamente na frente do botão.
        if (falhas.length > 0 && Date.now() - inicio > LIMITE_RETENTATIVA_MS) break;
        try {
          const tentativa = await createProviderPixCharge(store.id, {
            amountCents,
            customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
            description,
            // Identificação única do pedido (exigida pelo MP e pela PinPay).
            externalReference: orderId,
            statementDescriptor,
            payerIp: ip || undefined,
            // Webhook do MP: avisa quando o Pix é pago (complementa o polling).
            notificationUrl: checkoutHost ? `https://${checkoutHost}/api/webhooks/mercadopago` : undefined,
            postbackUrl: checkoutHost ? `https://${checkoutHost}/api/webhooks/freepay` : undefined,
            forceProvider: gateway,
            // UTMs da sessão: a PushinPay aceita atribuição na própria cobrança.
            tracking,
            additionalInfo,
            shippingCents,
            address,
            checkoutUrl: checkoutHost ? `https://${checkoutHost}/checkout` : "https://checkout",
          });
          // Sem o copia e cola o cliente não tem como pagar: conta como falha.
          if (!tentativa?.qrCode) throw new Error("O gateway não devolveu o código Pix.");
          charge = tentativa;
          pixProvider = gateway;
          break;
        } catch (e) {
          const message = e instanceof Error ? e.message : "Falha ao gerar o Pix.";
          // A causa real vai para o LOG (ex.: gateway não configurado, erro da API).
          console.error("[pix] falha no gateway:", gateway, message);
          falhas.push({ gateway, error: message });
        }
      }
    }

    // Só a frase de cada gateway: o corpo técnico colado no erro estouraria o limite do
    // registro e levaria dados do pedido para um campo que o painel mostra.
    const tentativas = falhas.map((f) => ({ gateway: f.gateway, error: fraseDoGateway(f.error).slice(0, 300) }));

    if (!charge) {
      // O comprador recebe texto genérico: mensagem de integração não pode aparecer
      // no checkout. A exceção é o teto de valor (ver safePixMessage), e ele vale
      // mesmo que tenha vindo de só um dos gateways.
      const mensagem = falhas.map((f) => safePixMessage(f.error)).find((m) => m !== PIX_GENERIC) ?? PIX_GENERIC;
      // O pedido não tem Pix e nunca vai ter: cancela e guarda o motivo, como
      // o cartão faz. Antes ele ficava "Pix pendente" sem QR, o lojista via
      // venda esperando pagamento que não existia, e o motivo só ficava no log.
      // (O lead NÃO é marcado como convertido: isso só acontece depois do Pix
      // gerado, logo abaixo, e a recuperação do carrinho segue de pé.)
      await execute(
        `UPDATE orders SET status = 'CANCELLED', paymentGateway = ?, providerPayload = ? WHERE id = ? AND status = 'PENDING'`,
        [
          primeiroGateway,
          JSON.stringify({
            gateway: primeiroGateway,
            error: (falhas[0]?.error ?? "Falha ao gerar o Pix.").slice(0, 2000),
            ...(tentativas.length > 1 ? { tentativas } : {}),
          }),
          orderId,
        ],
      ).catch(() => {});
      return json({ error: mensagem }, 502);
    }

    // Deu certo depois de falhar: o lojista precisa saber, senão o gateway principal
    // passa semanas fora do ar sem ninguém perceber.
    if (tentativas.length > 0) {
      await execute(`UPDATE orders SET providerPayload = ? WHERE id = ?`, [JSON.stringify({ gateway: pixProvider, tentativas }), orderId]).catch(() => {});
    }

    // A imagem do QR é OPCIONAL e a coluna é VARCHAR(512); o copia-e-cola e o id
    // da transação é que são essenciais. Um gateway que devolva a imagem em
    // base64 (a PushinPay devolve) estouraria a coluna e derrubaria este UPDATE
    // — e aí a cobrança existe no gateway mas o pedido fica sem providerTxnId,
    // órfão: o webhook do pagamento chega e não acha o pedido. Descartar a
    // imagem é sempre melhor que perder o vínculo (o checkout desenha o QR a
    // partir do copia-e-cola de qualquer forma).
    const qrCodeUrl = charge.qrCodeUrl && charge.qrCodeUrl.length <= 512 ? charge.qrCodeUrl : null;
    if (charge.qrCodeUrl && !qrCodeUrl) {
      console.error(`[pix] imagem do QR descartada (${charge.qrCodeUrl.length} caracteres > 512) gateway=${pixProvider} pedido=${orderId}`);
    }

    // Mesma lógica para a expiração: uma data que o gateway devolva em formato
    // inesperado viraria Invalid Date e derrubaria este mesmo UPDATE. Sem
    // expiração o Pix ainda funciona (a contagem na tela é de 30 min a partir da
    // criação do pedido); sem providerTxnId, não.
    let expiresAt: Date | null = null;
    if (charge.expiresAt) {
      const d = new Date(charge.expiresAt);
      if (Number.isFinite(d.getTime())) expiresAt = d;
      else console.error(`[pix] expiração ilegível ("${charge.expiresAt}") gateway=${pixProvider} pedido=${orderId}`);
    }

    // Registra QUAL gateway processou este pedido (fonte da verdade p/ status/rastreio).
    await execute(
      `UPDATE orders
         SET providerTxnId = ?, paymentGateway = ?, pixQrCode = ?, pixQrCodeUrl = ?,
             pixExpiresAt = ${expiresAt ? "?" : "NULL"}
       WHERE id = ?`,
      expiresAt
        ? [charge.id, pixProvider, charge.qrCode, qrCodeUrl, expiresAt, orderId]
        : [charge.id, pixProvider, charge.qrCode, qrCodeUrl, orderId],
    );

    // Registra a cobrança no histórico do pedido. Uma renovação futura vai
    // sobrescrever `providerTxnId`; é aqui que este id fica guardado para a
    // reconciliação ainda poder consultá-lo depois.
    await recordCharge({
      storeId: store.id,
      orderId,
      gateway: pixProvider,
      providerTxnId: charge.id,
      amountCents,
    });

    // Carrinho abandonado vira convertido SÓ AGORA, com o Pix existindo.
    // Antes isto rodava antes de chamar o gateway: com o gateway recusando, o
    // lead era dado como convertido sem ter Pix, e o e-mail de recuperação
    // (a única chance de trazê-lo de volta) era cancelado. Best-effort.
    if (sessionId) {
      try {
        await execute(
          `UPDATE abandoned_carts SET status = 'CONVERTED', updatedAt = NOW(3)
           WHERE storeId = ? AND sessionId = ?`,
          [store.id, sessionId],
        );
      } catch {
        /* silencioso — não pode derrubar a entrega do Pix */
      }
      // Cancela o e-mail de recuperação agendado: quem acabou de gerar o Pix
      // não pode receber "você deixou algo no carrinho" 15 minutos depois.
      after(async () => {
        await cancelCartRecovery(store.id, sessionId);
      });
    }

    // ⚡ VELOCIDADE: o cliente só precisa do QR. Tudo que NÃO é essencial pra
    // exibir o Pix (Shopify, Utmify, notificação, e-mail) roda DEPOIS da resposta
    // via after() — o QR volta na hora que a adquirente responde, sem esperar o resto.
    after(async () => {
      // Repassa o pedido para a Shopify (pendente). Best-effort.
      try {
        const creds = await getShopifyPushCredentials(store.id);
        if (creds) {
          const lineItems = items.map((it) => ({
            title: nameById.get(it.productId) || "Produto",
            priceCents: priceById.get(it.productId)!,
            quantity: it.quantity,
          }));
          const discountCents = Math.max(0, subtotalCents - (amountCents - shippingCents));
          const draftId = await createShopifyDraftOrder(store.id, {
            lineItems,
            shippingCents,
            discountCents,
            customer: { name: customer.name, email: customer.email, phone: customer.phone, document: customer.cpf },
            address,
            note: `VoxPay ${orderId} — Pix`,
          });
          if (draftId) {
            await execute(`UPDATE orders SET shopifyDraftId = ? WHERE id = ?`, [draftId, orderId]);
            const pendingOrderId = await completeShopifyDraftOrder(store.id, draftId, true);
            if (pendingOrderId) {
              await execute(`UPDATE orders SET shopifyOrderId = ? WHERE id = ?`, [pendingOrderId, orderId]);
            }
          }
        }
      } catch (e) {
        console.error("[pix->shopify]", e);
      }
      // Dois eventos: o pedido nasceu E o Pix foi gerado. Quem assina só um dos
      // dois recebe só o seu.
      try { await notifySale(store.id, orderId, "order_created"); } catch (e) { console.error("[pix notify]", e); }
      try { await notifySale(store.id, orderId, "pix_generated"); } catch (e) { console.error("[pix notify]", e); }
      try { await sendUtmifyOrder(store.id, orderId, "waiting_payment"); } catch (e) { console.error("[pix utmify]", e); }
      await dispararEmail(store.id, orderId, "pix");
    });

    return json(
      {
        orderId,
        amountCents,
        pix: {
          qrCode: charge.qrCode,
          qrCodeUrl: charge.qrCodeUrl,
          expiresAt: charge.expiresAt,
        },
      },
      201,
    );
  } catch (err) {
    return handleError(err);
  }
}
