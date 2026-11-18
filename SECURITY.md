# SECURITY.md — Modelo de ameaças e checklist de testes

Este documento mapeia cada classe de vulnerabilidade, **onde ela é tratada no
código** e **como você testa** que a proteção funciona.

---

## 1. Quebra de Autorização / IDOR (sua principal preocupação)

**Ameaça:** usuário A edita/lê dados do usuário B trocando um ID na requisição.

**Onde é tratado:**
- `lib/session.ts` → `getCurrentUser()` é a única fonte de identidade.
- `app/api/profile/route.ts` → `PUT` usa `where: { id: user.id }` (da sessão).
  O schema Zod nem aceita `userId`; campos extras são descartados.
- `app/api/orders/[id]/route.ts` → `findFirst({ where: { id, userId } })`.

**Como testar (faça você mesmo):**

```bash
# Logue como usuário A e tente atualizar o perfil mandando userId de outra pessoa:
curl -X PUT http://localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -b "bs_session=<COOKIE_DE_A>" \
  -d '{"userId":"<ID_DE_B>","name":"Invadido"}'
# Esperado: só o nome de A muda. O userId é IGNORADO. B fica intacto.

# Tente ler um pedido que não é seu:
curl http://localhost:3000/api/orders/<ID_DE_PEDIDO_DE_B> -b "bs_session=<COOKIE_DE_A>"
# Esperado: 404 (nem revelamos que o pedido existe).
```

✅ **Critério:** nenhuma requisição consegue afetar/ler dados de outro usuário,
independentemente do que é enviado no corpo/URL.

---

## 2. SQL Injection

**Ameaça:** input malicioso vira comando SQL.

**Onde é tratado:** usamos **`mysql2` com prepared statements** (`pool.execute`
com placeholders `?`). Os valores nunca são concatenados na string SQL. Os
poucos fragmentos dinâmicos (colunas em `SET`/`IN`) vêm de uma whitelist fixa no
código, não de input do usuário.

**Regra:** todo valor de usuário vai por `?`. Nunca monte SQL com interpolação
de strings vindas do cliente.

**Como testar:** envie `' OR 1=1 --`, `"; DROP TABLE users; --` em e-mail/nome/CPF.
✅ **Critério:** tratado como string literal; nenhum efeito no banco.

---

## 3. Cross-Site Scripting (XSS)

**Ameaça:** script injetado executa no browser da vítima.

**Onde é tratado:**
- React **escapa** todo conteúdo por padrão (não usamos `dangerouslySetInnerHTML`).
- Cookie de sessão é **httpOnly** → JS não consegue ler o token mesmo com XSS.
- **CSP** restritiva em `next.config.js` (`script-src 'self'`).

**Como testar:** cadastre nome `<script>alert(1)</script>` e veja se renderiza
como texto (correto) ou executa (falha).
✅ **Critério:** renderiza como texto; nenhum alert.

---

## 4. CSRF (Cross-Site Request Forgery)

**Ameaça:** site malicioso dispara ações autenticadas em nome da vítima.

**Onde é tratado (defesa em camadas):**
- Cookie **SameSite=Strict** → não é enviado em requisições cross-site.
- `middleware.ts` valida o header **Origin** em POST/PUT/PATCH/DELETE.

**Como testar:** faça um POST a `/api/checkout` com `Origin` de outro domínio.
✅ **Critério:** 403 "Origem não permitida".

> Para apps com formulários sensíveis, considere também token CSRF
> (double-submit) como reforço.

---

## 5. Senhas e Autenticação

**Onde é tratado:**
- `bcryptjs` com custo 12; senha em texto puro **nunca** é armazenada.
- Política de senha forte (12+ chars, maiúscula/minúscula/número) em `validation.ts`.
- **Anti-enumeração:** login devolve a mesma mensagem para "e-mail inexistente"
  e "senha errada", e roda um hash fantasma (`DUMMY_HASH`) para igualar o tempo.

**Como testar:** tente logar com e-mail inexistente vs. senha errada; compare
mensagem e tempo de resposta.
✅ **Critério:** indistinguíveis.

---

## 6. Sessão e Tokens

**Onde é tratado:**
- Token **opaco** aleatório (32 bytes) no cookie; no banco guardamos só o
  **SHA-256** dele. Vazou o banco? Os tokens não são utilizáveis.
- `Secure` (só HTTPS em prod) + `httpOnly` + `SameSite=Strict`.
- Expiração checada a cada request; `destroyAllSessions()` para invalidar tudo
  (use após troca de senha).

