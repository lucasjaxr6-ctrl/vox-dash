// Seed de DEMONSTRAÇÃO: preenche um banco de TESTE com lojas, produtos, vendas,
// carrinhos e visitas fictícias, para as telas do painel e do admin aparecerem
// com números. Nunca rode em produção.
//   node --env-file=.env scripts/seed-demo.mjs
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const db = await mysql.createConnection({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "checkout",
});
const ex = (sql, p = []) => db.execute(sql, p);
const id = () => randomUUID();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const ago = (min) => new Date(Date.now() - min * 60000);

const hash = await bcrypt.hash("TroqueEstaSenha123", 12);
async function user(email, name, role) {
  const [r] = await db.query("SELECT id FROM users WHERE email=?", [email]);
  if (r[0]) return r[0].id;
  const uid = id();
  await ex("INSERT INTO users (id,email,name,passwordHash,role) VALUES (?,?,?,?,?)", [uid, email, name, hash, role]);
  return uid;
}

const nomes = ["Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Rocha", "Elisa Martins", "Fábio Costa", "Gabriela Alves",
  "Henrique Dias", "Isabela Nunes", "João Pereira", "Karina Lopes", "Lucas Ribeiro", "Mariana Freitas", "Natália Gomes",
  "Otávio Barros", "Paula Teixeira", "Rafael Moreira", "Sabrina Castro", "Tiago Cardoso", "Vanessa Pinto"];
const cidades = [["SP", "São Paulo"], ["RJ", "Rio de Janeiro"], ["MG", "Belo Horizonte"], ["PR", "Curitiba"], ["BA", "Salvador"],
  ["RS", "Porto Alegre"], ["PE", "Recife"], ["CE", "Fortaleza"], ["GO", "Goiânia"], ["SC", "Florianópolis"]];
const produtosBase = [
  ["Luminária Orbit LED", 18990], ["Kit Organizador Bambu", 12990], ["Fone Bluetooth Air Pro", 15990],
  ["Garrafa Térmica Inox 1L", 8990], ["Tapete Antiderrapante Yoga", 10990], ["Relógio Smart Fit 2", 24990],
  ["Mochila Urbana Impermeável", 17990], ["Escova Secadora 3 em 1", 21990],
];

