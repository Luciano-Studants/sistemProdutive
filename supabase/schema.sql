-- Rotina Noturna: banco de dados no Supabase.
-- Cole este arquivo inteiro em Supabase > SQL Editor > New query e clique em Run.
-- Pode rodar de novo sem problema: ele não apaga nada.

-- 1) Estado do app: uma linha por pessoa, com todos os dados em JSON.
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Cada pessoa só enxerga e altera a própria linha (segurança por usuário).
alter table public.app_state enable row level security;

drop policy if exists "ler o proprio estado" on public.app_state;
create policy "ler o proprio estado" on public.app_state
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "criar o proprio estado" on public.app_state;
create policy "criar o proprio estado" on public.app_state
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "atualizar o proprio estado" on public.app_state;
create policy "atualizar o proprio estado" on public.app_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "apagar o proprio estado" on public.app_state;
create policy "apagar o proprio estado" on public.app_state
  for delete to authenticated using (auth.uid() = user_id);

-- 3) Backup diário automático: guarda a última versão de cada dia por 30 dias.
create table if not exists public.app_state_backups (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  state   jsonb not null,
  primary key (user_id, day)
);

alter table public.app_state_backups enable row level security;

drop policy if exists "ler os proprios backups" on public.app_state_backups;
create policy "ler os proprios backups" on public.app_state_backups
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.snapshot_app_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_state_backups (user_id, day, state)
  values (new.user_id, current_date, new.state)
  on conflict (user_id, day) do update set state = excluded.state;

  delete from public.app_state_backups
  where user_id = new.user_id and day < current_date - 30;

  return new;
end;
$$;

drop trigger if exists app_state_snapshot on public.app_state;
create trigger app_state_snapshot
  after insert or update on public.app_state
  for each row execute function public.snapshot_app_state();

-- 4) Atualização em tempo real entre celular e PC.
do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception when duplicate_object then null;
end $$;
