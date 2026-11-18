import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Regra única do que é um CARRINHO ABANDONADO.
//
// Vive aqui, e não dentro de cada tela, porque o Dashboard e a página de
// Carrinhos já divergiram uma vez: o cartão mostrava um número e a lista
// mostrava outro. Quem muda a regra agora muda nos dois de uma vez.
//
// É abandonado quando:
//   1. o contato foi preenchido e a cobrança NUNCA foi gerada (status OPEN);
//   2. o cliente JÁ SAIU do checkout — pelo aviso de saída do navegador, na
//      hora; ou, se o aviso não chegou, por 15 min de silêncio;
//   3. o cliente não pagou DEPOIS de abrir este carrinho;
//   4. e, entre as voltas do mesmo cliente com o mesmo carrinho, só a última
//      conta — a menos que ele tenha mexido nos produtos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Silêncio necessário para chamar um carrinho de abandonado.
 *
 * A linha nasce assim que o cliente digita o contato, mas nesse instante ele
 * ainda está comprando — aparecer na lista de "abandonados" enquanto a pessoa
 * preenche o endereço é ruído, e leva o lojista a cobrar quem está no meio da
 * compra.
 *
 * O relógio é o `updatedAt`, que recebe DOIS sinais de vida: o salvamento do
 * lead (mexeu num campo) e a batida de presença do checkout (está com a aba
 * aberta). O segundo é o que importa — parar de digitar não é sair.
 *
 * É o mesmo número do e-mail de recuperação de propósito: o carrinho entra na
 * lista no mesmo instante em que o e-mail fica devido.
 */
export const ABANDON_AFTER_MINUTES = 15;

/**
 * Tolerância depois do aviso de saída, antes de chamar de abandono.
 *
 * O aviso dispara também quando o cliente troca de aba ou sai do navegador para
 * pegar o cartão — no celular isso acontece o tempo todo. Sem esta folga, o
 * carrinho piscaria dentro e fora da lista a cada troca de app.
 *
 * Meio minuto é curto o bastante para continuar sendo "na hora" e longo o
 * bastante para a volta rápida não virar linha na tela: ao voltar, a batida
 * apaga a saída.
 */
export const EXIT_GRACE_SECONDS = 30;

/**
 * "O cliente não está mais no checkout."
 *
 * Duas fontes, e a ordem importa: o AVISO de saída (evento, imediato) e, como
 * rede de segurança, o silêncio prolongado — para o aviso que nunca chegou
 * porque a aba morreu, o celular matou a página ou um bloqueador comeu o
 * beacon.
 */
const SAIU_DO_CHECKOUT = `(
  (ac.exitedAt IS NOT NULL AND ac.exitedAt <= DATE_SUB(NOW(3), INTERVAL ${EXIT_GRACE_SECONDS} SECOND))
  OR ac.updatedAt <= DATE_SUB(NOW(3), INTERVAL ${ABANDON_AFTER_MINUTES} MINUTE)
)`;

/**
 * Identidade do cliente para agrupar. E-mail primeiro, telefone depois.
 *
 * Sem contato nenhum, cai na SESSÃO: sem esse último degrau, todos os carrinhos
 * anônimos teriam a mesma chave (NULL) e colapsariam num só — apagando visitas
 * de pessoas diferentes.
 */
const CONTATO = `COALESCE(
  NULLIF(LOWER(TRIM(ac.email)), ''),
  NULLIF(REGEXP_REPLACE(COALESCE(ac.phone, ''), '[^0-9]', ''), ''),
  CONCAT('sessao:', ac.sessionId)
)`;

/**
 * Assinatura do carrinho: os ids dos produtos, sem repetição e em ordem.
 *
 * Ordenar é o que faz "A,B" e "B,A" serem o mesmo carrinho. A QUANTIDADE fica
 * de fora de propósito — voltar e mudar de 1 para 2 unidades é a mesma intenção
 * de compra; só um produto A MAIS abre uma linha nova.
 */