**Como testar:** copie o cookie e altere 1 caractere → deve cair para não
autenticado.
✅ **Critério:** sessão inválida = 401.

---

## 7. Força bruta / Credential stuffing

**Onde é tratado:** `rate-limit.ts` limita tentativas por IP e por e-mail no
login, e por IP no cadastro.

> ⚠️ É **em memória** (1 instância). Em produção/serverless, troque por Redis
> (ex.: `@upstash/ratelimit`) para funcionar em múltiplas instâncias.

**Como testar:** dispare 30 logins seguidos → deve retornar 429.

---

## 8. Manipulação de preço/valores (e-commerce)

**Ameaça:** comprar item caro por R$0,01 mandando `price` no frontend.

**Onde é tratado:** `app/api/checkout/route.ts` ignora qualquer preço do cliente;
busca `priceCents` no banco e **recalcula o total no servidor**.

**Como testar:** envie `{ items: [{ productId, quantity, price: 1 }] }`.
✅ **Critério:** o `price` é ignorado; total = preço real do banco.

---

## 9. Webhooks (Shopify)

**Ameaça:** atacante forja "pedido pago".

**Onde é tratado:** `lib/shopify.ts` → `verifyShopifyWebhook()` valida o HMAC
(SHA-256, base64) com comparação **timing-safe**, lendo o corpo CRU antes do parse.

**Como testar:** envie um POST ao webhook sem/`com` HMAC errado.
✅ **Critério:** 401 sem assinatura válida.

---

## 10. Controle de acesso administrativo (RBAC)

**Onde é tratado:** `auth.ts` → `requireAdmin()` valida sessão **e** o papel no
banco. Esconder o botão no frontend não basta; a checagem é server-side.

**Como testar:** logue como usuário comum e chame `/api/admin/orders`.
✅ **Critério:** 403.

---

## 11. Headers de segurança

Em `next.config.js`: HSTS, CSP, X-Frame-Options: DENY (anti-clickjacking),
X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy,
COOP. `poweredByHeader: false` remove o `X-Powered-By`.

**Como testar:**
```bash
curl -I http://localhost:3000/checkout
# Confira a presença dos headers acima.
```
Use também https://securityheaders.com em produção.

---

## 12. Vazamento de informação em erros

`http.ts` → `handleError()` devolve mensagem genérica (`"Erro interno"`) e loga o
detalhe só no servidor. Nada de stack trace para o cliente.

---

## Checklist de Pull Request (rode antes de cada deploy)

- [ ] Toda rota que mexe em dado de usuário usa `requireUser()` e escopa a query
      por `user.id` (nunca por ID vindo do frontend).
- [ ] Nenhum endpoint aceita `userId`/`ownerId`/`role`/`price` do corpo.
- [ ] Todo input passa por um schema Zod com limites de tamanho.
- [ ] Toda query usa placeholders `?` (nada de input concatenado no SQL).
- [ ] Nenhum `dangerouslySetInnerHTML` com dado do usuário.
- [ ] Segredos só em `.env` (nunca commitados; `.env` está no `.gitignore`).
- [ ] Rate limit nas rotas sensíveis.
- [ ] Em prod: HTTPS, `Secure` cookies, Redis no rate limit, MySQL com usuário de
      privilégio mínimo e SSL.

---

## Ferramentas recomendadas para auditoria contínua

- `npm audit` / **Snyk** / **Dependabot** — vulnerabilidades em dependências.
- **OWASP ZAP** — scanner DAST (rode contra o ambiente de staging).
- **Semgrep** (regras OWASP) — análise estática (SAST).
- Revisão manual com base no **OWASP Top 10** e **OWASP ASVS**.

---

## 13. Segredos de integração (Shopify) — armazenamento

**Mudança importante:** as credenciais da Shopify (Admin API token e webhook
secret) **não ficam no `.env`**. Cada loja as configura pelo painel admin; elas
são criptografadas com **AES-256-GCM** (`lib/crypto.ts`) usando a `ENCRYPTION_KEY`
e guardadas no banco (`StoreSettings`). O painel nunca exibe os segredos de volta
— só indica se estão configurados. Se o banco vazar sem a `ENCRYPTION_KEY`, os
tokens permanecem cifrados e inúteis.

**Como testar:** salve um token no painel e inspecione a tabela `store_settings`
no banco → o valor está cifrado (formato `iv.tag.ciphertext` em base64), não em
texto puro. O `GET /api/admin/settings` retorna apenas
`adminTokenConfigured: true/false`, nunca o token.
