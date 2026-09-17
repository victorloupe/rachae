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
  forma_divisao text not null default 'igual' check (forma_divisao in ('igual', 'peso', 'fixo', 'individual')),
  mes_inicio text,
  morador_especifico_id uuid references public.profiles (id) on delete set null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.contas_fixas add column if not exists mes_inicio text;
alter table public.contas_fixas add column if not exists morador_especifico_id uuid references public.profiles (id) on delete set null;

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
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),
  pago_em timestamptz,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- FUNÇÃO AUXILIAR: usuário logado é membro da casa X?
-- ============================================================
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

-- profiles: qualquer usuário autenticado pode ler nomes (necessário pra
-- listar moradores da casa); só o próprio dono edita seu perfil.
drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth" on public.profiles
  for select using (auth.role() = 'authenticated');

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

drop policy if exists "membros_insert_proprio" on public.membros_casa;
create policy "membros_insert_proprio" on public.membros_casa
  for insert with check (usuario_id = auth.uid());

drop policy if exists "membros_delete_admin" on public.membros_casa;
create policy "membros_delete_admin" on public.membros_casa
  for delete using (
    public.is_admin_casa(casa_id) or usuario_id = auth.uid()
  );

-- Helper: verifica se o usuário autenticado é admin da casa
create or replace function public.is_admin_casa(target_casa_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.membros_casa
    where casa_id = target_casa_id
      and usuario_id = auth.uid()
      and papel = 'admin'
  );
$$;

-- convites: somente admin pode gerar convites; qualquer autenticado
-- pode LER um convite específico pelo código para poder aceitá-lo.
drop policy if exists "convites_select" on public.convites;
create policy "convites_select" on public.convites
  for select using (true);

drop policy if exists "convites_insert_membros" on public.convites;
drop policy if exists "convites_insert_admin" on public.convites;
create policy "convites_insert_admin" on public.convites
  for insert with check (public.is_admin_casa(casa_id));

drop policy if exists "convites_update_uso" on public.convites;
create policy "convites_update_uso" on public.convites
  for update using (true);

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
create policy "ciclos_all" on public.ciclos_cobranca
  for all using (
    public.is_member_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  )
  with check (
    public.is_member_casa((select casa_id from public.contas_fixas where id = conta_fixa_id))
  );

drop policy if exists "cobrancas_all" on public.cobrancas_individuais;
create policy "cobrancas_all" on public.cobrancas_individuais
  for all using (
    public.is_member_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  )
  with check (
    public.is_member_casa((
      select cf.casa_id from public.ciclos_cobranca cc
      join public.contas_fixas cf on cf.id = cc.conta_fixa_id
      where cc.id = ciclo_id
    ))
  );

-- ============================================================
-- FUNÇÃO OPCIONAL: Geração automática no banco de dados
-- Pode ser agendada no Supabase (pg_cron) para rodar todo dia 1º:
-- select cron.schedule('gerar-cobrancas-mensais', '0 0 1 * *', 'select public.gerar_cobrancas_automaticas_mes()');
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
  v_valor_pessoa numeric(10,2);
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
        select array_agg(usuario_id) into v_membros
        from public.membros_casa
        where casa_id = r_conta.casa_id;

        v_num_membros := coalesce(array_length(v_membros, 1), 0);

        if v_num_membros > 0 then
          v_valor_pessoa := round(r_conta.valor_padrao / v_num_membros, 2);

          foreach v_membro_id in array v_membros loop
            insert into public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
            values (r_ciclo.id, v_membro_id, v_valor_pessoa, 'pendente')
            on conflict do nothing;
          end loop;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Fim do schema.
-- ============================================================
