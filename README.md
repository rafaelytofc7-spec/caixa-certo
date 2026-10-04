# Caixa Certo (nome provisório)

Caixa (PDV) **online e multi-loja** para hortifruti, sacolão e mercadinho, nascido do Folha Caixa:
venda por peso com teclado de kg, atalhos com foto, leitor de código de barras (câmera, leitor USB e etiqueta de balança),
produtos, estoque e validade, preço do dia, fornecedores e compras, promoções com texto para WhatsApp, encomendas, fiado,
livro caixa com calendário, resumo do dia, histórico de vendas, comprovante em PDF/WhatsApp e app instalável (PWA).

- **App das lojas:** https://rafaelytofc7-spec.github.io/caixa-certo/
- **Painel do administrador:** https://rafaelytofc7-spec.github.io/caixa-certo/admin.html (não tem link no app das lojas)

> ⚠️ Ainda é preciso criar o projeto Supabase do Caixa Certo e publicar. Veja **Colocar no ar** abaixo.

---

## Como uma loja começa a usar

1. Abra o app e toque em **🏪 Criar conta da loja**.
2. Preencha: **nome da loja**, **CPF ou CNPJ** (com máscara; os dígitos verificadores são conferidos, e o CNPJ alfanumérico de 2026 também é aceito), **nome do responsável**, **usuário**, **senha** (mínimo 8), **WhatsApp** e, se quiser, um **PIN** de 4 números.
3. A loja nasce em **teste grátis por 7 dias** e quem se cadastrou vira o **dono**.
4. O catálogo começa vazio. Em **Configurações › Loja e cupom › Carregar produtos de exemplo**, entram uns 40 itens comuns **sem preço**. Depois é só ajustar os preços.
5. Os dados do cupom (nome, razão social, CNPJ, endereço, telefone, rodapé) ficam em **Configurações › Loja e cupom**. Cada loja edita os seus.

**Entrar:** CPF/CNPJ da loja + usuário + senha. O aparelho guarda o nome da loja e mostra-o debaixo do CPF/CNPJ (o nome da loja **não** aparece para quem digita um documento desconhecido, para ninguém descobrir quais lojas existem).

**Funcionários:** o dono cria em **Configurações › Usuários** (operador, gerente ou admin). Funcionários entram com o **mesmo CPF/CNPJ da loja** + o próprio usuário e senha. Um dono só cria e altera pessoas da própria loja.

**Situação da assinatura:** em **Configurações › Minha conta › Plano e assinatura**. Faltando poucos dias para vencer (padrão: 5), aparece uma faixa no topo. Vencido ou bloqueado, a loja vê a tela cheia **“Acesso bloqueado”**, com **Falar com o suporte** (WhatsApp), **Já paguei — verificar** e **Sair**. Os dados ficam guardados.

---

## Painel do administrador (Rafael)

Endereço: `…/caixa-certo/admin.html`. O login é próprio (usuário + senha) e **não** serve no app das lojas. Login de loja também **não** entra no painel.

| O que fazer | Onde |
|---|---|
| Ver todas as lojas (nome, CPF/CNPJ, situação, vencimento, dias restantes, último acesso, vendas do mês/total, total do mês) | tela inicial; busca por nome/documento/responsável e filtro “Precisam de atenção” |
| **Registrar pagamento** (PIX manual) | botão 💰 **Pagamento**: valor, data, forma, observação, e **+30 dias** ou **data escolhida**. A loja volta a ficar **Ativa** na hora |
| **Bloquear** | 🔒 **Bloquear** + motivo (a loja vê o motivo). O bloqueio vale na hora, no banco |
| **Desbloquear** | 🔓 **Desbloquear** + motivo (se já venceu, informe um novo vencimento, ou registre um pagamento) |
| Editar plano, valor mensal, vencimento, telefone, observação interna | ✏️ |
| Criar loja manualmente | **+ Nova loja** (gera uma senha temporária que aparece uma vez só) |
| Redefinir a senha do dono de uma loja | clique no nome da loja › 🔑 **Redefinir senha** (fica no histórico) |
| Histórico de pagamentos e eventos da loja | clique no nome da loja |
| Carência, dias de teste e dias de aviso | ⚙️ **Regras** (padrão: carência 3 dias, só para lojas **ativas**; teste 7 dias; aviso 5 dias) |
| Trocar a própria senha | 🔑 **Minha senha** (mínimo 12 caracteres) |

**Regra de acesso** (função `loja_liberada()` no banco): a loja está liberada se **não** estiver bloqueada **e** a data de hoje em São Paulo for ≤ vencimento (+ carência, quando ativa).
Pagamento registrado: novo vencimento = maior entre (vencimento atual, hoje) + 30 dias, ou a data escolhida.

Primeiro acesso do Rafael: usuário `rafael`. A senha temporária fica **só** no arquivo `.secrets/admin.txt` da máquina onde rodou `npm run admin:create` (não está no repositório). Troque a senha no painel e apague o arquivo.

---

## Segurança e isolamento entre lojas

