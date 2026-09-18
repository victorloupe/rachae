-- ============================================================
-- Migração: Reforço de Segurança RLS em Ciclos e Cobranças
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute no Supabase > SQL Editor > New query
-- ============================================================

-- 1. Remove políticas antigas permissivas
drop policy if exists "ciclos_all" on public.ciclos_cobranca;
drop policy if exists "ciclos_select_membros" on public.ciclos_cobranca;
drop policy if exists "ciclos_admin_mod" on public.ciclos_cobranca;

drop policy if exists "cobrancas_all" on public.cobrancas_individuais;
drop policy if exists "cobrancas_select_membros" on public.cobrancas_individuais;
drop policy if exists "cobrancas_admin_all" on public.cobrancas_individuais;
drop policy if exists "cobrancas_update_proprio" on public.cobrancas_individuais;

-- 2. Políticas para CICLOS DE COBRANÇA
-- Todos os membros da casa podem visualizar os ciclos
create policy "ciclos_select_membros" on public.ciclos_cobranca
  for select using (
    public.is_member_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

-- Apenas o administrador da casa pode criar, alterar ou remover ciclos diretamente
create policy "ciclos_admin_mod" on public.ciclos_cobranca
  for all using (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  )
  with check (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

-- 3. Políticas para COBRANÇAS INDIVIDUAIS
-- Todos os membros da casa podem visualizar as cobranças do ciclo
create policy "cobrancas_select_membros" on public.cobrancas_individuais
  for select using (
    public.is_member_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  );

-- Administrador da casa tem controle total (criar, editar, remover qualquer cobrança)
create policy "cobrancas_admin_all" on public.cobrancas_individuais
  for all using (
    public.is_admin_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  )
  with check (
    public.is_admin_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  );

-- Morador comum pode atualizar sua própria cobrança (necessário para anexar comprovante_url)
create policy "cobrancas_update_proprio" on public.cobrancas_individuais
  for update using (
    usuario_id = auth.uid()
    and public.is_member_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  )
  with check (
    usuario_id = auth.uid()
  );

-- 4. TRIGGER DE PROTEÇÃO: Impede que morador comum altere status ou valor da cobrança
create or replace function public.proteger_status_cobranca()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
begin
  -- Se houver tentativa de alterar status ou valor
  if (new.status is distinct from old.status) or (new.valor is distinct from old.valor) then
    select cf.casa_id into v_casa_id
    from public.ciclos_cobranca cc
    join public.contas_fixas cf on cf.id = cc.conta_fixa_id
    where cc.id = new.ciclo_id;

    -- Se for um usuário logado e ele NÃO for admin da casa, bloqueia a operação
    if auth.uid() is not null and not public.is_admin_casa(v_casa_id) then
      raise exception 'Apenas o administrador da casa pode alterar o status ou valor desta cobrança.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_status_cobranca on public.cobrancas_individuais;
create trigger trg_proteger_status_cobranca
  before update on public.cobrancas_individuais
  for each row
  execute function public.proteger_status_cobranca();

-- 5. Função RPC para confirmação segura de pagamento pelo Admin
create or replace function public.confirmar_pagamento_cobranca(p_cobranca_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
begin
  select cf.casa_id into v_casa_id
  from public.cobrancas_individuais ci
  join public.ciclos_cobranca cc on cc.id = ci.ciclo_id
  join public.contas_fixas cf on cf.id = cc.conta_fixa_id
  where ci.id = p_cobranca_id;

  if v_casa_id is null then
    raise exception 'Cobrança não encontrada.';
  end if;

  if not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o administrador pode confirmar o pagamento.';
  end if;

  update public.cobrancas_individuais
  set status = 'pago', pago_em = now()
  where id = p_cobranca_id;

  return true;
end;
$$;

grant execute on function public.confirmar_pagamento_cobranca(uuid) to authenticated;

-- 6. Função RPC para reverter pagamento para pendente pelo Admin
create or replace function public.reverter_pagamento_cobranca(p_cobranca_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
begin
  select cf.casa_id into v_casa_id
  from public.cobrancas_individuais ci
  join public.ciclos_cobranca cc on cc.id = ci.ciclo_id
  join public.contas_fixas cf on cf.id = cc.conta_fixa_id
  where ci.id = p_cobranca_id;

  if v_casa_id is null then
    raise exception 'Cobrança não encontrada.';
  end if;

  if not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o administrador pode reverter o status.';
  end if;

  update public.cobrancas_individuais
  set status = 'pendente', pago_em = null
  where id = p_cobranca_id;

  return true;
end;
$$;

grant execute on function public.reverter_pagamento_cobranca(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