const ASSINATURA = `(
  SELECT GROUP_CONCAT(DISTINCT jt.productId ORDER BY jt.productId SEPARATOR ',')
    FROM JSON_TABLE(ac.itemsJson, '$[*]' COLUMNS (productId VARCHAR(64) PATH '$.productId')) jt
)`;

/**
 * "Não comprou depois de abrir este carrinho."
 *
 * São DOIS `NOT EXISTS` em vez de um com `OR` dentro, e a diferença não é
 * estilo: com o `OR`, o MySQL não consegue usar índice nenhum e varre os
 * pedidos da loja inteira para cada carrinho — media 3,8 s na Della Decor,
 * contra 64 ms sem esta condição. Separados, cada um entra pelo seu índice
 * (idx_orders_store_email / idx_orders_store_phone).
 *
 * Equivalem ao original: NOT(A OR B) é o mesmo que NOT(A) AND NOT(B). E quando
 * o contato é nulo a comparação nunca casa, então o `NOT EXISTS` fica verdadeiro
 * sozinho — o mesmo efeito do antigo `ac.email IS NOT NULL AND ...`.
 */
const SEM_COMPRA_DEPOIS = `
  NOT EXISTS (
    SELECT 1 FROM orders o
     WHERE o.storeId = ac.storeId AND o.customerEmail = ac.email
       AND o.status IN ('PAID','SHIPPED') AND o.createdAt >= ac.createdAt
  )
  AND NOT EXISTS (
    SELECT 1 FROM orders o
     WHERE o.storeId = ac.storeId AND o.customerPhone = ac.phone
       AND o.status IN ('PAID','SHIPPED') AND o.createdAt >= ac.createdAt
  )`;

/**
 * SQL dos carrinhos abandonados já sem duplicidade, pronto para ser embrulhado.
 *
 * Devolve uma linha por (cliente × carrinho), a MAIS RECENTE, com `tentativas`
 * dizendo quantas vezes aquela pessoa voltou com o mesmo carrinho.
 *
 * `rangeSql` é a cláusula de período (já com os `?`), e deve vir prefixada com
 * o alias `ac.` — dentro daqui existe um segundo FROM (orders) e uma coluna
 * solta ficaria ambígua.
 */
export function abandonedCartsSql(rangeSql = ""): string {
  return `
    WITH base AS (
      SELECT ac.id, ac.name, ac.email, ac.phone, ac.totalCents, ac.itemsJson,
             ac.step, ac.createdAt, ac.updatedAt, ac.recoveryEmailAt, ac.recoveryEmailId,
             ${CONTATO} AS contato,
             ${ASSINATURA} AS assinatura
        FROM abandoned_carts ac
       WHERE ac.storeId = ? AND ac.status = 'OPEN'${rangeSql}
         -- Ainda com o checkout aberto? Então não abandonou.
         AND ${SAIU_DO_CHECKOUT}
         -- Pagou depois de abrir ESTE carrinho? Então não abandonou.
         -- A comparação com createdAt é o que preserva o cliente antigo que
         -- voltou e abriu um carrinho novo hoje.
         AND ${SEM_COMPRA_DEPOIS}
    ),
    agrupado AS (
      SELECT base.*,
             ROW_NUMBER() OVER (
               PARTITION BY contato, assinatura
               ORDER BY updatedAt DESC, createdAt DESC
             ) AS rn,
             COUNT(*) OVER (PARTITION BY contato, assinatura) AS tentativas
        FROM base
    )
    SELECT * FROM agrupado WHERE rn = 1`;
}

/**
 * Janela de atribuição do e-mail de recuperação.
 *
 * Comprou DEPOIS do e-mail não é o mesmo que comprou POR CAUSA do e-mail. Sem
 * um teto, o cliente que voltasse sozinho três semanas depois entraria na
 * conta e o número viraria propaganda em vez de medida.
 *
 * 72 h é o padrão de mercado para e-mail de carrinho: o link vai no corpo da
 * mensagem, então quem volta, volta no mesmo dia ou no seguinte.
 */
export const RECOVERY_ATTRIBUTION_HOURS = 72;

