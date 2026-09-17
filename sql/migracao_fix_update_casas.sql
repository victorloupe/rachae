-- ============================================================
-- Migração: Garante a policy de UPDATE em 'casas' (chave Pix)
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- POR QUE ISSO É NECESSÁRIO:
-- A tabela 'casas' tem RLS habilitado, mas nunca existiu no banco uma
-- policy de UPDATE para ela (só existem policies de SELECT e INSERT).
-- Sem policy de UPDATE, o Postgres nega a atualização silenciosamente:
-- o Supabase não retorna erro nenhum (por isso o app mostrava "salvo
-- com sucesso"), mas 0 linhas são de fato alteradas — por isso a
-- Chave Pix da Casa "sumia" ao recarregar a página.
-- ============================================================

-- Função auxiliar (só recria caso ainda não exista no seu banco).
create or replace function public.is_admin_casa(target_casa_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.membros_casa
    where casa_id = target_casa_id
      and usuario_id = auth.uid()
      and papel = 'admin'
  );
$$;

drop policy if exists "casas_update_admin" on public.casas;
create policy "casas_update_admin" on public.casas
  for update using (public.is_admin_casa(id))
  with check (public.is_admin_casa(id));

-- ============================================================
-- Fim da migração.
-- ============================================================
