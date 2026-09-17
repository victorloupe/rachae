-- ============================================================
-- Migração combinada: tudo que ainda pode estar pendente
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script inteiro no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- Reúne, em um único script seguro de rodar mais de uma vez (todas
-- as instruções usam IF NOT EXISTS / DROP+CREATE), as migrações:
-- rateio proporcional, comprovante de pagamento, conta parcelada,
-- categorias e divisão por percentual. Se algum pedaço já tiver
-- sido executado antes, rodar de novo não quebra nada.
-- ============================================================

-- ---------- Rateio proporcional aos dias morados ----------
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS rateio_proporcional boolean NOT NULL DEFAULT false;

-- ---------- Comprovante de pagamento ----------
ALTER TABLE public.cobrancas_individuais
  ADD COLUMN IF NOT EXISTS comprovante_url text;

insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

drop policy if exists "comprovantes_insert_membro_casa" on storage.objects;
create policy "comprovantes_insert_membro_casa" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "comprovantes_select_membro_casa" on storage.objects;
create policy "comprovantes_select_membro_casa" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "comprovantes_update_membro_casa" on storage.objects;
create policy "comprovantes_update_membro_casa" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

-- ---------- Conta parcelada ----------
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS parcelado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcelas_total int;

-- ---------- Categorias ----------
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'outros';

-- ---------- Divisão por percentual ----------
alter table public.contas_fixas
  drop constraint if exists contas_fixas_forma_divisao_check;

alter table public.contas_fixas
  add constraint contas_fixas_forma_divisao_check
  check (forma_divisao in ('igual', 'peso', 'fixo', 'individual', 'percentual'));

create table if not exists public.divisao_conta (
  id uuid primary key default gen_random_uuid(),
  conta_fixa_id uuid not null references public.contas_fixas (id) on delete cascade,
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  peso_ou_valor numeric(10, 2) not null default 1,
  unique (conta_fixa_id, usuario_id)
);

alter table public.divisao_conta enable row level security;

drop policy if exists "divisao_conta_all" on public.divisao_conta;
drop policy if exists "divisao_conta_select" on public.divisao_conta;
create policy "divisao_conta_select" on public.divisao_conta
  for select using (
    public.is_member_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

drop policy if exists "divisao_conta_admin_mod" on public.divisao_conta;
create policy "divisao_conta_admin_mod" on public.divisao_conta
  for all using (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  )
  with check (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração combinada.
-- ============================================================