/**
 * Condição de "esta venda veio de recuperação" — Pix não pago OU carrinho.
 *
 * Fonte ÚNICA da verdade: é usada pelo card da dashboard e pela taxa da
 * plataforma (lib/platform-fees.ts). Antes as duas contas nasciam de consultas
 * diferentes e discordavam num caso real: a venda do pedido 32a877db saiu
 * marcada como recuperada na cobrança e não aparecia no card, porque o card
 * datava pelo E-MAIL (26/09) e a taxa pela VENDA (27/09).
 *
 * Para efeito de "esta venda é recuperada?" não importa qual dos dois baldes
 * a creditou — é um pedido, uma resposta. A precedência do Pix sobre o
 * carrinho existe só onde é preciso separar os baldes sem contar duas vezes.
 */
export const PIX_RECUPERADO = `(
  o.paymentMethod = 'PIX'
  AND o.pixRecoveryEmailAt IS NOT NULL
  AND o.paidAt >= o.pixRecoveryEmailAt
  AND o.paidAt < o.pixRecoveryEmailAt + INTERVAL ${RECOVERY_ATTRIBUTION_HOURS} HOUR
)`;

export const CARRINHO_RECUPERADO = `EXISTS (
  SELECT 1 FROM abandoned_carts ac
   WHERE ac.storeId = o.storeId
     AND ac.email = o.customerEmail
     AND ac.recoveryEmailAt IS NOT NULL
     AND o.createdAt >= ac.recoveryEmailAt
     AND o.createdAt < ac.recoveryEmailAt + INTERVAL ${RECOVERY_ATTRIBUTION_HOURS} HOUR
)`;

export const VENDA_RECUPERADA = `(${PIX_RECUPERADO} OR ${CARRINHO_RECUPERADO})`;

/**
 * Vendas recuperadas do período, datadas pela VENDA.
 *
 * É o que o card da dashboard usa. Todos os outros cards de lá respondem "o
 * que aconteceu neste período" — um único datado pelo disparo do e-mail era
 * uma armadilha: vendia-se hoje, cobrava-se hoje, e o card de hoje mostrava
 * zero porque o e-mail saíra ontem.
 *
 * Conta PEDIDOS, não contatos: duas compras depois do mesmo e-mail são duas
 * vendas recuperadas, e o valor recuperado é a soma das duas.
 *
 * `rangeSql` filtra por `o.createdAt`, como o card de vendas.
 */
export function recoveredOrdersSql(rangeSql = "", groupExpr?: string): string {
  // A quebra por origem usa a precedência do PIX: ele é o último toque antes
  // do pagamento. Assim os dois baldes somam exatamente o total, sem que uma
  // venda que recebeu os dois e-mails apareça duas vezes.
  return `
    SELECT ${groupExpr ? `${groupExpr} AS b, ` : ""}COUNT(*) AS n,
           COALESCE(SUM(o.totalCents), 0) AS valor,
           COALESCE(SUM(${PIX_RECUPERADO}), 0) AS pixN,
           COALESCE(SUM(CASE WHEN ${PIX_RECUPERADO} THEN o.totalCents ELSE 0 END), 0) AS pixValor,
           COALESCE(SUM(NOT ${PIX_RECUPERADO}), 0) AS cartN,
           COALESCE(SUM(CASE WHEN ${PIX_RECUPERADO} THEN 0 ELSE o.totalCents END), 0) AS cartValor
      FROM orders o
     WHERE o.storeId = ?
       AND o.status IN ('PAID','SHIPPED')
       AND ${VENDA_RECUPERADA}${rangeSql}${groupExpr ? " GROUP BY b" : ""}`;
}

/**
 * Pix que voltou: cobrança gerada, não paga, que recebeu o e-mail de
 * recuperação e foi paga DEPOIS dele, dentro da janela de atribuição.
 *
 * Aqui não há subconsulta porque o pedido é o mesmo — o cliente pagou o Pix que
 * já existia. O relógio é o `paidAt`, não o `createdAt`: o pedido nasceu antes
 * do e-mail, quem veio depois foi o pagamento.
 *
 * `rangeSql` filtra pela data do e-mail, prefixada com `o.`.
 */
