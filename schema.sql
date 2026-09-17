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
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),
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
-- Fim do schema.
-- ============================================================