async function loja(ownerId, nome, vendas) {
  const sid = id();
  await ex("INSERT INTO stores (id, ownerUserId, name) VALUES (?,?,?)", [sid, ownerId, nome]);
  await ex(`INSERT INTO store_settings (storeId, shopifyStoreDomain, paymentProvider, pagarmePixEnabled, pagarmeCardEnabled, emailRecoveryEnabled)
            VALUES (?,?,?,?,?,?)`, [sid, nome.toLowerCase().replace(/\W+/g, "") + ".myshopify.com", "pagarme", 1, 1, 1]);
  await ex("INSERT INTO store_onboarding (storeId) VALUES (?)", [sid]);

  const prods = [];
  for (const [n, p] of produtosBase) {
    const pid = id();
    prods.push({ id: pid, name: n, price: p, shop: String(rnd(7000000000, 7999999999)) });
    await ex("INSERT INTO products (id, storeId, shopifyId, name, priceCents, imageUrl) VALUES (?,?,?,?,?,?)",
      [pid, sid, prods.at(-1).shop, n, p, null]);
  }
  await ex("INSERT INTO coupons (id, storeId, code, type, value, timesRedeemed) VALUES (?,?,?,?,?,?)", [id(), sid, "BEMVINDO10", "PERCENT", 10, rnd(5, 40)]);
  await ex("INSERT INTO coupons (id, storeId, code, type, value, timesRedeemed) VALUES (?,?,?,?,?,?)", [id(), sid, "FRETE20", "FIXED", 2000, rnd(2, 15)]);
  await ex("INSERT INTO order_bumps (id, storeId, productId, title, description) VALUES (?,?,?,?,?)",
    [id(), sid, prods[3].id, "Leve também a Garrafa Térmica", "Com 30% de desconto só nesta compra."]);
  for (const [n, t] of [["Camila R.", "Chegou antes do prazo, muito bem embalado."], ["Pedro H.", "Qualidade excelente, recomendo."], ["Juliana M.", "Atendimento rápido e produto igual às fotos."]])
    await ex("INSERT INTO reviews (id, storeId, name, stars, text) VALUES (?,?,?,?,?)", [id(), sid, n, 5, t]);

  for (let i = 0; i < vendas; i++) {
    const min = rnd(5, 60 * 24 * 30);
    const created = ago(min);
    const nome = pick(nomes);
    const email = nome.toLowerCase().normalize("NFD").replace(/[^\w ]/g, "").replace(" ", ".") + rnd(1, 99) + "@exemplo.com";
    const metodo = Math.random() < 0.62 ? "PIX" : "CREDIT_CARD";
    const r = Math.random();
    const status = r < 0.58 ? "PAID" : r < 0.72 ? "SHIPPED" : r < 0.92 ? "PENDING" : "CANCELLED";
    const itens = [pick(prods)];
    if (Math.random() < 0.25) itens.push(pick(prods));
    const total = itens.reduce((s, p) => s + p.price, 0);
    const oid = id();
    const [uf, cid] = pick(cidades);
    const pago = status === "PAID" || status === "SHIPPED";
    await ex(`INSERT INTO orders (id, storeId, status, totalCents, customerName, customerEmail, customerDocument, customerPhone,
              customerAddress, paymentMethod, paymentGateway, providerTxnId, device, createdAt, updatedAt, paidAt, trackingCode,
              cardBrand, cardLast4, cardAttempts)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      oid, sid, status, total, nome, email, "00000000000", "1199" + rnd(1000000, 9999999),
      JSON.stringify({ cep: "01001000", street: "Rua Exemplo", number: String(rnd(10, 999)), neighborhood: "Centro", city: cid, state: uf }),
      metodo, "pagarme", "demo_" + oid.slice(0, 12), Math.random() < 0.82 ? "mobile" : "desktop",
      created, created, pago ? new Date(created.getTime() + rnd(1, 20) * 60000) : null,
      status === "SHIPPED" ? "BR" + rnd(100000000, 999999999) + "BR" : null,
      metodo === "CREDIT_CARD" ? pick(["visa", "mastercard", "elo"]) : null,
      metodo === "CREDIT_CARD" ? String(rnd(1000, 9999)) : null, 1,
    ]);
    for (const p of itens)
      await ex("INSERT INTO order_items (id, orderId, productId, quantity, unitPriceCents) VALUES (?,?,?,?,?)", [id(), oid, p.id, 1, p.price]);
    if (pago)
      await ex("INSERT INTO platform_fees (id, storeId, orderId, baseCents, ratePct, feeCents, status, createdAt) VALUES (?,?,?,?,?,?,?,?)",
        [id(), sid, oid, total, 2.5, Math.round(total * 0.025), min > 60 * 48 ? "PAID" : "PENDING", created]);
  }

  // Carrinhos abandonados, funil, visitas e sessões ao vivo
  for (let i = 0; i < Math.round(vendas * 0.6); i++) {
    const nome = pick(nomes);
    const p = pick(prods);
    const created = ago(rnd(10, 60 * 24 * 30));
    await ex(`INSERT INTO abandoned_carts (id, storeId, sessionId, name, email, phone, itemsJson, totalCents, step, status, createdAt, updatedAt)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id(), sid, id(), nome, nome.split(" ")[0].toLowerCase() + rnd(1, 99) + "@exemplo.com",
      "1199" + rnd(1000000, 9999999), JSON.stringify([{ productId: p.id, name: p.name, quantity: 1, priceCents: p.price }]),
      p.price, rnd(1, 3), Math.random() < 0.3 ? "CONVERTED" : "OPEN", created, created]);
  }
  for (let i = 0; i < vendas * 4; i++) {
    const created = ago(rnd(1, 60 * 24 * 30));
    const sess = id();
    await ex("INSERT INTO checkout_funnel (storeId, sessionId, step, createdAt, updatedAt) VALUES (?,?,?,?,?)",
      [sid, sess, pick([0, 0, 1, 1, 2, 2, 3, 4]), created, created]);
    await ex("INSERT INTO product_views (storeId, sessionId, shopifyProductId, views, createdAt, updatedAt) VALUES (?,?,?,?,?,?)",
      [sid, sess, pick(prods).shop, rnd(1, 4), created, created]);
  }
  for (let i = 0; i < 14; i++) {
    const [uf, cid] = pick(cidades);
    await ex("INSERT INTO live_sessions (id, storeId, scope, step, state, city, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)",
      [id(), sid, pick(["store", "store", "checkout"]), rnd(0, 3), uf, cid, ago(rnd(1, 4)), ago(0)]);
  }
  return sid;
}

const lojista = await user("lojista@example.com", "Lojista Demo", "MERCHANT");
await ex(`INSERT IGNORE INTO merchant_profiles (userId, documentType, document, cep, street, number, neighborhood, city, state)
          VALUES (?,?,?,?,?,?,?,?,?)`, [lojista, "CNPJ", "11222333000181", "01001000", "Rua Exemplo", "100", "Centro", "São Paulo", "SP"]);
await ex("INSERT IGNORE INTO account_plans (userId, plan, expiresAt) VALUES (?,?,?)", [lojista, "pro", ago(-60 * 24 * 20)]);
await loja(lojista, "Casa Aurora", 180);
await loja(lojista, "Urban Gear", 70);

for (const [email, nome, nomeLoja, n] of [["marina@exemplo.com", "Marina Prado", "Bella Rosa", 90], ["rodrigo@exemplo.com", "Rodrigo Sales", "Tech Hub", 40]]) {
  const u = await user(email, nome, "MERCHANT");
  await ex(`INSERT IGNORE INTO merchant_profiles (userId, documentType, document, cep, street, number, neighborhood, city, state)
            VALUES (?,?,?,?,?,?,?,?,?)`, [u, "CPF", "00000000000", "20040002", "Av. Exemplo", "50", "Centro", "Rio de Janeiro", "RJ"]);
  await loja(u, nomeLoja, n);
}
await ex("INSERT IGNORE INTO platform_settings (id) VALUES (1)");
// Celular do lojista: sem ele o painel abre no formulário "complete seu cadastro".
await ex("UPDATE users SET phone = CONCAT('1199', FLOOR(1000000 + RAND() * 8999999)) WHERE role = 'MERCHANT' AND phone IS NULL");

console.log("Demo OK: 4 lojas com vendas, carrinhos e visitas fictícias.");
await db.end();
