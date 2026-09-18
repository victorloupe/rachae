-- ============================================================
-- RachaFixo — Schema do banco (Supabase / Postgres)
-- Rode este arquivo inteiro em: Supabase > SQL Editor > New query
-- ============================================================

-- ---------- EXTENSÕES ----------
create extension if not exists "pgcrypto";

-- ---------- PERFIS (espelha auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  telefone text,
  criado_em timestamptz not null default now()
);
alter table public.profiles add column if not exists chave_pix text;
alter table public.profiles add column if not exists tipo_chave_pix text default 'telefone';
alter table public.profiles add column if not exists nome_titular_pix text;
alter table public.profiles add column if not exists banco_pix text;

-- Cria o perfil automaticamente quando alguém se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, telefone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'telefone'
  )
  on conflict (id) do update set
    nome = coalesce(excluded.nome, public.profiles.nome),
    telefone = coalesce(excluded.telefone, public.profiles.telefone);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- CASAS ----------
create table if not exists public.casas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  numero text,
  criado_por uuid not null references public.profiles (id),
  criado_em timestamptz not null default now()
);
alter table public.casas add column if not exists numero text;
alter table public.casas add column if not exists chave_pix text;
alter table public.casas add column if not exists tipo_chave_pix text default 'telefone';
alter table public.casas add column if not exists nome_titular_pix text;
alter table public.casas add column if not exists banco_pix text;

-- ---------- MEMBROS DA CASA ----------
create table if not exists public.membros_casa (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  papel text not null default 'morador' check (papel in ('admin', 'morador')),
  entrou_em timestamptz not null default now(),
  unique (casa_id, usuario_id)
);

-- ---------- CONVITES ----------
create table if not exists public.convites (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  codigo text not null unique default encode(gen_random_bytes(6), 'hex'),
  criado_por uuid not null references public.profiles (id),
  usado boolean not null default false,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '7 days')
);