- Todas as tabelas de negócio têm `loja_id` (obrigatório, com índice). Unicidades valem **por loja** (número da venda, código do produto, EAN, atalho…) e as chaves estrangeiras são compostas `(loja_id, id)`, então nenhuma linha aponta para dado de outra loja.
- **RLS em todas as tabelas:** só leitura direta, e só de linhas com `loja_id = current_loja_id()` com a loja liberada. Toda escrita passa por funções do banco que conferem login, papel e loja. O papel `anon` não lê nem grava nada.
- As funções das lojas rodam como um papel sem privilégios (`app_definer`, **sem** bypass de RLS). Mesmo se uma função tivesse um erro, o RLS ainda impediria tocar em outra loja.
- `super_admins`, `pagamentos`, `lojas`, `loja_eventos` e `plataforma_config` não podem ser lidas pelas lojas. As funções `admin_*` dão erro para quem não é super admin. Um super admin não pode ser membro de loja, e um membro de loja não pode virar super admin (trigger no banco).
- Logins são e-mails internos que ninguém recebe: `<documento>.<usuario>@lojas.caixacerto.invalid` (lojas) e `<usuario>@admin.caixacerto.invalid` (painel). O cadastro público do Supabase Auth fica **desligado**: contas só nascem pela Edge Function `accounts`, que valida tudo.
- No navegador só vai a chave **pública** (anon). A service_role fica só na Edge Function (variável do Supabase).
- O app e o painel guardam sessões separadas (`cc.sb.auth` e `cc.admin.auth`). Cache e fila offline são separados por loja: uma venda feita sem internet nunca é enviada para outra loja que entre no mesmo aparelho.

### LGPD
Guardamos só o necessário para o caixa e a cobrança: nome da loja, CPF/CNPJ, responsável, WhatsApp e os dados que a própria loja cadastra.
O **CPF/CNPJ da loja é visível apenas para a própria loja e para o super admin**. O cadastro pede o aceite desse uso. O CPF nunca é preenchido no cupom; se a loja se cadastrou com CNPJ, ele já vem no cupom (editável em Configurações).

---

## Trocar o nome do app

Tudo vem de **`shared/src/brand.ts`**: `NAME` (nome), `tagline`, `description`, `url`, `supportWhatsapp`, `supportMessage` e `trialDays`.
Título da página, manifest do app instalado, telas, cupom, PDF e painel leem dali. Depois de trocar, rode `npm run build:pages` e faça o push.
Não mude `STORE_EMAIL_DOMAIN` / `ADMIN_EMAIL_DOMAIN` depois de haver lojas cadastradas, porque os logins existentes usam esses domínios.
Se o endereço mudar (outro repositório ou domínio), ajuste também `base` em `web/vite.config.ts` e `site_url` em `supabase/auth-config.mjs`.

## O que ainda é provisório

- **WhatsApp do suporte:** `supportWhatsapp: '5500000000000'` em `shared/src/brand.ts` (⚠️ PLACEHOLDER; enquanto isso o botão mostra “número a definir”).
- **Preço:** cada loja começa com `valor_mensal_cents = 0` e plano “mensal”. Defina no painel (✏️) ou ao registrar pagamento.
- **Cobrança automática:** ainda não há. O pagamento é marcado à mão (PIX). A estrutura já está pronta para um gateway (Mercado Pago/PIX): `pagamentos.gateway` + `gateway_ref` único (webhook idempotente) e `lojas.gateway_cliente_id`. Um webhook futuro (Edge Function) só precisa inserir em `pagamentos` e estender o vencimento, como faz `admin_registrar_pagamento`.

---

## Colocar no ar (uma vez)

Pré-requisitos: Node 22, `gh` logado, Supabase CLI (`npx supabase`), um **token pessoal** do Supabase em `SUPABASE_ACCESS_TOKEN` (Dashboard › Account › Access Tokens).

1. **Criar o projeto** no Supabase: nome `caixa-certo`, região **São Paulo (sa-east-1)**, senha do banco forte (guarde-a em `.secrets/db.txt`, que está fora do git). Anote o **ref** do projeto.
2. **Banco:** `SUPABASE_PROJECT_REF=<ref> npm run db:apply` (aplica `supabase/sql/*.sql` em ordem; recusa o projeto do Folha Caixa).
3. **Auth:** `SUPABASE_PROJECT_REF=<ref> npm run db:auth` (cadastro público desligado, sem anônimo, sem confirmação de e-mail, senha mínima 8).
4. **Edge Function:** `npx supabase functions deploy accounts --no-verify-jwt --project-ref <ref>` (a função confere o login sozinha).
5. **Super admin:** `SUPABASE_PROJECT_REF=<ref> npm run admin:create -- rafael` → a senha vai para `.secrets/admin.txt` (chmod 600).
6. **Front:** copie `web/.env.supabase.example` para `web/.env.supabase` com a URL e a chave **anon** do projeto.
7. **Testes no projeto novo:** `SUPABASE_PROJECT_REF=<ref> npm run test:isolation` (cria lojas A e B e um super admin de teste, confere tudo pela API REST e apaga o que criou).
8. **Publicar:** `gh repo create rafaelytofc7-spec/caixa-certo --public --source . --push` e, em Settings › Pages, escolha **GitHub Actions**. O workflow `.github/workflows/pages.yml` roda os testes, compila o app + `admin.html` e publica.

## Desenvolvimento

```bash
npm install
npm test               # testes de unidade (servidor local / regras compartilhadas)
npm run build:pages    # build do modo online (app + admin.html) em web/dist
npm run dev:online -w web   # app em modo online apontando para o Supabase de web/.env.supabase
```

Estrutura: `web/` (React/Vite: app das lojas e `src/admin/` do painel), `shared/` (regras, cupom, `brand.ts`),
`supabase/sql/` (esquema, RLS e funções), `supabase/functions/accounts/` (cadastro e contas), `scripts/test-isolation.mjs` (teste de isolamento),
`server/` (modo local/offline com SQLite, herdado; usado nos testes de unidade).

Créditos das fotos de produtos: `docs/creditos-imagens.md` (todas com licença livre: CC0, domínio público ou CC BY).
