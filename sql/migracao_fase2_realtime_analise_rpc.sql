-- ============================================================
-- Migração Fase 2: Realtime, Status "Em Análise" e RPC de Cobranças
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute no Supabase > SQL Editor > New query
-- ============================================================

-- 1. ATUALIZAÇÃO DA CONSTRAINT DE STATUS
-- Permite o novo status 'em_analise' para quando o morador envia comprovante
ALTER TABLE public.cobrancas_individuais
  DROP CONSTRAINT IF EXISTS cobrancas_individuais_status_check;

ALTER TABLE public.cobrancas_individuais
  ADD CONSTRAINT cobrancas_individuais_status_check
  CHECK (status IN ('pendente', 'em_analise', 'pago', 'atrasado'));

-- 2. HABILITAR SUPABASE REALTIME
-- Adiciona tabelas na publicação do realtime para sincronização ao vivo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cobrancas_individuais'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cobrancas_individuais;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'contas_fixas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contas_fixas;
  END IF;
END $$;

-- 3. AJUSTE DO TRIGGER DE PROTEÇÃO
-- Permite que o morador altere o status para 'em_analise' se estiver anexando o comprovante
CREATE OR REPLACE FUNCTION public.proteger_status_cobranca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_casa_id uuid;
BEGIN
  -- Se o valor está sendo alterado, apenas admin pode
  IF new.valor IS DISTINCT FROM old.valor THEN
    SELECT cf.casa_id INTO v_casa_id
    FROM public.ciclos_cobranca cc
    JOIN public.contas_fixas cf ON cf.id = cc.conta_fixa_id
    WHERE cc.id = new.ciclo_id;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin_casa(v_casa_id) THEN
      RAISE EXCEPTION 'Apenas o administrador da casa pode alterar o valor desta cobrança.';
    END IF;
  END IF;

  -- Se o status está sendo alterado
  IF new.status IS DISTINCT FROM old.status THEN
    SELECT cf.casa_id INTO v_casa_id
    FROM public.ciclos_cobranca cc
    JOIN public.contas_fixas cf ON cf.id = cc.conta_fixa_id
    WHERE cc.id = new.ciclo_id;

    -- Permite que o próprio morador mude de 'pendente' (ou 'atrasado') para 'em_analise' se anexar comprovante
    IF (old.status IN ('pendente', 'atrasado')) AND new.status = 'em_analise' AND (new.comprovante_url IS NOT NULL) THEN
      IF auth.uid() IS NOT NULL AND new.usuario_id <> auth.uid() AND NOT public.is_admin_casa(v_casa_id) THEN
        RAISE EXCEPTION 'Você só pode enviar comprovante para sua própria cobrança.';
      END IF;
    ELSE
      -- Qualquer outra transição de status (ex: para 'pago' ou 'pendente') exige ser admin da casa
      IF auth.uid() IS NOT NULL AND NOT public.is_admin_casa(v_casa_id) THEN
        RAISE EXCEPTION 'Apenas o administrador da casa pode aprovar pagamentos ou alterar status desta cobrança.';
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- 4. RPC: ENVIAR COMPROVANTE (Muda status para 'em_analise')
CREATE OR REPLACE FUNCTION public.enviar_comprovante_cobranca(p_cobranca_id uuid, p_caminho text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_casa_id uuid;
  v_usuario_id uuid;
BEGIN
  SELECT cf.casa_id, ci.usuario_id INTO v_casa_id, v_usuario_id
  FROM public.cobrancas_individuais ci
  JOIN public.ciclos_cobranca cc ON cc.id = ci.ciclo_id
  JOIN public.contas_fixas cf ON cf.id = cc.conta_fixa_id
  WHERE ci.id = p_cobranca_id;

  IF v_casa_id IS NULL THEN
    RAISE EXCEPTION 'Cobrança não encontrada.';
  END IF;

  -- Permite apenas o dono da cobrança ou o admin
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_usuario_id AND NOT public.is_admin_casa(v_casa_id) THEN
    RAISE EXCEPTION 'Apenas o titular desta cobrança ou o administrador pode anexar comprovante.';
  END IF;

  UPDATE public.cobrancas_individuais
  SET comprovante_url = p_caminho,
      status = 'em_analise'
  WHERE id = p_cobranca_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enviar_comprovante_cobranca(uuid, text) TO authenticated;

-- 5. RPC: RECUSAR COMPROVANTE (Reverte para 'pendente')
CREATE OR REPLACE FUNCTION public.recusar_comprovante_cobranca(p_cobranca_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_casa_id uuid;
BEGIN
  SELECT cf.casa_id INTO v_casa_id
  FROM public.cobrancas_individuais ci
  JOIN public.ciclos_cobranca cc ON cc.id = ci.ciclo_id
  JOIN public.contas_fixas cf ON cf.id = cc.conta_fixa_id
  WHERE ci.id = p_cobranca_id;

  IF v_casa_id IS NULL THEN
    RAISE EXCEPTION 'Cobrança não encontrada.';
  END IF;

  IF NOT public.is_admin_casa(v_casa_id) THEN
    RAISE EXCEPTION 'Apenas o administrador da casa pode recusar comprovantes.';
  END IF;

  UPDATE public.cobrancas_individuais
  SET status = 'pendente',
      comprovante_url = null
  WHERE id = p_cobranca_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recusar_comprovante_cobranca(uuid) TO authenticated;

-- 6. RPC: GERAÇÃO TRANSACIONAL DE COBRANÇAS DO MÊS
-- Sincroniza ciclos e cobranças de todas as contas ativas de uma casa de forma atômica
CREATE OR REPLACE FUNCTION public.sincronizar_cobrancas_mes(p_casa_id uuid, p_mes date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
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
BEGIN
  -- Valida se o usuário autenticado pertence a esta casa
  IF NOT public.is_member_casa(p_casa_id) THEN
    RAISE EXCEPTION 'Acesso negado para esta casa.';
  END IF;

  v_mes_str := to_char(p_mes, 'YYYY-MM');

  FOR r_conta IN
    SELECT * FROM public.contas_fixas
    WHERE casa_id = p_casa_id
      AND ativa = true
      AND (mes_inicio IS NULL OR v_mes_str >= mes_inicio)
  LOOP
    -- Se a conta for parcelada, verifica se a parcela já expirou
    IF r_conta.parcelado AND r_conta.parcelas_total IS NOT NULL AND r_conta.mes_inicio IS NOT NULL THEN
      v_ano_ini := split_part(r_conta.mes_inicio, '-', 1)::int;
      v_mes_ini := split_part(r_conta.mes_inicio, '-', 2)::int;
      v_ano_ref := split_part(v_mes_str, '-', 1)::int;
      v_mes_ref := split_part(v_mes_str, '-', 2)::int;
      v_diff_meses := (v_ano_ref - v_ano_ini) * 12 + (v_mes_ref - v_mes_ini);
      v_parcela_atual := v_diff_meses + 1;

      IF v_parcela_atual < 1 OR v_parcela_atual > r_conta.parcelas_total THEN
        CONTINUE; -- Fora do período das parcelas
      END IF;
    END IF;

    -- Busca ou cria o ciclo de cobrança do mês
    SELECT * INTO r_ciclo
    FROM public.ciclos_cobranca
    WHERE conta_fixa_id = r_conta.id AND mes_referencia = p_mes;

    IF r_ciclo.id IS NULL THEN
      INSERT INTO public.ciclos_cobranca (conta_fixa_id, mes_referencia, valor_total)
      VALUES (r_conta.id, p_mes, r_conta.valor_padrao)
      RETURNING * INTO r_ciclo;
    END IF;

    -- Gera as cobranças individuais se ainda não existirem para este ciclo
    IF NOT EXISTS (SELECT 1 FROM public.cobrancas_individuais WHERE ciclo_id = r_ciclo.id) THEN

      -- CASO A: Individual
      IF r_conta.forma_divisao = 'individual' AND r_conta.morador_especifico_id IS NOT NULL THEN
        INSERT INTO public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
        VALUES (r_ciclo.id, r_conta.morador_especifico_id, r_ciclo.valor_total, 'pendente')
        ON CONFLICT DO NOTHING;

      -- CASO B: Percentual
      ELSIF r_conta.forma_divisao = 'percentual' THEN
        SELECT coalesce(sum(peso_ou_valor), 0) INTO v_soma_percentual
        FROM public.divisao_conta
        WHERE conta_fixa_id = r_conta.id;

        IF v_soma_percentual > 0 THEN
          FOR r_div IN
            SELECT usuario_id, peso_ou_valor
            FROM public.divisao_conta
            WHERE conta_fixa_id = r_conta.id AND peso_ou_valor > 0
          LOOP
            INSERT INTO public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
            VALUES (
              r_ciclo.id,
              r_div.usuario_id,
              round((r_ciclo.valor_total * (r_div.peso_ou_valor / v_soma_percentual)), 2),
              'pendente'
            )
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;

      -- CASO C: Divisão Igualitária com Centavos Exatos
      ELSE
        SELECT array_agg(usuario_id ORDER BY entrou_em ASC, usuario_id ASC) INTO v_membros
        FROM public.membros_casa
        WHERE casa_id = p_casa_id
          AND (entrou_em IS NULL OR entrou_em <= (r_ciclo.criado_em + interval '1 day'));

        v_num_membros := coalesce(array_length(v_membros, 1), 0);

        IF v_num_membros > 0 THEN
          v_total_centavos := round(r_ciclo.valor_total * 100)::bigint;
          v_centavos_base := v_total_centavos / v_num_membros;
          v_sobra_centavos := v_total_centavos - (v_centavos_base * v_num_membros);

          FOR v_idx IN 1..v_num_membros LOOP
            v_membro_id := v_membros[v_idx];
            v_centavos_pessoa := v_centavos_base + (CASE WHEN v_idx <= v_sobra_centavos THEN 1 ELSE 0 END);

            INSERT INTO public.cobrancas_individuais (ciclo_id, usuario_id, valor, status)
            VALUES (r_ciclo.id, v_membro_id, (v_centavos_pessoa::numeric / 100), 'pendente')
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
      END IF;

    END IF;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sincronizar_cobrancas_mes(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