-- ---------- CONTAS FIXAS ----------
create table if not exists public.contas_fixas (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas (id) on delete cascade,
  nome text not null,
  valor_padrao numeric(10, 2) not null default 0,
  tipo_valor text not null default 'fixo' check (tipo_valor in ('fixo', 'variavel')),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  forma_divisao text not null default 'igual' check (forma_divisao in ('igual', 'peso', 'fixo', 'individual', 'percentual')),
  mes_inicio text,
  morador_especifico_id uuid references public.profiles (id) on delete set null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.contas_fixas add column if not exists mes_inicio text;
alter table public.contas_fixas add column if not exists morador_especifico_id uuid references public.profiles (id) on delete set null;
alter table public.contas_fixas add column if not exists privada boolean not null default false;
alter table public.contas_fixas add column if not exists rateio_proporcional boolean not null default false;
alter table public.contas_fixas add column if not exists parcelado boolean not null default false;
alter table public.contas_fixas add column if not exists parcelas_total int;
alter table public.contas_fixas add column if not exists categoria text not null default 'outros';

-- ---------- DIVISÃO DA CONTA (peso ou valor fixo por morador) ----------
create table if not exists public.divisao_conta (
  id uuid primary key default gen_random_uuid(),
  conta_fixa_id uuid not null references public.contas_fixas (id) on delete cascade,
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  peso_ou_valor numeric(10, 2) not null default 1,
  unique (conta_fixa_id, usuario_id)
);

-- ---------- CICLOS DE COBRANÇA (um por conta, por mês) ----------
create table if not exists public.ciclos_cobranca (
  id uuid primary key default gen_random_uuid(),
  conta_fixa_id uuid not null references public.contas_fixas (id) on delete cascade,
  mes_referencia date not null, -- sempre dia 1 do mês, ex: 2026-10-01
  valor_total numeric(10, 2) not null,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  criado_em timestamptz not null default now(),
  unique (conta_fixa_id, mes_referencia)
);

-- ---------- COBRANÇAS INDIVIDUAIS (uma por morador, por ciclo) ----------
create table if not exists public.cobrancas_individuais (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references public.ciclos_cobranca (id) on delete cascade,
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  valor numeric(10, 2) not null,
  pix_qrcode text,
  pix_copia_cola text,
  pix_txid text,
  status text not null default 'pendente' check (status in ('pendente', 'em_analise', 'pago', 'atrasado')),
  pago_em timestamptz,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- FUNÇÕES AUXILIARES (precisam existir antes das policies que as usam)
-- ============================================================

-- usuário logado é membro da casa X?
create or replace function public.is_member_casa(p_casa_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.membros_casa
    where casa_id = p_casa_id and usuario_id = auth.uid()
  );
$$;

-- usuário logado é admin da casa X?
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

-- usuário logado mora numa casa em comum com p_outro_usuario? (usado para
-- limitar a visibilidade de perfis aos moradores da mesma casa)
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

-- ============================================================
-- RLS — cada morador só vê/edita dados da(s) casa(s) dele
-- ============================================================
alter table public.profiles enable row level security;
alter table public.casas enable row level security;
alter table public.membros_casa enable row level security;
alter table public.convites enable row level security;
alter table public.contas_fixas enable row level security;
alter table public.divisao_conta enable row level security;
alter table public.ciclos_cobranca enable row level security;
alter table public.cobrancas_individuais enable row level security;

-- profiles: você sempre vê o seu próprio perfil, e os perfis de quem
-- mora numa casa em comum com você (necessário pra listar moradores).
-- Não expõe telefone/nome de usuários de outras casas.
drop policy if exists "profiles_select_auth" on public.profiles;
drop policy if exists "profiles_select_compartilha_casa" on public.profiles;
create policy "profiles_select_compartilha_casa" on public.profiles
  for select using (id = auth.uid() or public.compartilha_casa(id));

drop policy if exists "profiles_insert_proprio" on public.profiles;
create policy "profiles_insert_proprio" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio" on public.profiles
  for update using (id = auth.uid());

-- casas: membros veem ou o próprio criador; qualquer autenticado pode criar (vira admin em seguida).
drop policy if exists "casas_select_membros" on public.casas;
create policy "casas_select_membros" on public.casas
  for select using (public.is_member_casa(id) or criado_por = auth.uid());

drop policy if exists "casas_insert_auth" on public.casas;
create policy "casas_insert_auth" on public.casas
  for insert with check (auth.uid() = criado_por);

drop policy if exists "casas_update_admin" on public.casas;
create policy "casas_update_admin" on public.casas
  for update using (public.is_admin_casa(id))
  with check (public.is_admin_casa(id));

-- membros_casa: membros da casa veem a lista de todos os membros.
drop policy if exists "membros_select" on public.membros_casa;
create policy "membros_select" on public.membros_casa
  for select using (public.is_member_casa(casa_id) or usuario_id = auth.uid());

-- Autoinserção só é permitida quando a pessoa está criando a própria casa
-- (e virando admin dela). Entrar como morador numa casa existente exige um
-- convite válido e passa pela função aceitar_convite() (abaixo), que roda
-- como security definer e não depende desta policy.
drop policy if exists "membros_insert_proprio" on public.membros_casa;
create policy "membros_insert_criador_casa" on public.membros_casa
  for insert with check (
    usuario_id = auth.uid()
    and papel = 'admin'
    and exists (
      select 1 from public.casas c
      where c.id = casa_id and c.criado_por = auth.uid()
    )
  );

drop policy if exists "membros_delete_admin" on public.membros_casa;
create policy "membros_delete_admin" on public.membros_casa
  for delete using (
    public.is_admin_casa(casa_id) or usuario_id = auth.uid()
  );

-- convites: só o admin da casa lista/gera os convites dela. Não há mais
-- select/update abertos — a leitura de um convite específico por código
-- (para mostrar o nome da casa antes do login) e a entrada na casa usam
-- as funções consultar_convite() / aceitar_convite() logo abaixo, que são
-- security definer e não expõem a tabela inteira.
drop policy if exists "convites_select" on public.convites;
create policy "convites_select_admin" on public.convites
  for select using (public.is_admin_casa(casa_id));

drop policy if exists "convites_insert_membros" on public.convites;
drop policy if exists "convites_insert_admin" on public.convites;
create policy "convites_insert_admin" on public.convites
  for insert with check (public.is_admin_casa(casa_id));

drop policy if exists "convites_update_uso" on public.convites;

-- contas_fixas: todos os membros podem visualizar, mas apenas admin pode criar/editar/remover.
drop policy if exists "contas_fixas_all" on public.contas_fixas;
drop policy if exists "contas_fixas_select" on public.contas_fixas;
create policy "contas_fixas_select" on public.contas_fixas
  for select using (public.is_member_casa(casa_id));

drop policy if exists "contas_fixas_admin_mod" on public.contas_fixas;
create policy "contas_fixas_admin_mod" on public.contas_fixas
  for all using (public.is_admin_casa(casa_id))
  with check (public.is_admin_casa(casa_id));

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

drop policy if exists "ciclos_all" on public.ciclos_cobranca;
drop policy if exists "ciclos_select_membros" on public.ciclos_cobranca;
drop policy if exists "ciclos_admin_mod" on public.ciclos_cobranca;
create policy "ciclos_select_membros" on public.ciclos_cobranca
  for select using (
    public.is_member_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );
create policy "ciclos_admin_mod" on public.ciclos_cobranca
  for all using (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  )
  with check (
    public.is_admin_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

drop policy if exists "cobrancas_all" on public.cobrancas_individuais;
drop policy if exists "cobrancas_select_membros" on public.cobrancas_individuais;
drop policy if exists "cobrancas_admin_all" on public.cobrancas_individuais;
drop policy if exists "cobrancas_update_proprio" on public.cobrancas_individuais;
create policy "cobrancas_select_membros" on public.cobrancas_individuais
  for select using (
    public.is_member_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  );
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

-- Trigger de proteção para garantir que morador não altere status nem valor
create or replace function public.proteger_status_cobranca()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
begin
  -- Se o valor está sendo alterado, apenas admin pode
  if new.valor is distinct from old.valor then
    select cf.casa_id into v_casa_id
    from public.ciclos_cobranca cc
    join public.contas_fixas cf on cf.id = cc.conta_fixa_id
    where cc.id = new.ciclo_id;

    if auth.uid() is not null and not public.is_admin_casa(v_casa_id) then
      raise exception 'Apenas o administrador da casa pode alterar o valor desta cobrança.';
    end if;
  end if;

  -- Se o status está sendo alterado
  if new.status is distinct from old.status then
    select cf.casa_id into v_casa_id
    from public.ciclos_cobranca cc
    join public.contas_fixas cf on cf.id = cc.conta_fixa_id
    where cc.id = new.ciclo_id;

    -- Permite que o próprio morador mude de 'pendente' ou 'atrasado' para 'em_analise' se anexar comprovante
    if (old.status in ('pendente', 'atrasado')) and new.status = 'em_analise' and (new.comprovante_url is not null) then
      if auth.uid() is not null and new.usuario_id <> auth.uid() and not public.is_admin_casa(v_casa_id) then
        raise exception 'Você só pode enviar comprovante para sua própria cobrança.';
      end if;
    else
      -- Qualquer outra transição de status exige ser admin da casa
      if auth.uid() is not null and not public.is_admin_casa(v_casa_id) then
        raise exception 'Apenas o administrador da casa pode aprovar pagamentos ou alterar status desta cobrança.';
      end if;
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

-- Funções RPC para administração segura de pagamentos
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

  if v_casa_id is null or not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o administrador pode confirmar o pagamento.';
  end if;

  update public.cobrancas_individuais
  set status = 'pago', pago_em = now()
  where id = p_cobranca_id;

  return true;
end;
$$;
grant execute on function public.confirmar_pagamento_cobranca(uuid) to authenticated;

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

  if v_casa_id is null or not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o administrador pode reverter o status.';
  end if;

  update public.cobrancas_individuais
  set status = 'pendente', pago_em = null
  where id = p_cobranca_id;

  return true;
end;
$$;
grant execute on function public.reverter_pagamento_cobranca(uuid) to authenticated;

-- RPC: Enviar comprovante com transição para em_analise
create or replace function public.enviar_comprovante_cobranca(p_cobranca_id uuid, p_caminho text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
  v_usuario_id uuid;
begin
  select cf.casa_id, ci.usuario_id into v_casa_id, v_usuario_id
  from public.cobrancas_individuais ci
  join public.ciclos_cobranca cc on cc.id = ci.ciclo_id
  join public.contas_fixas cf on cf.id = cc.conta_fixa_id
  where ci.id = p_cobranca_id;

  if v_casa_id is null then
    raise exception 'Cobrança não encontrada.';
  end if;

  if auth.uid() is not null and auth.uid() <> v_usuario_id and not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o titular desta cobrança ou o administrador pode anexar comprovante.';
  end if;

  update public.cobrancas_individuais
  set comprovante_url = p_caminho,
      status = 'em_analise'
  where id = p_cobranca_id;

  return true;
end;
$$;
grant execute on function public.enviar_comprovante_cobranca(uuid, text) to authenticated;

-- RPC: Recusar comprovante
create or replace function public.recusar_comprovante_cobranca(p_cobranca_id uuid)
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

  if v_casa_id is null or not public.is_admin_casa(v_casa_id) then
    raise exception 'Apenas o administrador da casa pode recusar comprovantes.';
  end if;

  update public.cobrancas_individuais
  set status = 'pendente',
      comprovante_url = null
  where id = p_cobranca_id;

  return true;
end;
$$;
grant execute on function public.recusar_comprovante_cobranca(uuid) to authenticated;

-- RPC: Sincronização atômica de ciclos e cobranças do mês
create or replace function public.sincronizar_cobrancas_mes(p_casa_id uuid, p_mes date)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  r_conta record;
  r_ciclo record;
  v_mes_str text;
  v_membros uuid[];
  v_num_membros int;
  v_total_centavos bigint;
  v_centavos_base bigint;
  v_sobra_centavos bigint;
  v_centavos_pessoa bigint;
  v_idx int;
  v_membro_id uuid;
  v_ano_ini int;
  v_mes_ini int;
  v_ano_ref int;
  v_mes_ref int;
  v_diff_meses int;
  v_parcela_atual int;
  r_div record;
  v_soma_percentual numeric;
begin
  if not public.is_member_casa(p_casa_id) then
    raise exception 'Acesso negado para esta casa.';
  end if;

  v_mes_str := to_char(p_mes, 'YYYY-MM');

  for r_conta in
    select * from public.contas_fixas
    where casa_id = p_casa_id
      and ativa = true
      and (mes_inicio is null or v_mes_str >= mes_inicio)
  loop
    if r_conta.parcelado and r_conta.parcelas_total is not null and r_conta.mes_inicio is not null then
      v_ano_ini := split_part(r_conta.mes_inicio, '-', 1)::int;
      v_mes_ini := split_part(r_conta.mes_inicio, '-', 2)::int;
      v_ano_ref := split_part(v_mes_str, '-', 1)::int;
      v_mes_ref := split_part(v_mes_str, '-', 2)::int;
      v_diff_meses := (v_ano_ref - v_ano_ini) * 12 + (v_mes_ref - v_mes_ini);
      v_parcela_atual := v_diff_meses + 1;

      if v_parcela_atual < 1 or v_parcela_atual > r_conta.parcelas_total then
        continue;
      end if;
    end if;

    select * into r_ciclo
    from public.ciclos_cobranca
    where conta_fixa_id = r_conta.id and mes_referencia = p_mes;

    if r_ciclo.id is null then
      insert into public.ciclos_cobranca (conta_fixa_id, mes_referencia, valor_total)
      values (r_conta.id, p_mes, r_conta.valor_padrao)
      returning * into r_ciclo;
    end if;

    if not exists (select 1 from public.cobrancas_individuais where ciclo_id = r_ciclo.id) then
      if r_conta.forma_divisao = 'individual' and r_conta.morador_especifico_id is not null then
        insert into public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
        values (r_ciclo.id, r_conta.morador_especifico_id, r_ciclo.valor_total, 'pendente')
        on conflict do nothing;
      elsif r_conta.forma_divisao = 'percentual' then
        select coalesce(sum(peso_ou_valor), 0) into v_soma_percentual
        from public.divisao_conta
        where conta_fixa_id = r_conta.id;

        if v_soma_percentual > 0 then
          for r_div in
            select usuario_id, peso_ou_valor
            from public.divisao_conta
            where conta_fixa_id = r_conta.id and peso_ou_valor > 0
          loop
            insert into public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
            values (
              r_ciclo.id,
              r_div.usuario_id,
              round((r_ciclo.valor_total * (r_div.peso_ou_valor / v_soma_percentual)), 2),
              'pendente'
            )
            on conflict do nothing;
          end loop;
        end if;
      else
        select array_agg(usuario_id order by entrou_em asc, usuario_id asc) into v_membros
        from public.membros_casa
        where casa_id = p_casa_id
          and (entrou_em is null or entrou_em <= (r_ciclo.criado_em + interval '1 day'));

        v_num_membros := coalesce(array_length(v_membros, 1), 0);

        if v_num_membros > 0 then
          v_total_centavos := round(r_ciclo.valor_total * 100)::bigint;
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

  return true;
end;
$$;
grant execute on function public.sincronizar_cobrancas_mes(uuid, date) to authenticated;

-- ============================================================
-- CONVITES: consulta segura por código + aceite atômico
-- ------------------------------------------------------------
-- Substituem o acesso direto à tabela `convites` no front-end para
-- fechar duas brechas: (1) enumerar todos os convites de todas as
-- casas (a policy antiga de select usava `using (true)`) e (2) entrar
-- em qualquer casa sem convite (a policy antiga de insert em
-- membros_casa só checava `usuario_id = auth.uid()`).
-- ============================================================

-- Consulta pública (inclusive antes do login) de um convite pelo código
-- exato — não permite listar/enumerar convites, só validar um código que
-- a pessoa já possui (do link ou digitado).
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

-- Aceite atômico do convite: valida, adiciona o morador e marca o
-- convite como usado numa única transação (evita corrida entre duas
-- pessoas usando o mesmo código ao mesmo tempo).
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

-- ============================================================
-- FUNÇÃO OPCIONAL: Geração automática no banco de dados
-- Pode ser agendada no Supabase (pg_cron) para rodar todo dia 1º:
-- select cron.schedule('gerar-cobrancas-mensais', '0 0 1 * *', 'select public.gerar_cobrancas_automaticas_mes()');
--
-- O rateio abaixo usa aritmética em centavos (igual ao que o front-end
-- faz em dashboard.js): divide o valor total em centavos inteiros e
-- distribui o resto de centavos, um a um, entre os primeiros moradores
-- da lista — garantindo que a soma das cobranças individuais bata
-- exatamente com o valor total da conta, mesmo quando a divisão não é
-- exata (ex.: R$ 100,00 entre 3 pessoas).
-- ============================================================
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


-- ---------- Comprovante de pagamento (Storage) ----------
alter table public.cobrancas_individuais add column if not exists comprovante_url text;

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

-- ============================================================
-- FASE 3: DESPESAS AVULSAS / EXTRAS / MERCADO
-- ============================================================
create table if not exists public.despesas_avulsas (
  id uuid primary key default gen_random_uuid(),
  casa_id uuid not null references public.casas(id) on delete cascade,
  descricao text not null,
  valor numeric(10,2) not null check (valor > 0),
  categoria text not null default 'alimentacao',
  pago_por_id uuid not null references public.profiles(id) on delete cascade,
  data date not null default current_date,
  mes_referencia date not null,
  comprovante_url text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_despesas_avulsas_casa_mes 
  on public.despesas_avulsas (casa_id, mes_referencia);

create table if not exists public.despesas_avulsas_participantes (
  despesa_id uuid not null references public.despesas_avulsas(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  valor_cota numeric(10,2) not null check (valor_cota >= 0),
  pago boolean not null default false,
  pago_em timestamptz,
  primary key (despesa_id, usuario_id)
);

create index if not exists idx_despesas_avulsas_part_usuario 
  on public.despesas_avulsas_participantes (usuario_id);

alter table public.despesas_avulsas enable row level security;
alter table public.despesas_avulsas_participantes enable row level security;

drop policy if exists "despesas_avulsas_select" on public.despesas_avulsas;
create policy "despesas_avulsas_select" on public.despesas_avulsas
  for select using (public.is_member_casa(casa_id));

drop policy if exists "despesas_avulsas_insert" on public.despesas_avulsas;
create policy "despesas_avulsas_insert" on public.despesas_avulsas
  for insert with check (public.is_member_casa(casa_id) and auth.uid() is not null);

drop policy if exists "despesas_avulsas_update" on public.despesas_avulsas;
create policy "despesas_avulsas_update" on public.despesas_avulsas
  for update using (public.is_admin_casa(casa_id) or pago_por_id = auth.uid());

drop policy if exists "despesas_avulsas_delete" on public.despesas_avulsas;
create policy "despesas_avulsas_delete" on public.despesas_avulsas
  for delete using (public.is_admin_casa(casa_id) or pago_por_id = auth.uid());

drop policy if exists "despesas_part_select" on public.despesas_avulsas_participantes;
create policy "despesas_part_select" on public.despesas_avulsas_participantes
  for select using (
    public.is_member_casa((select casa_id from public.despesas_avulsas where id = despesa_id))
  );

drop policy if exists "despesas_part_insert" on public.despesas_avulsas_participantes;
create policy "despesas_part_insert" on public.despesas_avulsas_participantes
  for insert with check (
    public.is_member_casa((select casa_id from public.despesas_avulsas where id = despesa_id))
  );

drop policy if exists "despesas_part_update" on public.despesas_avulsas_participantes;
create policy "despesas_part_update" on public.despesas_avulsas_participantes
  for update using (
    public.is_admin_casa((select casa_id from public.despesas_avulsas where id = despesa_id))
    or usuario_id = auth.uid()
    or (select pago_por_id from public.despesas_avulsas where id = despesa_id) = auth.uid()
  );

drop policy if exists "despesas_part_delete" on public.despesas_avulsas_participantes;
create policy "despesas_part_delete" on public.despesas_avulsas_participantes
  for delete using (
    public.is_admin_casa((select casa_id from public.despesas_avulsas where id = despesa_id))
    or (select pago_por_id from public.despesas_avulsas where id = despesa_id) = auth.uid()
  );

-- RPC: Criar despesa avulsa com participantes de forma atômica
create or replace function public.criar_despesa_avulsa(
  p_casa_id uuid,
  p_descricao text,
  p_valor numeric,
  p_categoria text,
  p_pago_por_id uuid,
  p_data date,
  p_mes_referencia date,
  p_participantes uuid[],
  p_comprovante_url text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_despesa_id uuid;
  v_num_parts int;
  v_total_centavos bigint;
  v_centavos_base bigint;
  v_sobra_centavos bigint;
  v_centavos_part bigint;
  v_idx int;
  v_usuario_id uuid;
  v_eh_pagador boolean;
begin
  if not public.is_member_casa(p_casa_id) then
    raise exception 'Acesso não autorizado para esta casa.';
  end if;

  if p_valor <= 0 then
    raise exception 'O valor da despesa deve ser maior que zero.';
  end if;

  v_num_parts := coalesce(array_length(p_participantes, 1), 0);
  if v_num_parts = 0 then
    raise exception 'Pelo menos um participante deve ser selecionado para a divisão.';
  end if;

  insert into public.despesas_avulsas (
    casa_id, descricao, valor, categoria, pago_por_id, data, mes_referencia, comprovante_url
  ) values (
    p_casa_id, trim(p_descricao), p_valor, coalesce(p_categoria, 'outros'),
    p_pago_por_id, coalesce(p_data, current_date), p_mes_referencia, p_comprovante_url
  ) returning id into v_despesa_id;

  v_total_centavos := round(p_valor * 100)::bigint;
  v_centavos_base := v_total_centavos / v_num_parts;
  v_sobra_centavos := v_total_centavos - (v_centavos_base * v_num_parts);

  for v_idx in 1..v_num_parts loop
    v_usuario_id := p_participantes[v_idx];
    v_centavos_part := v_centavos_base + (case when v_idx <= v_sobra_centavos then 1 else 0 end);
    v_eh_pagador := (v_usuario_id = p_pago_por_id);

    insert into public.despesas_avulsas_participantes (
      despesa_id, usuario_id, valor_cota, pago, pago_em
    ) values (
      v_despesa_id,
      v_usuario_id,
      (v_centavos_part::numeric / 100),
      v_eh_pagador,
      case when v_eh_pagador then now() else null end
    );
  end loop;

  return v_despesa_id;
end;
$$;
grant execute on function public.criar_despesa_avulsa(uuid, text, numeric, text, uuid, date, date, uuid[], text) to authenticated;

create or replace function public.alternar_status_cota_avulsa(
  p_despesa_id uuid,
  p_usuario_id uuid,
  p_pago boolean
)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_casa_id uuid;
  v_pago_por_id uuid;
begin
  select da.casa_id, da.pago_por_id into v_casa_id, v_pago_por_id
  from public.despesas_avulsas da
  where da.id = p_despesa_id;

  if v_casa_id is null then
    raise exception 'Despesa não encontrada.';
  end if;

  if not (public.is_admin_casa(v_casa_id) or v_pago_por_id = auth.uid()) then
    raise exception 'Apenas quem pagou a compra ou o administrador pode confirmar o acerto desta cota.';
  end if;

  update public.despesas_avulsas_participantes
  set pago = p_pago,
      pago_em = case when p_pago then now() else null end
  where despesa_id = p_despesa_id and usuario_id = p_usuario_id;

  return true;
end;
$$;
grant execute on function public.alternar_status_cota_avulsa(uuid, uuid, boolean) to authenticated;

-- ============================================================
-- Fim do schema.
-- ============================================================
