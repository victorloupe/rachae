-- ============================================================
-- Migração: Fecha brechas de RLS em convites/membros e restringe
-- visibilidade de perfis à(s) casa(s) em comum.
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- O QUE ISSO CORRIGE:
-- 1. Antes, qualquer usuário autenticado podia ler TODOS os convites de
--    TODAS as casas (policy "convites_select" usava `using (true)`) e
--    se inserir como morador de qualquer casa sem convite nenhum
--    (policy "membros_insert_proprio" só checava usuario_id = auth.uid()).
--    Isso permitia entrar em qualquer casa da plataforma sem convite.
-- 2. Antes, qualquer usuário autenticado podia ler nome E TELEFONE de
--    TODOS os usuários cadastrados no app, não só dos moradores da(s)
--    própria(s) casa(s).
-- ============================================================

-- ---------- Função auxiliar: perfis compartilham alguma casa? ----------
create or replace function public.compartilha_casa(p_outro_usuario uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.membros_casa m1
    join public.membros_casa m2 on m1.casa_id = m2.casa_id
    where m1.usuario_id = auth.uid()
      and m2.usuario_id = p_outro_usuario
  );
$$;

-- ---------- profiles: restringe leitura aos moradores da mesma casa ----------
drop policy if exists "profiles_select_auth" on public.profiles;
drop policy if exists "profiles_select_compartilha_casa" on public.profiles;
create policy "profiles_select_compartilha_casa" on public.profiles
  for select using (id = auth.uid() or public.compartilha_casa(id));

-- ---------- membros_casa: autoinserção só ao criar a própria casa ----------
drop policy if exists "membros_insert_proprio" on public.membros_casa;
drop policy if exists "membros_insert_criador_casa" on public.membros_casa;
create policy "membros_insert_criador_casa" on public.membros_casa
  for insert with check (
    usuario_id = auth.uid()
    and papel = 'admin'
    and exists (
      select 1 from public.casas c
      where c.id = casa_id and c.criado_por = auth.uid()
    )
  );

-- ---------- convites: só admin lê/gera; nada de select/update público ----------
drop policy if exists "convites_select" on public.convites;
drop policy if exists "convites_select_admin" on public.convites;
create policy "convites_select_admin" on public.convites
  for select using (public.is_admin_casa(casa_id));

drop policy if exists "convites_update_uso" on public.convites;

-- ---------- Funções que substituem o acesso direto à tabela convites ----------
create or replace function public.consultar_convite(p_codigo text)
returns table (casa_id uuid, casa_nome text, casa_numero text, expira_em timestamptz, usado boolean, valido boolean)
language sql
security definer set search_path = public
stable
as $$
  select
    cv.casa_id,
    ca.nome as casa_nome,
    ca.numero as casa_numero,
    cv.expira_em,
    cv.usado,
    (not cv.usado and cv.expira_em > now()) as valido
  from public.convites cv
  join public.casas ca on ca.id = cv.casa_id
  where cv.codigo = p_codigo;
$$;

grant execute on function public.consultar_convite(text) to anon, authenticated;

create or replace function public.aceitar_convite(p_codigo text)
returns table (casa_id uuid, casa_nome text, casa_numero text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_convite record;
begin
  select cv.id, cv.casa_id, cv.usado, cv.expira_em
  into v_convite
  from public.convites cv
  where cv.codigo = p_codigo
  for update;

  if v_convite.id is null then
    raise exception 'Convite não encontrado.';
  end if;

  if v_convite.usado then
    raise exception 'Este convite já foi utilizado.';
  end if;

  if v_convite.expira_em <= now() then
    raise exception 'Este convite expirou.';
  end if;

  insert into public.membros_casa (casa_id, usuario_id, papel)
  values (v_convite.casa_id, auth.uid(), 'morador')
  on conflict (casa_id, usuario_id) do nothing;

  update public.convites set usado = true where id = v_convite.id;

  return query
    select c.id, c.nome, c.numero from public.casas c where c.id = v_convite.casa_id;
end;
$$;

grant execute on function public.aceitar_convite(text) to authenticated;

-- ---------- Rateio em centavos exatos na geração automática (pg_cron) ----------
create or replace function public.gerar_cobrancas_automaticas_mes(p_mes date default date_trunc('month', current_date)::date)
returns void
language plpgsql
security definer
as $$
declare
  r_conta record;
  r_ciclo record;
  v_membros uuid[];
  v_num_membros int;
  v_total_centavos bigint;
  v_centavos_base bigint;
  v_sobra_centavos bigint;
  v_centavos_pessoa bigint;
  v_idx int;
  v_membro_id uuid;
begin
  for r_conta in select * from public.contas_fixas where ativa = true and (mes_inicio is null or to_char(p_mes, 'YYYY-MM') >= mes_inicio) loop
    if not exists (select 1 from public.ciclos_cobranca where conta_fixa_id = r_conta.id and mes_referencia = p_mes) then
      insert into public.ciclos_cobranca (conta_fixa_id, mes_referencia, valor_total)
      values (r_conta.id, p_mes, r_conta.valor_padrao)
      returning * into r_ciclo;

      if r_conta.forma_divisao = 'individual' and r_conta.morador_especifico_id is not null then
        insert into public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
        values (r_ciclo.id, r_conta.morador_especifico_id, r_conta.valor_padrao, 'pendente')
        on conflict do nothing;
      else
        select array_agg(usuario_id order by usuario_id) into v_membros
        from public.membros_casa
        where casa_id = r_conta.casa_id;

        v_num_membros := coalesce(array_length(v_membros, 1), 0);

        if v_num_membros > 0 then
          v_total_centavos := round(r_conta.valor_padrao * 100)::bigint;
          v_centavos_base := v_total_centavos / v_num_membros;
          v_sobra_centavos := v_total_centavos - (v_centavos_base * v_num_membros);

          for v_idx in 1..v_num_membros loop
            v_membro_id := v_membros[v_idx];
            v_centavos_pessoa := v_centavos_base + (case when v_idx <= v_sobra_centavos then 1 else 0 end);

            insert into public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
            values (r_ciclo.id, v_membro_id, (v_centavos_pessoa::numeric / 100), 'pendente')
            on conflict do nothing;
          end loop;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Fim da migração.
-- ============================================================