export function recoveredPixSql(rangeSql = ""): string {
  return `
    SELECT COUNT(*) AS n, COALESCE(SUM(o.totalCents), 0) AS valor
      FROM orders o
     WHERE o.storeId = ?
       AND o.paymentMethod = 'PIX'
       AND o.pixRecoveryEmailAt IS NOT NULL
       AND o.status IN ('PAID','SHIPPED')
       AND o.paidAt >= o.pixRecoveryEmailAt
       AND o.paidAt < o.pixRecoveryEmailAt + INTERVAL ${RECOVERY_ATTRIBUTION_HOURS} HOUR${rangeSql}`;
}

/**
 * Carrinhos que RECEBERAM o e-mail de recuperação, com o valor do pedido pago
 * em seguida (`pedidoCents` nulo = não comprou).
 *
 * Uma linha por CLIENTE, não por carrinho: quem recebeu dois e-mails e comprou
 * uma vez foi recuperado uma vez. Sem isto, o denominador e o numerador
 * contariam coisas diferentes e a taxa passaria de 100%.
 *
 * `rangeSql` filtra pela data do E-MAIL (prefixada com `ac.`) — o período do
 * painel responde "dos e-mails enviados nestes dias, quantos trouxeram venda".
 *
 * Os recuperados NÃO aparecem em `abandonedCartsSql`: lá, quem pagou depois de
 * abrir o carrinho já sai da lista. Os dois números são complementares.
 */
export function recoveredCartsSql(rangeSql = ""): string {
  return `
    WITH enviados AS (
      SELECT ac.id, ac.storeId, ac.name, ac.email, ac.phone,
             ac.totalCents, ac.recoveryEmailAt,
             ROW_NUMBER() OVER (
               PARTITION BY ${CONTATO}
               ORDER BY ac.recoveryEmailAt DESC
             ) AS rn
        FROM abandoned_carts ac
       WHERE ac.storeId = ? AND ac.recoveryEmailAt IS NOT NULL${rangeSql}
    )
    SELECT e.id, e.name, e.email, e.totalCents, e.recoveryEmailAt,
           -- Casa só pelo E-MAIL, de propósito. A varredura exige endereço para
           -- enviar, então nenhum carrinho com e-mail enviado está sem ele e o
           -- ramo do telefone nunca casava — e creditar por telefone uma
           -- mensagem endereçada a um e-mail seria atribuição errada.
           -- De quebra, o OR impedia o uso de índice: 399 ms viraram 27 ms.
           --
           -- E EXCLUI o que o balde do Pix já credita. Um mesmo pedido pode
           -- satisfazer os dois: a cliente recebe o e-mail de carrinho, volta e
           -- gera o Pix, recebe o e-mail de Pix não pago e paga. Sem esta
           -- condição ele entra duas vezes e o card de Recuperação mostra 4
           -- vendas onde houve 3 (aconteceu com o pedido a587f5b0).
           --
           -- A preferência é do PIX porque ele é o ÚLTIMO toque antes do
           -- pagamento — foi o lembrete do código que trouxe o dinheiro.
           (SELECT o.totalCents
              FROM orders o
             WHERE o.storeId = e.storeId
               AND o.customerEmail = e.email
               AND o.status IN ('PAID','SHIPPED')
               AND o.createdAt >= e.recoveryEmailAt
               AND o.createdAt < e.recoveryEmailAt + INTERVAL ${RECOVERY_ATTRIBUTION_HOURS} HOUR
               AND NOT (
                 o.paymentMethod = 'PIX'
                 AND o.pixRecoveryEmailAt IS NOT NULL
                 AND o.paidAt >= o.pixRecoveryEmailAt
                 AND o.paidAt < o.pixRecoveryEmailAt + INTERVAL ${RECOVERY_ATTRIBUTION_HOURS} HOUR
               )
             ORDER BY o.createdAt
             LIMIT 1) AS pedidoCents
      FROM enviados e
     WHERE e.rn = 1`;
}
