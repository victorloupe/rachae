-- ============================================================
-- Migração: Mês de Início e Morador Específico em Contas Fixas
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do Supabase para atualizar a
-- estrutura da tabela contas_fixas.
-- ============================================================

-- 1. Adiciona coluna de mês de início (formato 'YYYY-MM', ex: '2026-10')
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS mes_inicio text;

-- 2. Adiciona coluna de morador específico para contas individuais
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS morador_especifico_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- 3. Atualiza a constraint de forma_divisao para aceitar 'individual'
ALTER TABLE public.contas_fixas
  DROP CONSTRAINT IF EXISTS contas_fixas_forma_divisao_check;

ALTER TABLE public.contas_fixas
  ADD CONSTRAINT contas_fixas_forma_divisao_check
  CHECK (forma_divisao IN ('igual', 'peso', 'fixo', 'individual'));

-- Comentários para documentação das novas colunas
COMMENT ON COLUMN public.contas_fixas.mes_inicio IS 'Mês a partir do qual a conta começa a ser cobrada (YYYY-MM). Se nulo, cobra imediatamente.';
COMMENT ON COLUMN public.contas_fixas.morador_especifico_id IS 'ID do morador responsável quando a divisão for individual (100% cobrado dele).';

-- 4. Atualiza a função opcional de geração automática no banco de dados
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
