import { headers } from "next/headers";
import { after } from "next/server";
import { cardChargeSchema } from "@/lib/validation";
import { query, execute, withTransaction, newId, inPlaceholders } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { validateCoupon } from "@/lib/coupons";
import { cardChargeCents } from "@/lib/checkout-helpers";
import { createCardPayment } from "@/lib/mercadopago";
import { createCardPayment as createAppmaxCardPayment } from "@/lib/appmax";
import { createCardPayment as createFreepayCardPayment } from "@/lib/freepay";
import { createCardPayment as createWappiCardPayment } from "@/lib/wappi";
import { createCardPayment as createHypercashCardPayment } from "@/lib/hypercash";
import { createCardPayment as createFintpagCardPayment } from "@/lib/fintpag";
import { createCardPayment as createHylexpayCardPayment } from "@/lib/hylexpay";
import { createCardPayment as createBeehiveCardPayment } from "@/lib/beehive";
import { createCardPayment as createPagnivCardPayment, getPagnivCardConfig } from "@/lib/pagniv";
import { createCardPayment as createPagouCardPayment } from "@/lib/pagou";
import { createCardPayment as createBlackcatCardPayment } from "@/lib/blackcat";
import { createCardPayment as createPagarmeCardPayment } from "@/lib/pagarme";
import { createCardPayment as createVeopagCardPayment } from "@/lib/veopag";
import { createCardPayment as createMangofyCardPayment } from "@/lib/mangofy";
import { createCardPayment as createNuvraCardPayment } from "@/lib/nuvra";
import { createCardPayment as createBluevisionCardPayment } from "@/lib/bluevision";
import { resumoDaTentativa, gravarCartaoNoPedido, empilharRecusa } from "@/lib/card-tentativas";
import { safeCardMessage } from "@/lib/customer-errors";
import { detectDevice } from "@/lib/device";
import { settlePixOrder } from "@/lib/payments";
import { notifySale } from "@/lib/notifications";
import { cancelCartRecovery } from "@/lib/email";
import { sendUtmifyOrder, buildTrackingParams } from "@/lib/utmify";
import { resolveStoreByHost } from "@/lib/stores";
import { getCheckoutTheme, getShopifyPushCredentials, getPaymentRouting, getCardRouteGateways, resolveOrderGateway, getInstallmentFees } from "@/lib/settings";
import { mergeTheme } from "@/lib/checkout-theme";
import { createShopifyDraftOrder } from "@/lib/shopify";

// POST /api/checkout/card -> cria pedido de VISITANTE e cobra no CARTÃO via
// Mercado Pago (token gerado no navegador). Rota PÚBLICA. Regra de ouro: PREÇO
// e total (produto + frete + juros de parcelamento) são recalculados aqui no
// servidor — o cliente nunca dita o valor.

