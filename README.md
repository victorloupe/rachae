# Rachaê (RachaFixo)

App para república e casa compartilhada: cadastra as contas fixas mensais, calcula a divisão entre os moradores e gera cobrança Pix automaticamente todo mês.

Stack: HTML/CSS/JS puro (sem framework, sem build) + **Supabase** (PostgreSQL + Authentication + Row Level Security) + hospedagem estática na **Vercel**.

---

## 1. Estrutura do projeto

```
rachafixo/
├── public/                 ← site estático (raiz do deploy)
│   ├── index.html          ← login
│   ├── cadastro.html       ← criar conta
│   ├── casa.html           ← listar/criar/entrar em casa
│   ├── contas.html         ← gerenciar contas fixas
│   ├── convidar.html       ← gerar convite e ver moradores
│   ├── dashboard.html      ← cobranças do mês (Pix)
│   ├── css/style.css
│   └── js/
│       ├── config.js         ← chaves do Supabase (URL + Anon Key)
│       ├── supabaseClient.js ← cliente unificado (Auth + Postgres)
│       ├── mockClient.js     ← banco em memória para fallback/testes offline
│       ├── auth.js
│       ├── casa.js
│       ├── contas.js
│       ├── convidar.js
│       └── dashboard.js
├── schema.sql              ← Schema do PostgreSQL e regras de RLS do Supabase
├── server.js               ← Servidor local de desenvolvimento (Node.js nativo)
├── vercel.json             ← Configuração de deploy na Vercel
└── package.json
```

---

## 2. Passo a passo — Configurando o Supabase

### 1. Criar o Projeto no Supabase
1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita.
2. Crie um novo projeto e anote sua **Project URL** e a chave **anon public** (em *Project Settings > API*).
3. Essas credenciais já estão configuradas no arquivo:
   `public/js/config.js`

### 2. Criar as Tabelas no Banco (SQL Editor)
1. No painel do seu projeto no Supabase, clique no menu lateral **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo [`schema.sql`](schema.sql) deste projeto, copie todo o seu conteúdo e cole no SQL Editor do Supabase.
4. Clique no botão **Run** (ou pressione `Ctrl + Enter`).
5. Todas as tabelas (`profiles`, `casas`, `membros_casa`, `convites`, `contas_fixas`, `ciclos_cobranca`, `cobrancas_individuais`) e suas regras de segurança (RLS) serão criadas com sucesso.

### 3. Ajuste de Confirmação de E-mail (Opcional, recomendado para desenvolvimento)
1. No menu lateral do Supabase, vá em **Authentication > Providers > Email**.
2. Desmarque a opção **Confirm email** se você deseja que o usuário já entre logado logo após o cadastro, sem precisar abrir a caixa de entrada para validar o e-mail.
3. Clique em **Save**.

---

## 3. Testando Localmente

O app possui servidor nativo Node.js:

```bash
npm start
# ou
node server.js
```

Abra `http://localhost:3000` no seu navegador.

---

## 4. Deploy em Produção (Vercel)

1. Suba o projeto para um repositório no GitHub.
2. No [vercel.com](https://vercel.com), importe o repositório.
3. Defina a pasta raiz como `public` e framework como `Other`.
4. Clique em **Deploy**.

---

## 5. Funcionalidades do App

- **Autenticação**: Cadastro e login de moradores com Supabase Auth.
- **Isolamento de Dados**: Políticas de Row Level Security (RLS) garantem que apenas membros vejam suas contas e casas.
- **Gestão de Casas**: Criação de novas repúblicas ou entrada com código de convite / link direto.
- **Contas Fixas**: Cadastro de aluguel, luz, internet, etc., com valor fixo ou variável e dia de vencimento.
- **Divisão Inteligente**: Divisão igualitária com tratamento exato de centavos.
- **Cobranças e Pix**: Exibição dos valores por morador, suporte a QR Code / Pix copia e cola e envio facilitado via WhatsApp.
- **Painel Financeiro**: Resumo mensal com status de pagamentos e acompanhamento geral.
