-- ============================================================
-- Migração: Divisão por percentual customizado
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- O QUE ISSO FAZ:
-- 1. Libera 'percentual' como valor válido de forma_divisao em
--    contas_fixas (antes só aceitava igual/peso/fixo/individual).
-- 2. Garante que a tabela divisao_conta (usada para guardar o % de
--    cada morador numa conta com divisão customizada) e suas
--    policies de RLS existam — caso ela só existisse no schema.sql
--    de referência e nunca tenha sido migrada pro seu banco.
-- ============================================================

-- ---------- 1. Libera 'percentual' no CHECK de forma_divisao ----------
alter table public.contas_fixas
  drop constraint if exists contas_fixas_forma_divisao_check;

alter table public.contas_fixas
  add constraint contas_fixas_forma_divisao_check
  check (forma_divisao in ('igual', 'peso', 'fixo', 'individual', 'percentual'));

-- ---------- 2. Garante a tabela divisao_conta ----------
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
-- Fim da migração.
-- ============================================================