export async function POST(req: Request) {
  try {
    const h = await headers();
    const store = await resolveStoreByHost(h.get("host"));
    if (!store) return json({ error: "Loja não encontrada para este domínio" }, 404);

    // Cartão INLINE (transparente ou tokenizado no navegador).
    const routing = await getPaymentRouting(store.id);
    // Lista branca dos gateways que ESTA rota sabe cobrar. Um gateway novo tem
    // de entrar aqui também, senão o pedido é criado, cancelado e devolve
    // "Cartão indisponível para esta loja".
    // A Pagou entra mesmo não sendo "raw": o cartão dela vem tokenizado pelo
    // Payment Element (token pgct_), nunca em campos nossos.
    const rawCardProviders = ["mercadopago", "appmax", "freepay", "hypercash", "fintpag", "hylexpay", "beehive", "pagniv", "blackcat", "pagarme", "veopag", "mangofy", "nuvra", "bluevision", "pagou", "wappi"];
    // Com Smart Routing no cartão (distribuição ou condicional), o gateway vem
    // do navegador e precisa ser um dos que a regra permite. Sem regra, vale o
    // provedor único.
    const rotaGateways = await getCardRouteGateways(store.id);
    const splitOn = rotaGateways.length > 0;
    // Sem regra: valida cedo. Com regra, a escolha do navegador é conferida
    // depois de criar o pedido.
    if (!splitOn && !rawCardProviders.includes(routing.cardProvider ?? "")) {
      // `detail` não aparece para o cliente (o checkout só exibe `error`), mas
      // fica visível na aba Network e no log — sem ele, esse 400 é indistinguível
      // de uma falha de validação do corpo.
      const detail = `cardProvider=${routing.cardProvider ?? "nenhum"} aceitos=${rawCardProviders.join(",")}`;
      console.error("[card] gateway não aceito:", detail);
      return json({ error: "Cartão indisponível para esta loja.", detail }, 400);
    }
    const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim();

    const parsed = cardChargeSchema.safeParse(await req.json());
    if (!parsed.success) {
      // Mensagem específica do campo que falhou (o handleError genérico esconde
      // campos aninhados como customer.cpf).
      const first = parsed.error.issues[0];
      const field = first?.path?.join(".") ?? "";
      const friendly: Record<string, string> = {
        "customer.cpf": "CPF inválido. Confira os números.",
        "card.holderDocument": "CPF do titular inválido. Confira os números.",
        "customer.email": "E-mail inválido.",
        "customer.phone": "Telefone inválido.",
        "customer.name": "Informe o nome completo.",
        "card.token": "Não foi possível validar o cartão. Tente de novo.",
        "card.paymentMethodId": "Não reconhecemos a bandeira do cartão.",
        "card.installments": "Selecione o número de parcelas.",
      };
      return json({ error: friendly[field] ?? "Dados inválidos. Confira as informações e tente de novo." }, 400);
    }
    const { items, customer, couponCode, shippingOptionId, address, gclid, card, tracking, ga4, meta, sessionId } = parsed.data;
    const trackingJson = buildTrackingParams({ ...tracking, ...ga4, ...meta }, ip || null);

    // Preços do BANCO (regra de ouro).
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await query<{ id: string; name: string; maskedName: string | null; priceCents: number }>(
      `SELECT id, name, maskedName, priceCents FROM products
       WHERE active = 1 AND storeId = ? AND id IN (${inPlaceholders(ids.length)})`,
      [store.id, ...ids],
    );
    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    // Nome enviado ao GATEWAY: usa o nome mascarado (aba Criptografia) quando
    // houver; senão, o nome real. Shopify/e-mail/painel seguem com o nome real.
    const gwNameById = new Map(products.map((p) => [p.id, (p.maskedName?.trim() || p.name)]));
    for (const it of items) {
      if (!priceById.has(it.productId)) return json({ error: "Produto indisponível no carrinho" }, 400);
    }

    const subtotalCents = items.reduce((sum, i) => sum + priceById.get(i.productId)! * i.quantity, 0);

    let couponCents = 0;
    if (couponCode) {
      const result = await validateCoupon(store.id, couponCode, subtotalCents);
      if (!result.ok) return json({ error: result.error }, 400);
      couponCents = result.discountCents;
    }
    const afterCoupon = Math.max(0, subtotalCents - couponCents);

    let shippingCents = 0;
    if (shippingOptionId) {
      const theme = mergeTheme(await getCheckoutTheme(store.id));
      const opt = theme.shipping.options.find((o) => o.id === shippingOptionId && o.enabled);
      if (opt) shippingCents = opt.priceCents;
    }

    // Gateway deste pedido — decidido ANTES do valor, porque os juros são por
    // gateway. Com Smart Routing, o navegador escolheu (pela % ou pelo valor da
    // compra SEM juros) e validamos que é um dos gateways da regra; senão o
    // servidor decide pela mesma regra. Sem regra, vale o provedor único.
    const baseCents = afterCoupon + shippingCents;
    const orderIdNovo = newId();
    let cardProvider: string | null;
    if (splitOn) {
      const chosen = card.gateway ?? "";
      cardProvider = rotaGateways.includes(chosen)
        ? chosen
        : await resolveOrderGateway(store.id, "card", orderIdNovo, baseCents);
    } else {
      cardProvider = routing.cardProvider;
    }

    // Cartão: SEM desconto — os juros de parcelamento são REPASSADOS ao cliente
    // (gross-up sobre produto + frete, conforme o nº de parcelas). Usa a tabela
    // do GATEWAY que vai cobrar (ou a geral da loja) — regra de ouro no servidor,
    // com o mesmo critério que o checkout usou para mostrar as parcelas.
    const installmentFees = await getInstallmentFees(store.id, cardProvider);
    const amountCents = cardChargeCents(baseCents, card.installments, installmentFees);
    if (amountCents <= 0) return json({ error: "Valor do pedido inválido" }, 400);

    // Pedido de visitante (PENDING) + itens.
    const orderId = await withTransaction(async (conn) => {
      const id = orderIdNovo;
      await conn.execute(
        // shipping/discount gravados para a página do pedido mostrar a composição
        // real. No cartão o desconto é só o cupom (não há desconto de método) —
        // a diferença que sobra no total são os juros de parcelamento.
        `INSERT INTO orders
           (id, storeId, userId, status, totalCents, shippingCents, discountCents, customerName, customerEmail, customerDocument, customerPhone, customerAddress, paymentMethod, gclid, trackingParams, device)
         VALUES (?, ?, NULL, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 'CREDIT_CARD', ?, ?, ?)`,
        [id, store.id, amountCents, shippingCents, couponCents, customer.name, customer.email, customer.cpf, customer.phone, address ? JSON.stringify(address) : null, gclid || null, trackingJson, detectDevice(h.get("user-agent"))],
      );
      for (const it of items) {
        await conn.execute(
          `INSERT INTO order_items (id, orderId, productId, quantity, unitPriceCents) VALUES (?, ?, ?, ?, ?)`,
          [newId(), id, it.productId, it.quantity, priceById.get(it.productId)!],
        );
      }
      return id;
    });

    // Cartão MASCARADO no pedido (6 primeiros + 4 últimos, bandeira, validade,
    // titular) — nunca o número inteiro nem o CVV. É o que identifica o mesmo
    // cartão em tentativas seguidas (lib/card-tentativas.ts).
    await gravarCartaoNoPedido(orderId, resumoDaTentativa(card));

    // Fecha o carrinho abandonado desta sessão. O Pix e a InfinitePay já faziam
    // isso; o cartão NÃO fazia — e por isso quem pagava no cartão continuava na
    // lista de carrinhos abandonados para sempre (169 casos só na Della Decor).
    if (sessionId) {
      try {
        await execute(
          `UPDATE abandoned_carts SET status = 'CONVERTED', updatedAt = NOW(3)
           WHERE storeId = ? AND sessionId = ?`,
          [store.id, sessionId],
        );
      } catch {
        /* silencioso — não pode derrubar a cobrança */
      }
      // Cancela o e-mail de recuperação agendado no Resend.
      after(async () => {
        await cancelCartRecovery(store.id, sessionId);
      });
    }

    // A Utmify NÃO é avisada aqui.
    //
    // No cartão a cobrança é decidida na mesma requisição, então mandar
    // "waiting_payment" antes e "paid" segundos depois cria duas escritas quase
    // simultâneas para o MESMO pedido. A Utmify processa em paralelo e grava na
    // ordem em que termina, não na ordem em que recebe — o resultado é o pendente
    // aparecendo DEPOIS do aprovado e o funil mostrando venda que voltou atrás.
    //
    // Cada desfecho manda o seu evento, uma vez só, depois de conhecido:
    // aprovado -> "paid" (no settle), recusado -> "refused", análise -> "waiting_payment".

    // Dados ricos p/ o antifraude do Mercado Pago (reduz recusas "high_risk").
    const nameParts = customer.name.trim().split(/\s+/);
    let phoneDigits = customer.phone.replace(/\D/g, "");
    if (phoneDigits.length > 11 && phoneDigits.startsWith("55")) phoneDigits = phoneDigits.slice(2);
    const additionalInfo = {
      items: items.map((it) => ({ id: it.productId, title: gwNameById.get(it.productId) || "Produto", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
      payer: {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || undefined,
        phone: phoneDigits.length >= 10 ? { areaCode: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) } : undefined,
        address: address ? { zip: address.cep, street: address.street, number: address.number } : undefined,
      },
      shipmentAddress: address ? { zip: address.cep, street: address.street, number: address.number, city: address.city, state: address.uf } : undefined,
    };

    // O gateway já foi decidido lá em cima (antes do valor). Aqui só a última
    // barreira: ele precisa ser um que esta rota sabe cobrar.
    if (!rawCardProviders.includes(cardProvider ?? "")) {
      await execute(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`, [orderId]);
      const detail = `pos-pedido cardProvider=${cardProvider ?? "nenhum"} split=${splitOn}`;
      console.error("[card] gateway não aceito:", detail);
      return json({ error: "Cartão indisponível para esta loja.", detail }, 400);
    }

    // Cobra no cartão.
    let payment: { id: string; status: string; statusDetail: string; threeDs?: { externalResourceUrl: string; creq: string } };
    // Só a Pagou usa: a resposta dela volta intacta ao navegador (3DS).
    let pagouRaw: Record<string, unknown> | null = null;
    try {
      const cardHost = h.get("host") || "";
      const description = gwNameById.get(items[0].productId) || `Pedido ${orderId}`;

      if (cardProvider === "appmax") {
        // Appmax: transparente. Os dados do cartão só trafegam em memória (TLS)
        // até a Appmax — nunca são gravados no banco nem logados.
        payment = await createAppmaxCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          address,
          softDescriptor: store.name,
          // Itens reais (nome mascarado, qtd, preço) + frete p/ o painel Appmax.
          // `productId` define o SKU lá (1 SKU por produto, nunca por nome).
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)!, productId: it.productId })),
          shippingCents,
          card: {
            token: card.token,
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
            holderDocument: card.holderDocument || customer.cpf,
          },
        });
      } else if (cardProvider === "hypercash") {
        // HyperCash: transparente. A API deles NÃO aceita token no corpo da
        // transação (recusa com "card.property token should not exist") — exige
        // os campos crus. Repassados via TLS, nunca gravados/logados.
        payment = await createHypercashCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/hypercash` : undefined,
          // Origem da venda + entrega. A HyperCash exige essa identificação na
          // transação; sem ela a conta foi bloqueada.
          externalReference: orderId,
          checkoutUrl: cardHost ? `https://${cardHost}/checkout` : undefined,
          address,
          shippingCents,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          card: {
            number: card.number ?? "",
            cvv: card.cvv ?? "",
            expirationMonth: card.expirationMonth ?? "",
            expirationYear: card.expirationYear ?? "",
            holderName: card.holderName ?? "",
          },
        });
      } else if (cardProvider === "fintpag") {
        // FintPag (motor Shield): tokenizado (hash + sessionId/fingerprint do SDK
        // /v1/js) OU cru como fallback. Enviamos endereço + entrega (antifraude).
        // O cartão cru só trafega em memória (TLS) — nunca é gravado nem logado.
        payment = await createFintpagCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/fintpag` : undefined,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          address,
          shippingCents,
          sessionId: sessionId || undefined,
          card: {
            hash: card.hash,
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "beehive") {
        // Beehive: o cartão é tokenizado no NAVEGADOR (POST /v1/card-token),
        // e aqui só chega o token — nenhum dado de cartão passa por nós.
        payment = await createBeehiveCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          externalReference: orderId,
          checkoutUrl: cardHost ? `https://${cardHost}/checkout` : undefined,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/beehive` : undefined,
          address,
          shippingCents,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          cardToken: card.token ?? "",
          fingerprint: card.fingerprint,
          tokenShape: card.tokenShape,
        });
      } else if (cardProvider === "pagniv") {
        // PagNiv: token gerado no navegador contra a URL de tokenização DELES.
        // Síncrono — a resposta já vem PAID ou recusada (402).
        //
        // `externalReference` é o orderId e aqui é OBRIGATÓRIO: além de ser a
        // chave de idempotência da PagNiv, é o que volta no webhook e casa o
        // evento com este pedido.
        const cfgPagniv = await getPagnivCardConfig(store.id);
        const r = await createPagnivCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          maxInstallments: cfgPagniv?.maxInstallments,
          externalReference: orderId,
          cardToken: card.token ?? "",
        });
        // A bandeira e o final vêm de `card.brand`/`card.last4` do próprio
        // pedido (detectados no checkout), como nos demais gateways — os que a
        // PagNiv devolve seriam a mesma informação por outro caminho.
        payment = { id: r.id, status: r.status, statusDetail: r.statusDetail };
      } else if (cardProvider === "pagou") {
        // Pagou: o cartão é tokenizado pelo Payment Element, num iframe DELES.
        // Aqui só chega o token `pgct_` — nenhum dado de cartão passa por nós.
        const r = await createPagouCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          externalReference: orderId,
          checkoutUrl: cardHost ? `https://${cardHost}/checkout` : undefined,
          storeName: store.name,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/pagou` : undefined,
          address,
          shippingCents,
          // Valor ANTES do acréscimo de parcelamento: é o que permite declarar
          // `interest_rate` em vez de deixar os juros escondidos no total.
          baseAmountCents: afterCoupon + shippingCents,
          items: items.map((it) => ({
            name: gwNameById.get(it.productId) || "Item",
            quantity: it.quantity,
            unitPriceCents: priceById.get(it.productId)!,
            sku: it.productId,
          })),
          token: card.token ?? "",
        });
        payment = { id: r.id, status: r.status, statusDetail: r.statusDetail };
        // Guardado para devolver ao navegador SEM ALTERAR: é de onde o Payment
        // Element lê o `next_action` e conclui o 3D Secure sozinho.
        pagouRaw = r.raw;
      } else if (cardProvider === "hylexpay") {
        // HylexPay (motor Shield, igual FintPag): tokenizado (hash + sessionId) OU
        // cru como fallback. Endereço + entrega para o antifraude.
        payment = await createHylexpayCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/hylexpay` : undefined,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          address,
          shippingCents,
          sessionId: sessionId || undefined,
          card: {
            hash: card.hash,
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "blackcat") {
        // BlackCat: cartão direto (sem SDK). Os dados só trafegam em memória até
        // a BlackCat, via TLS — nunca gravados nem logados. Se o banco pedir
        // 3DS, volta `threeDs` e o checkout abre o desafio (status "challenge").
        payment = await createBlackcatCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/blackcat` : undefined,
          address,
          shippingCents,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          device: { userAgent: h.get("user-agent") ?? undefined, language: h.get("accept-language") ?? undefined },
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "pagarme") {
        // Pagar.me: cartão direto (sem SDK). Dados só em memória até a Pagar.me,
        // via TLS — nunca gravados nem logados. Síncrono: volta pago, recusado
        // ou pendente (antifraude em análise manual).
        payment = await createPagarmeCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          externalReference: orderId,
          address,
          shippingCents,
          storeName: store.name,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)!, code: it.productId })),
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "veopag") {
        // VeoPag: cartão direto (sem SDK), síncrono. Recusa da operadora volta
        // como DECLINED (HTTP 402 deles), não como erro. Dados só em memória
        // até a VeoPag, via TLS — nunca gravados nem logados.
        payment = await createVeopagCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          installments: card.installments,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/veopag` : undefined,
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "mangofy") {
        // MangoFy: cartão direto (sem SDK), síncrono. Recusa volta DECLINED
        // (HTTP 400 deles com o motivo em card_rejected). O IP do comprador é
        // obrigatório lá. Dados só em memória, via TLS — nunca gravados.
        payment = await createMangofyCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/mangofy` : undefined,
          payerIp: ip || undefined,
          userAgent: h.get("user-agent") ?? undefined,
          address,
          shippingCents,
          storeName: store.name,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)!, code: it.productId })),
          tracking: tracking ?? undefined,
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "nuvra") {
        // Nuvra: token gerado no navegador contra a URL de tokenização deles; o
        // `processor` da conta entra aqui, lido no servidor. Exige CEP e número
        // do TITULAR: usamos o endereço de entrega, o único que o checkout pede.
        // Recusa da adquirente volta DECLINED (402 deles).
        const r = await createNuvraCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          installments: card.installments,
          externalReference: orderId,
          cardToken: card.token ?? "",
          holderName: card.holderName || customer.name,
          holderDocument: card.holderDocument || customer.cpf,
          holderPostalCode: address?.cep ?? "",
          holderAddressNumber: address?.number ?? "",
          // Nome na fatura: o da loja, como nos outros gateways (a Nuvra corta
          // em ~13 caracteres). O produto não vai aqui.
          statementDescriptor: store.name,
        });
        payment = { id: r.id, status: r.status, statusDetail: r.statusDetail };
      } else if (cardProvider === "bluevision") {
        // Blue Vision: tokeniza no servidor (POST /cards/tokenize) e cobra com o
        // token. Dados crus só em memória até eles, via TLS, nunca gravados.
        const r = await createBluevisionCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          externalReference: orderId,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/bluevision` : undefined,
          address,
          shippingCents,
          items: items.map((it) => ({ name: gwNameById.get(it.productId) || "Item", quantity: it.quantity, unitPriceCents: priceById.get(it.productId)! })),
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
        payment = { id: r.id, status: r.status, statusDetail: r.statusDetail };
      } else if (cardProvider === "freepay") {
        // Freepay: transparente (mesma política de dados do cartão da Appmax).
        payment = await createFreepayCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          address,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/freepay` : undefined,
          card: {
            token: card.token,
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else if (cardProvider === "wappi") {
        // Wappi: mesmo motor da Freepay, cartão transparente (dados só em memória).
        payment = await createWappiCardPayment(store.id, {
          amountCents,
          customer: { name: customer.name, email: customer.email, document: customer.cpf, phone: customer.phone },
          description,
          installments: card.installments,
          payerIp: ip || undefined,
          address,
          postbackUrl: cardHost ? `https://${cardHost}/api/webhooks/wappi` : undefined,
          card: {
            number: card.number,
            cvv: card.cvv,
            expirationMonth: card.expirationMonth,
            expirationYear: card.expirationYear,
            holderName: card.holderName,
          },
        });
      } else {
        // Mercado Pago: exige o token gerado no navegador.
        if (!card.token || !card.paymentMethodId) {
          await execute(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`, [orderId]);
          return json({ error: "Não foi possível validar o cartão. Tente de novo." }, 400);
        }
        payment = await createCardPayment(store.id, {
          amountCents,
          token: card.token,
          installments: card.installments,
          paymentMethodId: card.paymentMethodId,
          issuerId: card.issuerId,
          description,
          externalReference: orderId,
          notificationUrl: cardHost ? `https://${cardHost}/api/webhooks/mercadopago` : undefined,
          payer: { email: customer.email, document: customer.cpf, firstName: nameParts[0], lastName: nameParts.slice(1).join(" ") || undefined },
          deviceId: card.deviceId ?? undefined,
          additionalInfo,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao processar o cartão.";
      // Guarda o motivo NO PEDIDO. Sem isso, uma recusa do gateway só existe no
      // log do servidor e vira caça ao tesouro — o pedido fica cancelado, sem
      // gateway e sem transação, sem dizer por quê.
      // A bandeira entra AQUI também, não só na recusa devolvida como DECLINED.
      // É justamente neste caminho que cai o "This card is not accepted" da
      // Pagou — e saber qual bandeira a adquirente rejeitou é a informação que
      // resolve, sem ela é só um cartão anônimo recusado.
      await execute(
        `UPDATE orders SET status = 'CANCELLED', paymentGateway = ?, providerPayload = ? WHERE id = ?`,
        [
          cardProvider,
          JSON.stringify({
            gateway: cardProvider,
            ...(card.brand ? { bandeira: card.brand } : {}),
            ...(card.last4 ? { final: card.last4 } : {}),
            error: message,
          }).slice(0, 4000),
          orderId,
        ],
      );
      // O pedido EXISTE e ficou cancelado, então o cliente precisa acabar na
      // página dele (estado "não aprovado"), e não preso num aviso no checkout.
      // Mandar o orderId aqui é a rede de segurança para qualquer gateway que
      // ainda sinalize recusa lançando erro em vez de devolver DECLINED.
      after(async () => {
        // Mesmo cartão recusado de novo → empilha na linha anterior ("3×").
        await empilharRecusa(store.id, orderId);
        try { await notifySale(store.id, orderId, "order_refused"); } catch (err) { console.error("[card notify]", err); }
        // Idem ao DECLINED: aqui o gateway sinalizou a recusa lançando erro, e o
        // pedido também acabou CANCELLED sem passar pelo settle.
        try { await sendUtmifyOrder(store.id, orderId, "refused"); } catch (err) { console.error("[card utmify]", err); }
      });
      // O cliente NÃO vê a mensagem do gateway: ela é escrita para o lojista
      // (cita o gateway, manda falar com o suporte, expõe a conta). O motivo
      // real já foi para o log e para o providerPayload do pedido.
      console.error("[card] falha no gateway:", cardProvider, `bandeira=${card.brand ?? "-"} final=${card.last4 ?? "-"}`, message);
      return json(
        { ok: false, status: "rejected", orderId, error: safeCardMessage(message) },
        502,
      );
    }

    await execute(
      `UPDATE orders SET providerTxnId = ?, paymentGateway = ? WHERE id = ?`,
      [payment.id || null, cardProvider, orderId],
    );

    // Cartão RECUSADO: cancela o pedido e devolve o motivo.
    if (payment.status === "DECLINED") {
      // O MOTIVO tem de ficar no pedido. Antes só gravávamos payload quando o
      // gateway LANÇAVA erro; numa recusa normal o pedido ficava CANCELLED com
      // providerPayload vazio, e descobrir por que o cartão do cliente não
      // passou virava caça ao log do servidor.
      await execute(
        `UPDATE orders SET status = 'CANCELLED', providerPayload = ? WHERE id = ?`,
        [declinePayload(cardProvider, payment.statusDetail, pagouRaw, card), orderId],
      );
      // Webhook "Pedido recusado". Vai em after() para não atrasar a resposta —
      // a recusa aqui é síncrona, então não passa pelo settle (que notifica as
      // recusas que chegam depois, por webhook do gateway).
      after(async () => {
        // Mesmo cartão recusado de novo → empilha na linha anterior ("3×").
        await empilharRecusa(store.id, orderId);
        try { await notifySale(store.id, orderId, "order_refused"); } catch (e) { console.error("[card notify]", e); }
        // A recusa síncrona não passa pelo settle, que é quem avisa a Utmify.
        // Sem isto o pedido recusado ficava "waiting_payment" para sempre lá —
        // o funil contava como cliente esperando pagar alguém que já foi negado.
        try { await sendUtmifyOrder(store.id, orderId, "refused"); } catch (e) { console.error("[card utmify]", e); }
      });
      // `orderId` vai junto para o checkout conseguir levar o cliente à página
      // do pedido com o estado "não aprovado" (e o motivo). A frase crua do
      // gateway não vai: fica no pedido, para o lojista (`declinePayload`).
      return json(
        {
          ok: false,
          status: "rejected",
          orderId,
          error: safeCardMessage(payment.statusDetail),
          ...(pagouRaw ? { data: pagouRaw } : {}),
        },
        402,
      );
    }

    const approved = payment.status === "APPROVED";
    const threeDs = payment.threeDs;

    // ⚡ VELOCIDADE: o cliente já tem o resultado da cobrança. Shopify + liquidação
    // (marcar pago, e-mails, notificação) rodam DEPOIS da resposta via after() —
    // a tela de "aprovado" aparece na hora, sem esperar a Shopify.
    after(async () => {
      // Cria o pedido na Shopify (best-effort). Aprovado -> pago; pendente -> pendente.
      let shopifyDraftId: string | null = null;
      try {
        const creds = await getShopifyPushCredentials(store.id);
        if (creds) {
          const lineItems = items.map((it) => ({
            title: nameById.get(it.productId) || "Produto",
            priceCents: priceById.get(it.productId)!,
            quantity: it.quantity,
          }));
          const discountCents = Math.max(0, subtotalCents - (amountCents - shippingCents));
          shopifyDraftId = await createShopifyDraftOrder(store.id, {
            lineItems,
            shippingCents,
            discountCents,
            customer: { name: customer.name, email: customer.email, phone: customer.phone, document: customer.cpf },
            address,
            note: `VoxPay ${orderId} — Cartão`,
          });
          if (shopifyDraftId) await execute(`UPDATE orders SET shopifyDraftId = ? WHERE id = ?`, [shopifyDraftId, orderId]);
        }
      } catch (e) {
        console.error("[card->shopify]", e);
      }

      if (approved) {
        // Marca pago (VoxPay + Shopify) + e-mails + notifica, via a mesma lógica do Pix.
        try { await settlePixOrder(store.id, { id: orderId, shopifyOrderId: null, shopifyDraftId }, "PAID"); } catch (e) { console.error("[card settle]", e); }
        return;
      }
      // Pendente/em análise: completa o rascunho como pedido pendente e notifica.
      try {
        if (shopifyDraftId) {
          const { completeShopifyDraftOrder } = await import("@/lib/shopify");
          const pendingId = await completeShopifyDraftOrder(store.id, shopifyDraftId, true);
          if (pendingId) await execute(`UPDATE orders SET shopifyOrderId = ? WHERE id = ?`, [pendingId, orderId]);
        }
      } catch (e) {
        console.error("[card pending->shopify]", e);
      }
      try { await notifySale(store.id, orderId, "order_created"); } catch (e) { console.error("[card notify]", e); }
      // ÚNICO lugar onde o cartão manda "waiting_payment": aqui o pedido está
      // mesmo esperando (análise antifraude ou 3DS pendente). Se depois aprovar
      // ou recusar, quem avisa é o settle — e nessa altura já não há corrida,
      // porque as duas escritas ficam separadas por minutos, não por segundos.
      try { await sendUtmifyOrder(store.id, orderId, "waiting_payment"); } catch (e) { console.error("[card utmify]", e); }
    });

    // `data` só existe na Pagou: é a resposta dela INTACTA, de onde o Payment
    // Element lê o next_action e conclui o 3D Secure. Os outros gateways não
    // mandam esse campo, então nada muda para eles.
    const extra = pagouRaw ? { data: pagouRaw } : {};
    if (approved) return json({ ok: true, status: "approved", orderId, amountCents, ...extra }, 201);
    // 3DS 2.0: se o MP devolveu um desafio, o cliente precisa autenticar no banco
    // (iframe). O pedido segue PENDING até a autenticação aprovar/recusar.
    if (threeDs) return json({ ok: true, status: "challenge", orderId, amountCents, threeDs }, 201);
    return json({ ok: true, status: "pending", orderId, amountCents, ...extra }, 201);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Motivo da recusa para gravar no pedido (`providerPayload`, TEXT com teto de
 * 4000 no nosso uso).
 *
 * A resposta crua do gateway entra quando cabe — é onde mora o motivo real —,
 * mas nunca ao custo do essencial: se estourar, cortamos a resposta crua e
 * gravamos só gateway + status. Truncar o JSON no meio deixaria um valor que
 * não faz parse e valeria tanto quanto nada.
 */
function declinePayload(
  gateway: string | null,
  detail: string,
  raw: Record<string, unknown> | null,
  card: { brand?: string; last4?: string },
): string {
  // Bandeira e 4 últimos: não são dados sensíveis (PCI permite guardar) e são o
  // que revela recusa concentrada numa bandeira que a adquirente não aceita.
  const base = {
    gateway,
    status: detail || null,
    ...(card.brand ? { bandeira: card.brand } : {}),
    ...(card.last4 ? { final: card.last4 } : {}),
  };
  if (raw) {
    const completo = JSON.stringify({ ...base, resposta: raw });
    if (completo.length <= 4000) return completo;
  }
  return JSON.stringify(base);
}
