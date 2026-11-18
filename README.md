# Checkout Seguro (Next.js + MySQL)

Núcleo de e-commerce com checkout multi-etapas, autenticação, painel admin e
arquitetura de segurança onde **a identidade do usuário é sempre derivada do
token de sessão, nunca de dados enviados pelo frontend**.

Acesso ao banco em **MySQL puro via `mysql2`** (sem ORM), com SQL parametrizado.

> ⚠️ Núcleo sólido e funcional, não uma plataforma 100% finalizada. Checkout,
> autenticação, autorização (anti-IDOR), validação e headers de segurança estão
> prontos. A integração de pagamento real é o próximo passo. Leia `SECURITY.md`.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript
- **MySQL** acessado direto com **`mysql2`** (prepared statements → seguro contra SQL injection)
- **bcryptjs** para hash de senha
- **Zod** para validação de todo input no servidor
- Sessões com **token opaco** + **cookie httpOnly/Secure/SameSite=Strict**
- Credenciais de integração (Shopify) **criptografadas (AES-256-GCM)** no banco

## Rodando no XAMPP (local)

```bash
# 1. Dependências
npm install

# 2. Ambiente
cp .env.example .env
#    Gere os segredos e cole no .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # ENCRYPTION_KEY
#    No XAMPP, DB_USER=root e DB_PASSWORD= (vazio) por padrão.

# 3. Banco: inicie MySQL no painel do XAMPP, crie um banco vazio e as tabelas.
#    schema.sql é só estrutura (sem dados) e é gerado por scripts/gerar-schema.mjs.
#    Opção A (phpMyAdmin): crie o banco, abra-o, aba "Importar" -> selecione schema.sql
#    Opção B (terminal):
mysql -u root -e "CREATE DATABASE checkout CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root checkout < schema.sql

# 4. Seed: cria o usuário admin (admin@example.com)
npm run seed

# 5. Subir
npm run dev
```

Acessos:
- `/checkout` — checkout (cliente final)
- `/login` — entrar / cadastrar
- `/painel` — **painel do lojista** (seus clientes). Login do seed: `lojista@example.com`
- `/admin` — **painel do administrador da plataforma** ("o seu"). Login: `admin@example.com`

Senha padrão do seed: `TroqueEstaSenha123` — **troque depois**.

> Para produção (ex.: MySQL na Aiven/Railway): mude apenas as variáveis `DB_*`
> no `.env`. O `mysql2` se conecta da mesma forma; é só MySQL.

## Estrutura

```
schema.sql                 # DDL do MySQL (importe no phpMyAdmin)
scripts/seed.mjs           # cria o admin
src/
├─ middleware.ts           # Validação de Origin (defesa CSRF) p/ mutações
├─ lib/
│  ├─ db.ts                # pool mysql2 + helpers query/execute/withTransaction
│  ├─ password.ts          # hash/verify + mitigação de timing
│  ├─ session.ts           # ⭐ token opaco, hash no banco, cookie httpOnly
│  ├─ auth.ts              # requireUser() / requireAdmin()
│  ├─ validation.ts        # Zod + validação real de CPF
│  ├─ crypto.ts            # AES-256-GCM p/ segredos de integração
│  ├─ settings.ts          # configurações da loja (Shopify) no banco
│  ├─ rate-limit.ts        # anti-força bruta (trocar por Redis em prod)
│  ├─ http.ts              # respostas seguras (sem vazar stack)
│  └─ shopify.ts           # cliente server-side + verificação HMAC de webhook
├─ app/
│  ├─ checkout/page.tsx    # checkout (layout)
│  ├─ login/page.tsx       # login/cadastro
│  ├─ admin/page.tsx       # painel (RBAC)
│  └─ api/
│     ├─ auth/{register,login,logout,me}/route.ts
│     ├─ profile/route.ts          # ⭐ impossível editar perfil de outro usuário
│     ├─ orders/route.ts           # lista escopada por dono
│     ├─ orders/[id]/route.ts      # ⭐ anti-IDOR
│     ├─ checkout/route.ts         # ⭐ preço recalculado no servidor
│     ├─ admin/{orders,products,products/[id],settings}/route.ts  # RBAC
│     └─ webhooks/shopify/route.ts # HMAC obrigatório
└─ components/
```

## Princípios aplicados (resumo)

1. **Identidade só do servidor.** `getCurrentUser()` lê o cookie httpOnly, valida
   a sessão no banco e retorna o usuário. Nenhuma rota aceita `user_id`/`owner_id`
   do corpo da requisição.
2. **Toda query é escopada pelo dono.** `WHERE id = ? AND userId = ?` → IDOR bloqueado.
3. **Nunca confie no frontend.** Preço do pedido vem do banco e é recalculado no servidor.
4. **SQL parametrizado.** `pool.execute` com placeholders `?` (prepared statements).
   Fragmentos dinâmicos de `SET`/`IN` vêm de whitelist fixa; valores sempre via `?`.

Detalhes e checklist de testes de vulnerabilidade em `SECURITY.md`.
