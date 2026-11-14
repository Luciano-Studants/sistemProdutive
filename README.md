# Rotina Noturna

Agenda diária (18h às 00h), tarefas, faculdade, estudos, projetos e hábitos.
Uma só base de código gera a **versão web** (PC) e o **APK** (Android). Os dois usam a mesma conta e o mesmo banco no Supabase, então os dados são idênticos nos dois.

```
src/            código do app (HTML, CSS e JavaScript)
supabase/       schema.sql, o banco de dados
.github/        workflows que geram o APK e publicam a versão web a cada commit
android-keystore/  chave fixa de assinatura do APK (permite atualizar por cima)
```

## Como funciona

- **Login:** e-mail e senha pelo Supabase. Entrando com o mesmo e-mail no celular e no PC, você vê os mesmos dados.
- **Sincronização:** cada alteração é salva no Supabase em menos de 1 segundo e aparece no outro aparelho em tempo real. Sem internet, o app guarda no aparelho e envia quando a conexão voltar.
- **Backup:** o banco guarda a última versão de cada dia durante 30 dias (tabela `app_state_backups`). A versão web ainda exporta e importa backup em arquivo (Hábitos > Ajustes).
- **Lembretes:** só no app do celular. Fixos às 18:00, 18:30, 21:00, 22:30 e 23:00, mais avisos de entregas da faculdade (véspera e dia, às 18:00). O horário pode atrasar alguns minutos por economia de bateria do Android.

## Configuração inicial (uma vez)

### 1. Banco de dados (Supabase)
1. Crie uma conta em supabase.com e um projeto novo.
2. Abra **SQL Editor > New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication > Providers > Email**, deixe o login por e-mail ligado. Para entrar logo após criar a conta, desligue "Confirm email". Se preferir manter a confirmação, o link do e-mail precisa apontar para o endereço da versão web (**Authentication > URL Configuration**).
4. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public**.

### 2. Segredos no GitHub
No repositório: **Settings > Secrets and variables > Actions > New repository secret**. Crie dois:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | Project URL do Supabase |
| `VITE_SUPABASE_ANON_KEY` | chave anon public |

### 3. Versão web
**Settings > Pages > Build and deployment > Source: GitHub Actions.** O endereço aparece ao fim do primeiro workflow "Publicar versão web". (Pages em repositório privado exige plano pago do GitHub. Repositório público funciona de graça.)

### 4. APK no celular
O workflow **Gerar APK** roda a cada commit no `main`. Abra a página **Releases** do repositório pelo celular, baixe `rotina-noturna.apk` e instale (o Android pede para permitir instalar de fonte externa). As atualizações seguintes instalam por cima, sem perder dados.

## Atualizar o app
Qualquer commit no `main` atualiza a versão web e gera um APK novo em cerca de 5 a 8 minutos.

## Rodar no PC para desenvolver
```
cp .env.example .env     # preencha com os dados do Supabase
npm install
npm run dev
```
Sem o `.env`, o app funciona só no aparelho, sem login.
